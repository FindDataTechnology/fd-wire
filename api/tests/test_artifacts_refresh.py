"""手动刷新 API 测试（wire-dashboard-refresh 任务 1.2/1.4）。

LLM/工具执行全 mock（照 test_ai_api 的 dependency_overrides 手法，复用
ai 路由的 get_llm_client/get_tool_executor 同一依赖对象），覆盖：

- 成功流：无头轮按面板 source 取数（经 executor）→ 新版本落盘（版本 +1、
  审计 operator、系统指令携带当前完整 spec、```json 围栏容错）；
- 失败零半写：LLM 终答垃圾 / 网关异常 / 超轮次无终答 → 502 带原因，
  零新版本、锁可靠释放；
- 单飞 409（进行中再触发，零 LLM 调用）；kind≠dashboard 403；
  archived 409（提示先恢复）；跨客户 404；鉴权 401；
- 无 cell：显式 map 未命中 403 档位提示零引擎调用；约定派生口径下
  握手期 CellNotProvisionedError 同样 403；
- 刷新轮禁写产物草稿（误调产物写入工具被拒，暂存表不多一行）。
"""

from __future__ import annotations

import copy
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
from fd_wire_api.ai.executor import (
    CELL_NOT_PROVISIONED_MESSAGE,
    CellNotProvisionedError,
)
from fd_wire_api.ai.llm import LlmGatewayError
from fd_wire_api.ai.models import AIDraftArtifact
from fd_wire_api.ai.protocols import LlmAssistantMessage, ToolCall
from fd_wire_api.ai.routes import get_llm_client, get_tool_executor
from fd_wire_api.ai.schemas import ConversationCreate
from fd_wire_api.ai.service import create_conversation as create_ai_conversation
from fd_wire_api.app import app
from fd_wire_api.artifacts import refresh as refresh_module

from console_fixture import bearer, install_fake_jwks, make_console_env, mint_id_token

SUB_CUST = "sub-refresh-001"
SUB_OTHER = "sub-refresh-002"
CUST = bearer(mint_id_token(SUB_CUST))
OTHER = bearer(mint_id_token(SUB_OTHER))


# ------------------------------------------------------------------ fakes


class FakeLlm:
    """脚本化 LlmClient：按序弹出结果，Exception 即抛。记录每次输入。"""

    def __init__(self, script: list | None = None) -> None:
        self.script = list(script or [])
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


def tool_reply(*calls: ToolCall) -> LlmAssistantMessage:
    return LlmAssistantMessage(content=None, tool_calls=calls)


def text_reply(text: str) -> LlmAssistantMessage:
    return LlmAssistantMessage(content=text)


# 当前 spec（v1 渲染器契约：panels/source/snapshot）与刷新后的期望 spec
DASH_SPEC = {
    "title": "宏观概览",
    "spec": {
        "panels": [
            {
                "id": "p1",
                "type": "kpi",
                "title": "中国 GDP",
                "span": 1,
                "source": "IND-GDP-CN",
                "snapshot": {"columns": ["指标", "值"], "rows": [["GDP", "129.4"]]},
                "config": {"unit": "万亿元"},
            },
            {
                "id": "p2",
                "type": "line",
                "title": "GDP 趋势",
                "span": 2,
                "source": "macro_trend",
                "snapshot": {
                    "columns": ["年份", "GDP"],
                    "rows": [["2023", "129.4"], ["2024", "134.9"]],
                },
            },
        ]
    },
}


def updated_spec() -> dict:
    """刷新成功后期望的更新 spec：结构/id/source 不动，仅 snapshot 换新。"""
    spec = copy.deepcopy(DASH_SPEC)
    panels = spec["spec"]["panels"]
    panels[0]["snapshot"]["rows"] = [["GDP", "140.5"]]
    panels[1]["snapshot"]["rows"] = [
        ["2023", "129.4"],
        ["2024", "134.9"],
        ["2025", "140.5"],
    ]
    return spec


