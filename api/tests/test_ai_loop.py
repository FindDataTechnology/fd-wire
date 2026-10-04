"""构建循环核心测试（LLM/工具执行全 mock，直接跑 loop/service 层）。

覆盖：
- 完整一轮「用户 → LLM 产工具调用 → 暂存产物 → 终答」消息序列落库
- 多工具调用轮 + 非 cell 工具经 ToolExecutor 协议转发
- 轮次上限截断（如实告知，draft 留存）
- cell 未开通：常量错误回复、零 LLM 调用
- LLM 异常 / 工具异常：如实反馈、不留半成品
- 历史回灌：tool_trace 还原为 OpenAI wire 的 tool_calls+tool 消息对
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from fd_wire_api.ai.db import AiBase, reset_ai_runtime
from fd_wire_api.ai.executor import (
    CELL_NOT_PROVISIONED_MESSAGE,
    CellToolError,
)
from fd_wire_api.ai.llm import LlmGatewayError
from fd_wire_api.ai.loop import run_build_loop
from fd_wire_api.ai.models import AIDraftArtifact, AIMessage, MessageRole
from fd_wire_api.ai.protocols import LlmAssistantMessage, ToolCall
from fd_wire_api.ai.service import append_message, chat
from fd_wire_api.ai.settings import AiSettings


# ------------------------------------------------------------------ fakes


class FakeLlm:
    """脚本化 LlmClient：按序弹出结果，Exception 即抛。记录每次输入。"""

    def __init__(self, script: list) -> None:
        self.script = list(script)
        self.calls: list[dict] = []

    def complete(self, messages, tools):
        self.calls.append({"messages": messages, "tools": tools})
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class FakeExecutor:
    """脚本化 ToolExecutor：按工具名给结果或抛异常。记录每次调用。"""

    def __init__(self, behavior: dict | None = None) -> None:
        self.behavior = behavior or {}
        self.calls: list[tuple[str, dict]] = []

    def execute(self, tool_name: str, args: dict) -> dict:
        self.calls.append((tool_name, args))
        action = self.behavior.get(tool_name, {"ok": True, "rows": 0})
        if isinstance(action, Exception):
            raise action
        return action


def tool_call(name: str, args: dict, call_id: str = "call-1") -> ToolCall:
    return ToolCall(id=call_id, name=name, arguments=args)


def assistant_reply(text: str) -> LlmAssistantMessage:
    return LlmAssistantMessage(content=text)


def assistant_tool(*calls: ToolCall) -> LlmAssistantMessage:
    return LlmAssistantMessage(content=None, tool_calls=calls)


DASHBOARD_ARGS = {
    "title": "中美日人均 GDP 对比",
    "spec": {"indicators": ["IND-GDP-US", "IND-GDP-CN", "IND-GDP-JP"], "chart": "line"},
}


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    AiBase.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    yield session
    session.close()


@pytest.fixture(autouse=True)
def cell_provisioned(monkeypatch):
    """默认给 cust-001 开通 cell；未开通用例自行清掉映射。"""
    monkeypatch.setenv("AI_CELL_ENDPOINT_MAP", "cust-001=http://cell-001/mcp")
    reset_ai_runtime()
    yield
    reset_ai_runtime()


def _conversation(db, customer_id="cust-001"):
    from fd_wire_api.ai.models import AIConversation

    conversation = AIConversation(customer_id=customer_id, title="GDP 分析")
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


def _messages(db, conversation_id: int) -> list[AIMessage]:
    return list(
        db.query(AIMessage)
        .filter(AIMessage.conversation_id == conversation_id)
        .order_by(AIMessage.id)
        .all()
    )


def _artifacts(db, conversation_id: int) -> list[AIDraftArtifact]:
    return list(
        db.query(AIDraftArtifact)
        .filter(AIDraftArtifact.conversation_id == conversation_id)
        .all()
    )


# ------------------------------------------------------------------ 正循环


def test_full_round_user_toolcall_artifact_final(db) -> None:
    """完整一轮：用户 → 工具调用暂存产物 → 结果回灌 → 终答（序列落库）。"""
    conversation = _conversation(db)
    llm = FakeLlm([
        assistant_tool(tool_call("dashboard_spec_create", DASHBOARD_ARGS)),
        assistant_reply("仪表盘草稿已建好：中美日人均 GDP 对比（3 条指标线），请确认后物化。"),
    ])
    executor = FakeExecutor()

    appended = chat(
        db,
        conversation,
        content="帮我建一个中美日人均 GDP 对比仪表盘",
        llm=llm,
        tool_executor=executor,
        settings=AiSettings(ai_max_turns=8),
    )

    # 消息序列：user → assistant(空文本工具轮) → tool_trace → assistant(终答)
    assert [(m.role, type(m)) for m in _messages(db, conversation.id)] == [
        (MessageRole.user.value, AIMessage),
        (MessageRole.assistant.value, AIMessage),
        (MessageRole.tool_trace.value, AIMessage),
        (MessageRole.assistant.value, AIMessage),
    ]
    assert appended[0].role == MessageRole.user.value
    assert appended[0].content == "帮我建一个中美日人均 GDP 对比仪表盘"

    # tool_trace 留痕：工具名/入参/结果（含 artifact_id）
    trace = json.loads(appended[2].content)
    assert trace["tool_name"] == "dashboard_spec_create"
    assert trace["arguments"] == DASHBOARD_ARGS
    assert trace["result"]["ok"] is True
    assert trace["result"]["kind"] == "dashboard"
    assert trace["result"]["status"] == "draft"
    artifact_id = trace["result"]["artifact_id"]

    # 产物暂存表：恰好一行 draft，spec 为工具入参原样 JSON
    rows = _artifacts(db, conversation.id)
    assert len(rows) == 1
    assert rows[0].id == artifact_id
    assert rows[0].kind == "dashboard"
    assert rows[0].customer_id == "cust-001"
    assert rows[0].status == "draft"
    assert rows[0].spec["title"] == "中美日人均 GDP 对比"

    # 终答
    assert appended[-1].role == MessageRole.assistant.value
    assert "仪表盘草稿已建好" in appended[-1].content

    # 产物工具不进 cell 执行器；LLM 收到的 tools 恰为五类产物 schema
    assert executor.calls == []
    from fd_wire_api.ai.tools import TOOL_SCHEMAS

    assert llm.calls[0]["tools"] == TOOL_SCHEMAS
    wire = llm.calls[1]["messages"]
    assert wire[0]["role"] == "system"
    assert wire[1] == {"role": "user", "content": "帮我建一个中美日人均 GDP 对比仪表盘"}
    # 回灌：assistant 工具轮 + tool 结果
    assert wire[2]["tool_calls"][0]["function"]["name"] == "dashboard_spec_create"
    tool_msg = wire[3]
    assert tool_msg["role"] == "tool"
    assert tool_msg["tool_call_id"] == "call-1"
    assert json.loads(tool_msg["content"])["ok"] is True


def test_multi_tool_turn_and_cell_tool_dispatch(db) -> None:
    """一轮多工具：产物工具暂存 + 探索工具经 ToolExecutor 打到 cell。"""
    conversation = _conversation(db)
    llm = FakeLlm([
        assistant_tool(
            tool_call("search_indicators", {"q": "人均GDP"}, call_id="c-1"),
            tool_call("composite_indicator_create",
                      {"title": "人均GDP指数", "spec": {"formula": "A/B*100"}}, call_id="c-2"),
        ),
        assistant_reply("两个动作都完成：探索到 3 条指标，组合指标草稿已暂存。"),
    ])
    executor = FakeExecutor(behavior={"search_indicators": {"ok": True, "rows": 3}})

    chat(
        db,
        conversation,
        content="先搜人均GDP指标，再建一个组合指标",
        llm=llm,
        tool_executor=executor,
        settings=AiSettings(ai_max_turns=8),
    )

    roles = [m.role for m in _messages(db, conversation.id)]
    assert roles == [
        MessageRole.user.value,
        MessageRole.assistant.value,
        MessageRole.tool_trace.value,
        MessageRole.tool_trace.value,
        MessageRole.assistant.value,
    ]
    trace1 = json.loads(_messages(db, conversation.id)[2].content)
    trace2 = json.loads(_messages(db, conversation.id)[3].content)
    assert trace1["result"] == {"ok": True, "rows": 3}
    assert trace2["result"]["ok"] is True and trace2["result"]["kind"] == "composite_indicator"
    # 探索工具确实走了 executor（cell 轨道），产物工具没有
    assert executor.calls == [("search_indicators", {"q": "人均GDP"})]
    assert len(_artifacts(db, conversation.id)) == 1


def test_history_replay_rebuilds_wire_pairs(db) -> None:
    """第二轮对话回灌历史：tool_trace 还原为 tool_calls+tool 消息对。"""
    conversation = _conversation(db)
    llm = FakeLlm([
        assistant_tool(tool_call("dashboard_spec_create", DASHBOARD_ARGS)),
        assistant_reply("第一轮完成。"),
        assistant_reply("第二轮也完成。"),
    ])
    settings = AiSettings(ai_max_turns=8)
    executor = FakeExecutor()
    chat(db, conversation, content="第一轮", llm=llm, tool_executor=executor, settings=settings)
    chat(db, conversation, content="第二轮", llm=llm, tool_executor=executor, settings=settings)

    wire = llm.calls[-1]["messages"]
    # system → user1 → assistant(tool_calls) → tool → assistant(终答) → user2
    assert [m["role"] for m in wire] == [
        "system", "user", "assistant", "tool", "assistant", "user",
    ]
    assert wire[4]["content"] == "第一轮完成。"
    replayed_call = wire[2]["tool_calls"][0]
    assert replayed_call["id"] == "call-1"
    assert replayed_call["function"]["name"] == "dashboard_spec_create"
    assert json.loads(replayed_call["function"]["arguments"]) == DASHBOARD_ARGS
    assert wire[3]["tool_call_id"] == "call-1"
    assert json.loads(wire[3]["content"])["ok"] is True


# ------------------------------------------------------------------ 护栏


def test_max_turns_truncation(db) -> None:
    """轮次上限：LLM 一直要工具 → 达上限如实截断，draft 留存。"""
    conversation = _conversation(db)
    endless = assistant_tool(tool_call("dashboard_spec_create", DASHBOARD_ARGS))
    llm = FakeLlm([endless, endless, endless, endless])  # 远超上限
    executor = FakeExecutor()

    appended = chat(
        db,
        conversation,
        content="一直建仪表盘",
        llm=llm,
        tool_executor=executor,
        settings=AiSettings(ai_max_turns=3),
    )

    assert len(llm.calls) == 3  # 恰好 3 次 LLM 调用
    assert appended[-1].role == MessageRole.assistant.value
    assert "AI_MAX_TURNS=3" in appended[-1].content
    assert "截断" in appended[-1].content
    # 每轮产物草稿都留存（不静默丢弃）
    assert len(_artifacts(db, conversation.id)) == 3


def test_cell_not_provisioned_constant_reply(db, monkeypatch) -> None:
    """cell 未开通：常量错误回复，零 LLM 调用、零工具执行。"""
    monkeypatch.setenv("AI_CELL_ENDPOINT_MAP", "")
    reset_ai_runtime()
    conversation = _conversation(db, customer_id="cust-404")
    llm = FakeLlm([])
    executor = FakeExecutor()

    appended = chat(
        db,
        conversation,
        content="建个仪表盘",
        llm=llm,
        tool_executor=executor,
        settings=AiSettings(ai_max_turns=8),
    )

    assert [m.role for m in appended] == [
        MessageRole.user.value,
        MessageRole.assistant.value,
    ]
    assert appended[1].content == CELL_NOT_PROVISIONED_MESSAGE
    assert llm.calls == []
    assert executor.calls == []
    assert _artifacts(db, conversation.id) == []


# ------------------------------------------------------------------ 失败如实


def test_llm_failure_honest_no_artifacts(db) -> None:
    """LLM 异常：assistant 如实报错并安全中止，不留半成品。"""
    conversation = _conversation(db)
    llm = FakeLlm([LlmGatewayError("token 网关不可达: 连接超时")])
    executor = FakeExecutor()

    appended = chat(
        db,
        conversation,
        content="建个仪表盘",
        llm=llm,
        tool_executor=executor,
        settings=AiSettings(ai_max_turns=8),
    )

    assert [m.role for m in appended] == [
        MessageRole.user.value,
        MessageRole.assistant.value,
    ]
    assert "AI 服务调用失败" in appended[1].content
    assert "token 网关不可达" in appended[1].content
    assert "未产生半成品" in appended[1].content
    assert len(llm.calls) == 1
    assert _artifacts(db, conversation.id) == []


def test_tool_failure_fed_back_and_reported(db) -> None:
    """工具异常：错误结果回灌 LLM，终答如实说明，不落产物。"""
    conversation = _conversation(db)
    llm = FakeLlm([
        assistant_tool(tool_call("search_indicators", {"q": "销量"}, call_id="c-1")),
        assistant_reply("抱歉，探索工具暂时不可用（cell MCP 端点不可达），本轮没能建出仪表盘。"),
    ])
    executor = FakeExecutor(
        behavior={"search_indicators": CellToolError("cell MCP 端点不可达: connection refused")}
    )

    appended = chat(
        db,
        conversation,
        content="查销量指标并建仪表盘",
        llm=llm,
        tool_executor=executor,
        settings=AiSettings(ai_max_turns=8),
    )

    messages = _messages(db, conversation.id)
    trace_search = json.loads(messages[2].content)
    assert trace_search["result"]["ok"] is False
    assert trace_search["result"]["error_type"] == "CellToolError"
    assert "不可达" in trace_search["result"]["error"]
    # 无效/失败轮之后 LLM 如实说明失败；产物表仍为空（无半成品）
    assert "不可用" in appended[-1].content
    assert _artifacts(db, conversation.id) == []


def test_invalid_artifact_args_rejected_no_half_product(db) -> None:
    """产物工具入参不合法：拒绝暂存并回灌错误（表里不多一行）。"""
    conversation = _conversation(db)
    llm = FakeLlm([
        assistant_tool(tool_call("dashboard_spec_create", {"title": "缺 spec 的半成品"})),
        assistant_reply("上一次工具入参不完整（缺 spec 对象），已如实放弃，未产生草稿。"),
    ])
    executor = FakeExecutor()

    chat(
        db,
        conversation,
        content="建个仪表盘",
        llm=llm,
        tool_executor=executor,
        settings=AiSettings(ai_max_turns=8),
    )

    trace = json.loads(_messages(db, conversation.id)[2].content)
    assert trace["result"]["ok"] is False
    assert "spec" in trace["result"]["error"]
    assert _artifacts(db, conversation.id) == []


# ------------------------------------------------------------------ run_build_loop 直测


def test_run_build_loop_requires_provisioned_cell(db, monkeypatch) -> None:
    monkeypatch.setenv("AI_CELL_ENDPOINT_MAP", "cust-001=http://cell-001/mcp")
    reset_ai_runtime()
    conversation = _conversation(db)
    append_message(
        db, conversation_id=conversation.id, role=MessageRole.user, content="hi"
    )
    llm = FakeLlm([assistant_reply("done")])
    appended = run_build_loop(
        db, conversation, llm=llm, tool_executor=FakeExecutor(), max_turns=8
    )
    assert [m.role for m in appended] == [MessageRole.assistant.value]
    assert appended[0].content == "done"
