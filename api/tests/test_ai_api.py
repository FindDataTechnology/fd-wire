"""AI 对话 API 测试（LLM/工具执行全 mock，经依赖覆写注入）。

覆盖：创建即跑一轮完整循环并落库、消息追加续聊、企业隔离（他企 404）、
每客户每日对话数限额 429 带说明、cell 未开通常量错误回复、轮次上限
经 env 生效、LLM 异常如实反馈不产半成品、鉴权 401。
"""

from __future__ import annotations

import json
import os

# 在导入 app 前把默认引擎指向内存库：TestClient 启动钩子里的
# init_ai_db() 不至于在测试机上落下 fd_wire_ai.db 文件。
os.environ.setdefault("AI_DATABASE_URL", "sqlite://")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from fd_wire_api.ai.db import AiBase, get_db, reset_ai_runtime
from fd_wire_api.ai.llm import LlmGatewayError
from fd_wire_api.ai.protocols import LlmAssistantMessage, ToolCall
from fd_wire_api.ai.routes import get_llm_client, get_tool_executor
from fd_wire_api.app import app

CUST = {"X-Customer-Id": "cust-001"}
OTHER = {"X-Customer-Id": "cust-002"}


class FakeLlm:
    def __init__(self, script: list) -> None:
        self.script = list(script)
        self.calls: list = []

    def complete(self, messages, tools):
        self.calls.append(messages)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class FakeExecutor:
    def __init__(self, behavior: dict | None = None) -> None:
        self.behavior = behavior or {}
        self.calls: list = []

    def execute(self, tool_name, args):
        self.calls.append((tool_name, args))
        action = self.behavior.get(tool_name, {"ok": True, "rows": 0})
        if isinstance(action, Exception):
            raise action
        return action


def tool_reply(*calls: ToolCall) -> LlmAssistantMessage:
    return LlmAssistantMessage(content=None, tool_calls=calls)


def text_reply(text: str) -> LlmAssistantMessage:
    return LlmAssistantMessage(content=text)


DASHBOARD_ARGS = {
    "title": "中美日人均 GDP 对比",
    "spec": {"indicators": ["IND-GDP-US", "IND-GDP-CN", "IND-GDP-JP"], "chart": "line"},
}


@pytest.fixture()
def fake_llm():
    return FakeLlm([])


@pytest.fixture()
def fake_executor():
    return FakeExecutor()


@pytest.fixture()
def client(monkeypatch, fake_llm, fake_executor):
    """独立内存库 + 覆写 get_db/LLM/工具执行依赖的 TestClient。"""
    monkeypatch.setenv("AI_CELL_ENDPOINT_MAP", "cust-001=http://cell-001/mcp")
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    AiBase.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    reset_ai_runtime()
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_llm_client] = lambda: fake_llm
    app.dependency_overrides[get_tool_executor] = lambda: fake_executor
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    reset_ai_runtime()