def fenced(updated: dict) -> str:
    """LLM 终答常见形态：```json 围栏包裹的完整 spec JSON。"""
    return "```json\n" + json.dumps(updated, ensure_ascii=False) + "\n```"


QUERY_CALL = ToolCall(id="call-1", name="query_indicator", arguments={"code": "IND-GDP-CN"})


@pytest.fixture()
def fake_llm() -> FakeLlm:
    return FakeLlm()


@pytest.fixture()
def fake_executor() -> FakeExecutor:
    return FakeExecutor()


@pytest.fixture()
def db_session():
    """独立内存库（ai 三表 + artifacts 两表同引擎）的会话。"""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    AiBase.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(monkeypatch, tmp_path, db_session, fake_llm, fake_executor):
    """覆写 get_db + LLM/工具执行依赖（与 ai 路由同一依赖对象）的 TestClient。"""
    monkeypatch.setenv("AI_CELL_ENDPOINT_MAP", "cust-001=http://cell-001/mcp")

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    reset_ai_runtime()
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_llm_client] = lambda: fake_llm
    app.dependency_overrides[get_tool_executor] = lambda: fake_executor
    install_fake_jwks(monkeypatch)
    make_console_env(
        tmp_path,
        monkeypatch,
        customers=[(SUB_CUST, "cust-001"), (SUB_OTHER, "cust-002")],
    )
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    reset_ai_runtime()


def stage_draft(db_session, *, customer_id: str = "cust-001", spec=None, kind="dashboard"):
    """直插一条会话草稿（模拟构建循环暂存产物），返回 (conversation, draft)。"""
    conversation = create_ai_conversation(
        db_session, customer_id=customer_id, payload=ConversationCreate(title="GDP 分析")
    )
    draft = AIDraftArtifact(
        conversation_id=conversation.id,
        customer_id=customer_id,
        kind=kind,
        spec=spec or DASH_SPEC,
        status="draft",
    )
    db_session.add(draft)
    db_session.commit()
    db_session.refresh(draft)
    return conversation, draft


