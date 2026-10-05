"""AI 切片基础设施测试：配置解析、cell 端点解析、CellMcpExecutor、
TokenGatewayLlmClient、产物工具 schema/校验/暂存、Alembic 0005 迁移。

外部 HTTP（cell MCP / token 网关）全部经注入的 httpx.MockTransport mock，
绝不打真网。
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import httpx
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from fd_wire_api.ai.db import AiBase, reset_ai_runtime
from fd_wire_api.ai.executor import (
    CellMcpExecutor,
    CellNotProvisionedError,
    CellToolError,
    resolve_cell_endpoint,
)
from fd_wire_api.ai.llm import LlmGatewayError, TokenGatewayLlmClient
from fd_wire_api.ai.models import AIDraftArtifact
from fd_wire_api.ai.settings import get_settings, parse_endpoint_map
from fd_wire_api.ai.tools import (
    ARTIFACT_TOOL_KINDS,
    TOOL_SCHEMAS,
    stage_artifact,
    validate_artifact_args,
)

API_DIR = Path(__file__).resolve().parent.parent


# ------------------------------------------------------------------ settings


def test_settings_defaults(monkeypatch) -> None:
    for name in (
        "AI_MAX_TURNS",
        "AI_DAILY_CONVERSATION_LIMIT",
        "AI_CELL_ENDPOINT_MAP",
    ):
        monkeypatch.delenv(name, raising=False)
    reset_ai_runtime()
    s = get_settings()
    assert s.ai_max_turns == 8
    assert s.ai_daily_conversation_limit == 50
    assert s.endpoint_map() == {}
    reset_ai_runtime()


def test_settings_env_override_and_endpoint_map(monkeypatch) -> None:
    monkeypatch.setenv("AI_MAX_TURNS", "3")
    monkeypatch.setenv("AI_DAILY_CONVERSATION_LIMIT", "7")
    monkeypatch.setenv("AI_CELL_ENDPOINT_MAP", "cust-001=http://cell-1/mcp,cust-002=http://cell-2/mcp")
    reset_ai_runtime()
    s = get_settings()
    assert s.ai_max_turns == 3
    assert s.ai_daily_conversation_limit == 7
    assert s.endpoint_map() == {
        "cust-001": "http://cell-1/mcp",
        "cust-002": "http://cell-2/mcp",
    }
    reset_ai_runtime()


def test_parse_endpoint_map_forms() -> None:
    assert parse_endpoint_map(None) == {}
    assert parse_endpoint_map("") == {}
    assert parse_endpoint_map({"a": "http://a"}) == {"a": "http://a"}
    assert parse_endpoint_map('{"a": "http://a"}') == {"a": "http://a"}
    with pytest.raises(ValueError):
        parse_endpoint_map("no-equals-sign")


def test_resolve_cell_endpoint(monkeypatch) -> None:
    monkeypatch.setenv("AI_CELL_ENDPOINT_MAP", "cust-001=http://cell-1/mcp")
    reset_ai_runtime()
    assert resolve_cell_endpoint("cust-001") == "http://cell-1/mcp"
    # 未命中即 cell 未开通（None——调用方如实报错，不静默降级）
    assert resolve_cell_endpoint("cust-999") is None
    reset_ai_runtime()


# ------------------------------------------------------------------ executor


def test_cell_executor_not_provisioned() -> None:
    executor = CellMcpExecutor("cust-999", endpoint=None)
    assert executor.endpoint is None
    with pytest.raises(CellNotProvisionedError):
        executor.execute("search_indicators", {"q": "GDP"})


def test_cell_executor_refuses_without_platform_credential() -> None:
    """平台服务凭据未配置时拒绝执行——绝不悄悄落到客户凭据轨道。"""
    executor = CellMcpExecutor(
        "cust-001",
        endpoint="http://cell-1/mcp",
        credential="",
        http_client=httpx.Client(),
    )
    with pytest.raises(CellToolError, match="平台服务凭据未配置"):
        executor.execute("search_indicators", {"q": "GDP"})


def test_cell_executor_posts_with_platform_credential() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("Authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"result": {"rows": 3, "preview": [1, 2]}})

    executor = CellMcpExecutor(
        "cust-001",
        endpoint="http://cell-1/mcp",
        credential="platform-secret",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    result = executor.execute("search_indicators", {"q": "GDP 人均"})
    assert result == {"rows": 3, "preview": [1, 2]}
    assert seen["url"] == "http://cell-1/mcp"
    assert seen["auth"] == "Bearer platform-secret"
    assert seen["body"] == {"tool": "search_indicators", "arguments": {"q": "GDP 人均"}}


def test_cell_executor_unwraps_plain_dict_and_errors() -> None:
    executor = CellMcpExecutor(
        "cust-001",
        endpoint="http://cell-1/mcp",
        credential="platform-secret",
        http_client=httpx.Client(
            transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"ok": True}))
        ),
    )
    assert executor.execute("t", {}) == {"ok": True}

    # 非 2xx / 不可达 / 非 JSON / 形态不合契约 → CellToolError（如实上抛）
    for response, pattern in [
        (httpx.Response(500, text="boom"), "返回 500"),
        (httpx.Response(200, text="not-json"), "非 JSON"),
        (httpx.Response(200, json=[1, 2]), "不合契约"),
    ]:
        bad = CellMcpExecutor(
            "cust-001",
            endpoint="http://cell-1/mcp",
            credential="platform-secret",
            http_client=httpx.Client(
                transport=httpx.MockTransport(lambda r, resp=response: resp)
            ),
        )
        with pytest.raises(CellToolError, match=pattern):
            bad.execute("t", {})

    def unreachable(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    offline = CellMcpExecutor(
        "cust-001",
        endpoint="http://cell-1/mcp",
        credential="platform-secret",
        http_client=httpx.Client(transport=httpx.MockTransport(unreachable)),
    )
    with pytest.raises(CellToolError, match="不可达"):
        offline.execute("t", {})


# ------------------------------------------------------------------ llm


def _gateway(handler) -> TokenGatewayLlmClient:
    return TokenGatewayLlmClient(
        base_url="https://token.example",
        api_key="gw-key",
        model="test-model",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def test_llm_client_request_shape_and_tool_calls_parse() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("Authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call-1",
                                    "function": {
                                        "name": "dashboard_spec_create",
                                        "arguments": json.dumps(
                                            {"title": "GDP 对比", "spec": {"indicators": ["IND-GDP"]}},
                                            ensure_ascii=False,
                                        ),
                                    },
                                }
                            ],
                        }
                    }
                ]
            },
        )

    client = _gateway(handler)
    message = client.complete(
        [{"role": "user", "content": "建个仪表盘"}], tools=TOOL_SCHEMAS
    )
    assert seen["url"] == "https://token.example/v1/chat/completions"
    assert seen["auth"] == "Bearer gw-key"
    assert seen["body"]["model"] == "test-model"
    assert seen["body"]["tools"] == TOOL_SCHEMAS
    assert message.has_tool_calls
    call = message.tool_calls[0]
    assert call.id == "call-1"
    assert call.name == "dashboard_spec_create"
    assert call.arguments == {"title": "GDP 对比", "spec": {"indicators": ["IND-GDP"]}}


def test_llm_client_plain_answer() -> None:
    client = _gateway(
        lambda r: httpx.Response(
            200, json={"choices": [{"message": {"content": "已建好"}}]}
        )
    )
    message = client.complete([{"role": "user", "content": "hi"}], tools=[])
    assert message.text() == "已建好"
    assert not message.has_tool_calls


@pytest.mark.parametrize(
    "handler, pattern",
    [
        (lambda r: httpx.Response(503, text="down"), "返回 503"),
        (
            lambda r: httpx.Response(200, json={"unexpected": True}),
            "不合 OpenAI 契约",
        ),
        (
            lambda r: httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {
                                "content": None,
                                "tool_calls": [
                                    {
                                        "id": "c",
                                        "function": {
                                            "name": "t",
                                            "arguments": "not-json",
                                        },
                                    }
                                ],
                            }
                        }
                    ]
                },
            ),
            "tool_calls",
        ),
    ],
)
def test_llm_client_errors(handler, pattern) -> None:
    with pytest.raises(LlmGatewayError, match=pattern):
        _gateway(handler).complete([{"role": "user", "content": "hi"}], tools=[])


def test_llm_client_unreachable() -> None:
    def unreachable(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    with pytest.raises(LlmGatewayError, match="不可达"):
        _gateway(unreachable).complete([{"role": "user", "content": "hi"}], tools=[])


# ------------------------------------------------------------------ tools


def test_tool_schemas_are_the_five_artifact_kinds() -> None:
    names = {t["function"]["name"] for t in TOOL_SCHEMAS}
    assert names == set(ARTIFACT_TOOL_KINDS)
    assert names == {
        "dashboard_spec_create",
        "composite_indicator_create",
        "research_report_create",
        "alert_rule_create",
        "refresh_schedule_create",
    }
    for schema in TOOL_SCHEMAS:
        params = schema["function"]["parameters"]
        assert set(params["required"]) == {"title", "spec"}
        assert params["properties"]["spec"]["type"] == "object"


@pytest.mark.parametrize(
    "args, expect_error",
    [
        ({"title": "T", "spec": {"a": 1}}, None),
        ({"spec": {"a": 1}}, "缺少非空 title"),
        ({"title": "  ", "spec": {}}, "缺少非空 title"),
        ({"title": "T"}, "缺少非空 spec"),
        ({"title": "T", "spec": "文本不是对象"}, "缺少非空 spec"),
        ("不是对象", "必须是 JSON 对象"),
    ],
)
def test_validate_artifact_args(args, expect_error) -> None:
    error = validate_artifact_args("dashboard_spec_create", args)
    if expect_error is None:
        assert error is None
    else:
        assert error is not None and expect_error in error


def test_stage_artifact_roundtrip() -> None:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    AiBase.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine, expire_on_commit=False)()

    result = stage_artifact(
        db,
        conversation_id=1,
        customer_id="cust-001",
        tool_name="refresh_schedule_create",
        args={"title": "每日 9 点刷新", "spec": {"cron": "0 9 * * *", "tz": "Asia/Shanghai"}},
    )
    assert result["ok"] is True
    assert result["kind"] == "refresh_schedule"
    assert result["status"] == "draft"
    row = db.get(AIDraftArtifact, result["artifact_id"])
    assert row.kind == "refresh_schedule"
    assert row.customer_id == "cust-001"
    assert row.spec["title"] == "每日 9 点刷新"
    assert row.spec["spec"]["tz"] == "Asia/Shanghai"
    assert row.status == "draft"

    # 不合法入参：拒绝暂存（不留半成品），表里不多一行
    bad = stage_artifact(
        db, conversation_id=1, customer_id="cust-001",
        tool_name="dashboard_spec_create", args={"title": ""},
    )
    assert bad["ok"] is False and "title" in bad["error"]
    assert len(db.query(AIDraftArtifact).all()) == 1


# ------------------------------------------------------------------ 迁移链


@pytest.fixture
def migrated_sqlite(tmp_path, monkeypatch):
    """对临时库跑 alembic upgrade head（当前链 0001→0006），返回连接串。"""
    db_url = f"sqlite:///{tmp_path}/migration.db"
    monkeypatch.setenv("DATABASE_URL", db_url)
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "alembic"))
    command.upgrade(cfg, "head")
    return db_url


def test_migration_0005_creates_ai_tables(migrated_sqlite) -> None:
    engine = create_engine(migrated_sqlite)
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    assert {
        "ai_conversations",
        "ai_messages",
        "ai_draft_artifacts",
        "alembic_version",
    } <= tables

    assert {c["name"] for c in inspector.get_columns("ai_conversations")} == {
        "id", "customer_id", "title", "created_at",
    }
    assert {c["name"] for c in inspector.get_columns("ai_messages")} == {
        "id", "conversation_id", "role", "content", "created_at",
    }
    assert {c["name"] for c in inspector.get_columns("ai_draft_artifacts")} == {
        "id", "conversation_id", "customer_id", "kind", "spec", "status", "created_at",
    }
    with engine.connect() as conn:
        version = conn.exec_driver_sql("SELECT version_num FROM alembic_version").scalar()
    # 迁移链只增不改：head 随链推进（indicator-caliber-unification 2.1 起 = 0010_catalog_source_db）
    assert version == "0010_catalog_source_db"


def _cfg() -> Config:
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "alembic"))
    return cfg


def test_migration_0005_downgrade_drops_ai_tables(migrated_sqlite, monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", migrated_sqlite)
    command.downgrade(_cfg(), "0004_billing")
    inspector = inspect(create_engine(migrated_sqlite))
    tables = set(inspector.get_table_names())
    assert "ai_conversations" not in tables
    assert "ai_messages" not in tables
    assert "ai_draft_artifacts" not in tables
    assert "billing_plans" in tables  # 前置迁移不受影响