def create(client, *, headers=CUST, **payload) -> dict:
    resp = client.post("/api/v1/ai/conversations", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ------------------------------------------------------------------ 循环落库


def test_create_with_message_runs_full_round(client, fake_llm, fake_executor) -> None:
    """创建带首条消息：完整「用户→工具调用→暂存→终答」序列落库并返回。"""
    fake_llm.script = [
        tool_reply(ToolCall(id="call-1", name="dashboard_spec_create", arguments=DASHBOARD_ARGS)),
        text_reply("仪表盘草稿已生成（3 条指标线），确认后我将物化到贵司 cell。"),
    ]
    body = create(client, title="GDP 分析", message="帮我建一个中美日人均 GDP 对比仪表盘")

    assert body["title"] == "GDP 分析"
    assert body["customer_id"] == "cust-001"
    roles = [m["role"] for m in body["messages"]]
    assert roles == ["user", "assistant", "tool_trace", "assistant"]
    assert body["messages"][0]["content"] == "帮我建一个中美日人均 GDP 对比仪表盘"

    trace = json.loads(body["messages"][2]["content"])
    assert trace["tool_name"] == "dashboard_spec_create"
    assert trace["result"]["ok"] is True
    assert trace["result"]["status"] == "draft"
    assert "仪表盘草稿已生成" in body["messages"][3]["content"]

    # 消息端点按 id 可查（append-only 顺序）；产物草稿端点列出暂存 draft
    messages = client.get(f"/api/v1/ai/conversations/{body['id']}/messages", headers=CUST)
    assert messages.status_code == 200
    assert [m["role"] for m in messages.json()] == roles

    artifacts = client.get(f"/api/v1/ai/conversations/{body['id']}/artifacts", headers=CUST)
    assert artifacts.status_code == 200
    rows = artifacts.json()
    assert len(rows) == 1
    assert rows[0]["kind"] == "dashboard"
    assert rows[0]["status"] == "draft"
    assert rows[0]["spec"] == DASHBOARD_ARGS


def test_append_message_continues_conversation(client, fake_llm) -> None:
    """POST messages 续聊：追加用户消息并跑新一轮循环。"""
    fake_llm.script = [
        text_reply("好的，请把对比范围告诉我。"),
        tool_reply(ToolCall(id="c2", name="alert_rule_create",
                            arguments={"title": "GDP 偏离告警", "spec": {"indicator": "IND-GDP-CN", "op": ">", "threshold": 13000}})),
        text_reply("告警规则草稿已暂存。"),
    ]
    created = create(client, message="我想监控 GDP")
    cid = created["id"]

    resp = client.post(
        f"/api/v1/ai/conversations/{cid}/messages",
        json={"content": "人均GDP超 13000 美元时提醒我"},
        headers=CUST,
    )
    assert resp.status_code == 200, resp.text
    appended = resp.json()
    assert [m["role"] for m in appended] == ["user", "assistant", "tool_trace", "assistant"]

    # 会话累计消息序列：第一轮终答 + 第二轮完整序列
    all_messages = client.get(f"/api/v1/ai/conversations/{cid}/messages", headers=CUST).json()
    assert [m["role"] for m in all_messages] == [
        "user", "assistant",
        "user", "assistant", "tool_trace", "assistant",
    ]


# ------------------------------------------------------------------ 护栏


def test_daily_conversation_limit_429(client, fake_llm, monkeypatch) -> None:
    """每客户每日对话数限额：超限 429 且说明文案带限额值。"""
    monkeypatch.setenv("AI_DAILY_CONVERSATION_LIMIT", "2")
    reset_ai_runtime()
    fake_llm.script = [text_reply("ok")] * 5

    assert client.post("/api/v1/ai/conversations", json={}, headers=CUST).status_code == 201
    assert client.post("/api/v1/ai/conversations", json={}, headers=CUST).status_code == 201
    third = client.post(
        "/api/v1/ai/conversations", json={"message": "再来一个"}, headers=CUST
    )
    assert third.status_code == 429
    assert "AI_DAILY_CONVERSATION_LIMIT=2" in third.json()["detail"]
    assert "每日上限" in third.json()["detail"]

    # 限额按客户隔离：另一企业不受影响
    assert client.post("/api/v1/ai/conversations", json={}, headers=OTHER).status_code == 201
    # 超限后对话未被创建（列表仍为 2 条）
    listing = client.get("/api/v1/ai/conversations", headers=CUST).json()
    assert len(listing) == 2


def test_max_turns_via_env(client, fake_llm, monkeypatch) -> None:
    """AI_MAX_TURNS 经 env 生效：达上限如实截断。"""
    monkeypatch.setenv("AI_MAX_TURNS", "1")
    reset_ai_runtime()
    call = ToolCall(id="c1", name="dashboard_spec_create", arguments=DASHBOARD_ARGS)
    fake_llm.script = [tool_reply(call), text_reply("不该被调到")]

    body = create(client, message="建仪表盘")
    roles = [m["role"] for m in body["messages"]]
    assert roles == ["user", "assistant", "tool_trace", "assistant"]
    assert "AI_MAX_TURNS=1" in body["messages"][3]["content"]
    assert len(fake_llm.calls) == 1


def test_cell_not_provisioned_constant_error(client, fake_llm, fake_executor, monkeypatch) -> None:
    """企业无 cell 端点映射：常量错误回复，零 LLM/工具调用。"""
    monkeypatch.setenv("AI_CELL_ENDPOINT_MAP", "")  # 无任何映射
    reset_ai_runtime()
    body = create(client, headers=OTHER, message="帮我建个仪表盘")

    assert [m["role"] for m in body["messages"]] == ["user", "assistant"]
    assert body["messages"][1]["content"] == "该企业尚未开通数据 cell，AI 构建暂不可用。请联系平台开通 cell 后再试。"
    assert fake_llm.calls == []
    assert fake_executor.calls == []
    artifacts = client.get(f"/api/v1/ai/conversations/{body['id']}/artifacts", headers=OTHER)
    assert artifacts.json() == []


# ------------------------------------------------------------------ 失败如实


def test_llm_failure_honest_feedback_via_api(client, fake_llm) -> None:
    """LLM 异常：对话仍创建成功，assistant 如实报错，无产物草稿。"""
    fake_llm.script = [LlmGatewayError("token 网关不可达: 503")]
    body = create(client, message="建个仪表盘")

    assert [m["role"] for m in body["messages"]] == ["user", "assistant"]
    assert "AI 服务调用失败" in body["messages"][1]["content"]
    assert "token 网关不可达" in body["messages"][1]["content"]
    artifacts = client.get(f"/api/v1/ai/conversations/{body['id']}/artifacts", headers=CUST)
    assert artifacts.json() == []


def test_tool_failure_reported_no_half_product(client, fake_llm, fake_executor) -> None:
    """工具异常经 API：错误回灌、终答如实说明、产物表为空。"""
    from fd_wire_api.ai.executor import CellToolError

    fake_llm.script = [
        tool_reply(ToolCall(id="c1", name="search_indicators", arguments={"q": "GDP"})),
        text_reply("探索工具执行失败（cell 端点 500），本轮没有产出，请稍后再试。"),
    ]
    fake_executor.behavior = {"search_indicators": CellToolError("cell MCP 端点返回 500: boom")}

    body = create(client, message="搜一下 GDP 指标")
    trace = json.loads(body["messages"][2]["content"])
    assert trace["result"]["ok"] is False
    assert trace["result"]["error_type"] == "CellToolError"
    assert "执行失败" in body["messages"][3]["content"]
    assert client.get(
        f"/api/v1/ai/conversations/{body['id']}/artifacts", headers=CUST
    ).json() == []


# ------------------------------------------------------------------ 隔离与鉴权


def test_tenant_isolation(client, fake_llm) -> None:
    """企业隔离：他企不可见列表、消息与产物（一律 404/不可见）。"""
    fake_llm.script = [text_reply("ok")]
    mine = create(client, title="我的对话")
    fake_llm.script = [text_reply("ok2")]
    theirs = create(client, headers=OTHER, title="别家对话")

    # 列表各见各的
    assert [c["title"] for c in client.get("/api/v1/ai/conversations", headers=CUST).json()] == ["我的对话"]
    assert [c["title"] for c in client.get("/api/v1/ai/conversations", headers=OTHER).json()] == ["别家对话"]

    # 他企访问我的会话：消息/产物/续聊一律 404（不泄露存在性）
    cid = mine["id"]
    assert client.get(f"/api/v1/ai/conversations/{cid}/messages", headers=OTHER).status_code == 404
    assert client.get(f"/api/v1/ai/conversations/{cid}/artifacts", headers=OTHER).status_code == 404
    assert client.post(
        f"/api/v1/ai/conversations/{cid}/messages", json={"content": "偷看"}, headers=OTHER
    ).status_code == 404
    # 不存在的会话同样 404
    assert client.get("/api/v1/ai/conversations/99999/messages", headers=CUST).status_code == 404


def test_customer_header_required(client) -> None:
    """缺 X-Customer-Id 一律 401。"""
    assert client.post("/api/v1/ai/conversations", json={}).status_code == 401
    assert client.get("/api/v1/ai/conversations").status_code == 401
    assert client.get("/api/v1/ai/conversations/1/messages").status_code == 401


def test_create_without_message_is_empty_conversation(client, fake_llm) -> None:
    """不带 message 创建：只建档不跑循环（首条消息走 messages 端点）。"""
    body = create(client, title="空对话")
    assert body["messages"] == []
    assert fake_llm.calls == []
    assert client.get("/api/v1/ai/conversations", headers=CUST).json()[0]["title"] == "空对话"