def make_dashboard(client, db_session, *, spec=None, kind="dashboard") -> dict:
    """草稿导入为 draft 产物（version=1）。"""
    conv, draft = stage_draft(db_session, spec=spec, kind=kind)
    resp = client.post(
        "/api/v1/artifacts/from-draft",
        json={"conversation_id": conv.id, "draft_id": draft.id},
        headers=CUST,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def versions_of(client, artifact_id: int) -> list[dict]:
    resp = client.get(f"/api/v1/artifacts/{artifact_id}/versions", headers=CUST)
    assert resp.status_code == 200, resp.text
    return resp.json()


def draft_count(db_session) -> int:
    return len(db_session.query(AIDraftArtifact).all())


# ------------------------------------------------------------------ 成功流


def test_refresh_success_new_version_and_audit(
    client, db_session, fake_llm, fake_executor
) -> None:
    """成功流：published 看板刷新 → 无头轮取数 → ```json 围栏终答 → v2 落盘。"""
    artifact = make_dashboard(client, db_session)
    published = client.post(f"/api/v1/artifacts/{artifact['id']}/publish", headers=CUST)
    assert published.status_code == 200
    fake_llm.script = [
        tool_reply(QUERY_CALL),
        text_reply(fenced(updated_spec())),
    ]

    resp = client.post(f"/api/v1/artifacts/{artifact['id']}/refresh", headers=CUST)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["version"] == 2
    assert body["refreshed_at"]  # UTC ISO-8601 完成时间

    # 无头轮确实按面板 source 经 executor 取了数
    assert fake_executor.calls == [("query_indicator", {"code": "IND-GDP-CN"})]
    assert len(fake_llm.calls) == 2

    # 系统指令携带当前完整 spec + 刷新要求（不建会话、不写会话表）
    system = fake_llm.calls[0]["messages"][0]
    assert system["role"] == "system"
    assert "IND-GDP-CN" in system["content"]
    assert "macro_trend" in system["content"]
    assert "snapshot" in system["content"] and "刷新" in system["content"]
    user = fake_llm.calls[0]["messages"][1]
    assert user["role"] == "user" and "刷新" in user["content"]
    # 工具结果按 OpenAI wire 回灌（assistant.tool_calls + tool 消息对）
    replay = fake_llm.calls[1]["messages"]
    assert [m["role"] for m in replay] == ["system", "user", "assistant", "tool"]
    assert replay[2]["tool_calls"][0]["function"]["name"] == "query_indicator"
    assert json.loads(replay[3]["content"])["ok"] is True

    # 详情：新版本新快照；版本链 append-only（v2 → v1，v1 内容不变）
    detail = client.get(f"/api/v1/artifacts/{artifact['id']}", headers=CUST).json()
    assert detail["version"] == 2
    assert detail["spec"] == updated_spec()
    versions = versions_of(client, artifact["id"])
    assert [v["version"] for v in versions] == [2, 1]
    assert all(v["operator"] == "console:cust-001" for v in versions)  # 审计同 PUT
    v1 = client.get(f"/api/v1/artifacts/{artifact['id']}/versions/1", headers=CUST)
    assert v1.json()["spec"] == DASH_SPEC
    # 刷新不产生会话草稿（无头轮禁 stage）
    assert draft_count(db_session) == 1  # 仅建产物时那一条


def test_refresh_draft_artifact_also_allowed(
    client, db_session, fake_llm, fake_executor
) -> None:
    """draft 看板同样可刷（仅 archived 拒）。"""
    artifact = make_dashboard(client, db_session)
    fake_llm.script = [text_reply(json.dumps(updated_spec(), ensure_ascii=False))]

    resp = client.post(f"/api/v1/artifacts/{artifact['id']}/refresh", headers=CUST)

    assert resp.status_code == 200, resp.text
    assert resp.json()["version"] == 2
    assert fake_llm.calls[0]["messages"][0]["content"]  # 系统指令在场
    # 没有工具调用时零引擎调用
    assert fake_executor.calls == []


# -------------------------------------------------------------- 失败零半写


def test_refresh_garbage_output_502_no_new_version(
    client, db_session, fake_llm
) -> None:
    """LLM 终答是自然语言道歉（非 JSON）→ 502 带原因，零新版本，锁已释放。"""
    artifact = make_dashboard(client, db_session)
    fake_llm.script = [text_reply("抱歉，取数工具暂时不可用，本次没能完成刷新。")]

    resp = client.post(f"/api/v1/artifacts/{artifact['id']}/refresh", headers=CUST)

    assert resp.status_code == 502, resp.text
    assert "无法解析" in resp.json()["detail"]
    assert "取数工具暂时不可用" in resp.json()["detail"]  # 原因如实带出
    detail = client.get(f"/api/v1/artifacts/{artifact['id']}", headers=CUST).json()
    assert detail["version"] == 1
    assert [v["version"] for v in versions_of(client, artifact["id"])] == [1]
    # 锁已释放：可再占（再触发会走完整轮而非 409 单飞）
    assert refresh_module.acquire_refresh_lock(artifact["id"]) is True
    refresh_module.release_refresh_lock(artifact["id"])


def test_refresh_invalid_spec_output_502(client, db_session, fake_llm) -> None:
    """终答可解析但缺 title（未过最小校验）→ 502，零新版本。"""
    artifact = make_dashboard(client, db_session)
    fake_llm.script = [text_reply(json.dumps({"spec": {"panels": []}}))]

    resp = client.post(f"/api/v1/artifacts/{artifact['id']}/refresh", headers=CUST)

    assert resp.status_code == 502, resp.text
    assert "最小校验" in resp.json()["detail"]
    assert client.get(
        f"/api/v1/artifacts/{artifact['id']}", headers=CUST
    ).json()["version"] == 1


def test_refresh_llm_gateway_error_502(client, db_session, fake_llm) -> None:
    """LLM 网关异常（engine 错误）→ 502 带原因，零新版本。"""
    artifact = make_dashboard(client, db_session)
    fake_llm.script = [LlmGatewayError("token 网关不可达: 连接超时")]

    resp = client.post(f"/api/v1/artifacts/{artifact['id']}/refresh", headers=CUST)

    assert resp.status_code == 502, resp.text
    assert "token 网关不可达" in resp.json()["detail"]
    assert [v["version"] for v in versions_of(client, artifact["id"])] == [1]


def test_refresh_truncated_round_502(
    client, db_session, monkeypatch, fake_llm, fake_executor
) -> None:
    """超轮次无终答（LLM 一直要工具）→ 502 如实截断，零新版本。"""
    artifact = make_dashboard(client, db_session)
    monkeypatch.setenv("AI_MAX_TURNS", "2")
    reset_ai_runtime()  # 让 env 生效（get_settings 惰性单例）
    endless = tool_reply(ToolCall(id="c", name="query_indicator", arguments={"code": "X"}))
    fake_llm.script = [endless, endless, endless]

    resp = client.post(f"/api/v1/artifacts/{artifact['id']}/refresh", headers=CUST)

    assert resp.status_code == 502, resp.text
    assert "轮次上限" in resp.json()["detail"]
    assert len(fake_llm.calls) == 2
    assert [v["version"] for v in versions_of(client, artifact["id"])] == [1]


def test_refresh_rejects_artifact_staging_tool(
    client, db_session, fake_llm, fake_executor
) -> None:
    """刷新轮禁写产物草稿：LLM 误调 dashboard_spec_create → 回灌错误不
    stage，终答仍可成功落 v2。"""
    artifact = make_dashboard(client, db_session)
    before = draft_count(db_session)
    fake_llm.script = [
        tool_reply(
            ToolCall(
                id="c1",
                name="dashboard_spec_create",
                arguments={"title": DASH_SPEC["title"], "spec": DASH_SPEC["spec"]},
            )
        ),
        text_reply(fenced(updated_spec())),
    ]

    resp = client.post(f"/api/v1/artifacts/{artifact['id']}/refresh", headers=CUST)

    assert resp.status_code == 200, resp.text
    assert resp.json()["version"] == 2
    assert draft_count(db_session) == before  # 暂存表不多一行
    # 误调被回灌为错误结果（未走 cell executor）
    assert fake_executor.calls == []
    fed_back = json.loads(fake_llm.calls[1]["messages"][3]["content"])
    assert fed_back["ok"] is False
    assert "禁用产物写入工具" in fed_back["error"]


# ------------------------------------------------------- 409/403/404/401


def test_refresh_single_flight_409(client, db_session, fake_llm) -> None:
    """单飞：同产物刷新进行中再触发 → 409，且零 LLM 调用；释放后可再刷。"""
    artifact = make_dashboard(client, db_session)
    assert refresh_module.acquire_refresh_lock(artifact["id"]) is True  # 模拟进行中

    busy = client.post(f"/api/v1/artifacts/{artifact['id']}/refresh", headers=CUST)

    assert busy.status_code == 409, busy.text
    assert "刷新中" in busy.json()["detail"]
    assert fake_llm.calls == []  # 未发起第二个刷新轮
    assert [v["version"] for v in versions_of(client, artifact["id"])] == [1]

    refresh_module.release_refresh_lock(artifact["id"])
    fake_llm.script = [text_reply(fenced(updated_spec()))]
    ok = client.post(f"/api/v1/artifacts/{artifact['id']}/refresh", headers=CUST)
    assert ok.status_code == 200, ok.text
    assert ok.json()["version"] == 2


def test_refresh_kind_not_dashboard_403(client, db_session, fake_llm) -> None:
    """kind≠dashboard（如 alert_rule）→ 403，零 LLM 调用。"""
    artifact = make_dashboard(
        client,
        db_session,
        spec={"title": "告警", "spec": {"indicator": "X", "threshold": 1}},
        kind="alert_rule",
    )

    resp = client.post(f"/api/v1/artifacts/{artifact['id']}/refresh", headers=CUST)

    assert resp.status_code == 403, resp.text
    assert "仅仪表盘" in resp.json()["detail"]
    assert fake_llm.calls == []


def test_refresh_archived_409_hint_restore(client, db_session, fake_llm) -> None:
    """archived → 409 提示先恢复；零 LLM 调用（不浪费一轮）。"""
    artifact = make_dashboard(client, db_session)
    client.post(f"/api/v1/artifacts/{artifact['id']}/archive", headers=CUST)

    resp = client.post(f"/api/v1/artifacts/{artifact['id']}/refresh", headers=CUST)

    assert resp.status_code == 409, resp.text
    assert "恢复" in resp.json()["detail"]
    assert fake_llm.calls == []
    # 恢复后可再刷
    client.post(f"/api/v1/artifacts/{artifact['id']}/restore", headers=CUST)
    fake_llm.script = [text_reply(fenced(updated_spec()))]
    ok = client.post(f"/api/v1/artifacts/{artifact['id']}/refresh", headers=CUST)
    assert ok.status_code == 200


def test_refresh_cross_tenant_404(client, db_session, fake_llm) -> None:
    """跨客户：他企产物刷新一律 404（不泄露存在性）。"""
    artifact = make_dashboard(client, db_session)

    resp = client.post(f"/api/v1/artifacts/{artifact['id']}/refresh", headers=OTHER)

    assert resp.status_code == 404
    assert fake_llm.calls == []
    # 不存在的产物同样 404
    assert client.post("/api/v1/artifacts/99999/refresh", headers=CUST).status_code == 404


def test_refresh_no_cell_403_tier_message(
    client, db_session, monkeypatch, fake_llm, fake_executor
) -> None:
    """无 cell（免费档）两种口径均 403 档位提示：
    ①显式 map 未命中——护栏零 LLM/零引擎调用；
    ②约定派生口径——首个取数调用握手期抛 CellNotProvisionedError。"""
    artifact = make_dashboard(client, db_session)

    # ① 显式部署口径：map 已配但不含 cust-001
    monkeypatch.setenv("AI_CELL_ENDPOINT_MAP", "cust-002=http://cell-002/mcp")
    reset_ai_runtime()
    fake_llm.calls.clear()
    resp = client.post(f"/api/v1/artifacts/{artifact['id']}/refresh", headers=CUST)
    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"] == CELL_NOT_PROVISIONED_MESSAGE
    assert fake_llm.calls == []
    assert fake_executor.calls == []
    assert [v["version"] for v in versions_of(client, artifact["id"])] == [1]

    # ② 约定派生口径：端点可解析，握手期才发现未开通
    monkeypatch.setenv("AI_CELL_ENDPOINT_MAP", "")
    reset_ai_runtime()
    fake_llm.script = [tool_reply(QUERY_CALL)]
    fake_executor.behavior = {
        "query_indicator": CellNotProvisionedError(
            "customer cust-001 的 cell 未开通（握手期端点拒绝: initialize 返回 404）"
        )
    }
    resp2 = client.post(f"/api/v1/artifacts/{artifact['id']}/refresh", headers=CUST)
    assert resp2.status_code == 403, resp2.text
    assert resp2.json()["detail"] == CELL_NOT_PROVISIONED_MESSAGE
    assert [v["version"] for v in versions_of(client, artifact["id"])] == [1]
    reset_ai_runtime()


def test_refresh_auth_required(client) -> None:
    """缺 Bearer ID token 一律 401。"""
    assert client.post("/api/v1/artifacts/1/refresh").status_code == 401
