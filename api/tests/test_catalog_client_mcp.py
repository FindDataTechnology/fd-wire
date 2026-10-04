"""HttpRegistryClient 的 MCP streamable-http 全 mock 测试。

线格式按 fastmcp 3.4.4 / mcp 1.28.1 实测（2026-10）模拟，全程
httpx.MockTransport，无真实网络：
- initialize → 200 + ``text/event-stream``（``event: message`` / ``data:`` 行）
  + ``Mcp-Session-Id`` 响应头；
- notifications/initialized → 202 无体；
- tools/call → 200 + SSE，结果在 ``structuredContent.result``
  （fastmcp 对 list 返回值的包装），``content[0].text`` 同载荷。
覆盖：握手→tools/call→解析→映射到 ConceptRecord/IndicatorSnapshot 字段、
limit/offset 翻页、Bearer 凭据、端点归一、错误面、水位本地过滤。
"""

from __future__ import annotations

import json
from datetime import timedelta

import httpx
import pytest

from fd_wire_api.catalog.client import HttpRegistryClient, mcp_concept_row_to_record, utcnow


def native_row(code: str, entity_type: str = "country", **overrides) -> dict:
    """Concept.toDict() 形状的权威行（+ family label，list_concepts 原样返回）。"""
    row = {
        "id": 1,
        "code": code,
        "name_en": f"Name {code}",
        "name_zh": f"指标-{code}",
        "category": "macro",
        "unit": "USD",
        "measure": "nominal_current",
        "frequency": "annual",
        "concept_code": "GDP",
        "entity_type": entity_type,
        "source": "vocabulary",
        "verified": True,
        "deprecated": False,
        "concept_family_label": "GDP",
    }
    row.update(overrides)
    return row


def registry_row(code: str, **overrides) -> dict:
    """统一注册目录（registry_entries）行：id/entity_type 为 None，带 native_code。"""
    row = {
        "id": None,
        "code": code,
        "name_en": f"Registry {code}",
        "name_zh": f"注册-{code}",
        "category": "energy",
        "unit": None,
        "measure": None,
        "frequency": "annual",
        "concept_code": None,
        "concept_family_label": None,
        "entity_type": None,
        "source": "registry",
        "verified": True,
        "deprecated": False,
        "native_code": f"WB.{code}",
        "source_db": "world_bank",
        "read_via": "wb_read",
    }
    row.update(overrides)
    return row


def sse(payload: dict) -> httpx.Response:
    """以 fastmcp streamable-http 的 SSE 框架应答。"""
    body = f"event: message\ndata: {json.dumps(payload)}\n\n"
    return httpx.Response(200, headers={"content-type": "text/event-stream"}, text=body)


class FakeAuthority:
    """按真实线格式应答的 mock 权威源（记录全部请求供断言）。"""

    def __init__(self, rows: list[dict] | None = None, *, token: str = "svc-token"):
        self.rows = list(rows or [])
        self.expected_token = token
        self.requests: list[httpx.Request] = []
        # 注入失败模式：("rpc_error", msg) / ("tool_is_error", msg) / ("http_401",)
        self.fail_mode: tuple | None = None
        self.reject_first_versions = 0  # 前 N 次 initialize 以 400 版本错拒绝
        self.json_body = False  # True = 以纯 JSON（非 SSE）应答 RPC

    def _rpc_ok(self, rpc_id: int, result: dict) -> httpx.Response:
        payload = {"jsonrpc": "2.0", "id": rpc_id, "result": result}
        if self.json_body:
            return httpx.Response(200, json=payload)
        return sse(payload)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.method == "DELETE":
            return httpx.Response(200)

        # 网关/服务端 Bearer 校验：凭据不匹配 → 401（与公网入口行为一致）
        auth = request.headers.get("authorization", "")
        if self.expected_token and auth != f"Bearer {self.expected_token}":
            return httpx.Response(401, json={"error": "unauthorized"})

        message = json.loads(request.content)
        method = message.get("method")

        if method == "initialize":
            if self.reject_first_versions > 0:
                self.reject_first_versions -= 1
                return httpx.Response(
                    400, text="Bad Request: Unsupported protocol version"
                )
            result = {
                "protocolVersion": message["params"]["protocolVersion"],
                "capabilities": {},
                "serverInfo": {"name": "fd-open-data-mcp", "version": "3.4.4"},
            }
            return httpx.Response(
                200,
                headers={
                    "Mcp-Session-Id": "sess-abc-123",
                    "content-type": "text/event-stream",
                },
                text=f'event: message\ndata: {json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": result})}\n\n',
            )

        if method == "notifications/initialized":
            return httpx.Response(202)

        if method == "tools/call":
            if self.fail_mode and self.fail_mode[0] == "rpc_error":
                return sse(
                    {
                        "jsonrpc": "2.0",
                        "id": message["id"],
                        "error": {"code": -32602, "message": self.fail_mode[1]},
                    }
                )
            args = message["params"]["arguments"]
            offset, limit = int(args.get("offset", 0)), int(args.get("limit", 500))
            page = self.rows[offset : offset + limit]
            if self.fail_mode and self.fail_mode[0] == "tool_is_error":
                result = {
                    "isError": True,
                    "content": [{"type": "text", "text": self.fail_mode[1]}],
                }
            else:
                result = {
                    "isError": False,
                    "content": [{"type": "text", "text": json.dumps(page)}],
                    "structuredContent": {"result": page},
                }
            return self._rpc_ok(message["id"], result)

        return httpx.Response(404, text=f"unexpected method {method}")

    def calls(self, method: str) -> list[httpx.Request]:
        out = []
        for req in self.requests:
            if req.method != "POST":
                continue
            body = json.loads(req.content)
            if body.get("method") == method:
                out.append(req)
        return out


def make_client(authority: FakeAuthority, **kwargs) -> HttpRegistryClient:
    kwargs.setdefault("token", authority.expected_token)
    kwargs.setdefault("base_url", "https://mcp.example/fd-open-data-mcp")
    return HttpRegistryClient(transport=httpx.MockTransport(authority.handler), **kwargs)


# ── 握手 → tools/call → 解析 → 映射 ────────────────────────────────────────


def test_handshake_then_list_concepts_and_field_mapping():
    authority = FakeAuthority(rows=[native_row("GDP_TOTAL"), registry_row("COAL_OUTPUT")])
    client = make_client(authority)

    batch = client.fetch_concepts()

    # 握手序列：initialize（无会话头）→ initialized（带会话头）
    init = authority.calls("initialize")
    assert len(init) == 1
    assert init[0].headers.get("mcp-session-id") is None
    assert init[0].headers.get("authorization") == "Bearer svc-token"
    init_params = json.loads(init[0].content)["params"]
    assert init_params["protocolVersion"] == "2025-06-18"
    assert len(authority.calls("notifications/initialized")) == 1
    assert authority.calls("notifications/initialized")[0].headers.get("mcp-session-id") == "sess-abc-123"

    # tools/call：limit/offset 入参 + 会话头；会话用完 DELETE 关闭
    calls = authority.calls("tools/call")
    assert len(calls) == 1
    assert json.loads(calls[0].content)["params"] == {
        "name": "list_concepts",
        "arguments": {"limit": 500, "offset": 0},
    }
    assert calls[0].headers.get("mcp-session-id") == "sess-abc-123"
    assert any(r.method == "DELETE" for r in authority.requests)

    # 映射到 ConceptRecord（IndicatorSnapshot 的同步字段来源）
    assert len(batch.items) == 2
    native, reg = batch.items
    assert native.indicator_id == "GDP_TOTAL@country@nominal_current@USD@annual"
    assert native.code == "GDP_TOTAL"
    assert native.name_zh == "指标-GDP_TOTAL" and native.name_en == "Name GDP_TOTAL"
    assert native.domain == "macro"  # domain ← 权威 category
    assert native.frequency == "annual"
    assert native.status == "verified"
    assert reg.indicator_id == "COAL_OUTPUT@annual"  # registry 行只有 code+frequency 段
    assert reg.code == "COAL_OUTPUT"
    assert reg.domain == "energy"
    assert reg.status == "verified"


def test_unverified_row_maps_to_registered_and_full_watermark_fallback():
    authority = FakeAuthority(
        rows=[native_row("PMI", verified=False, updated_at="2026-10-01T00:00:00Z")]
    )
    batch = make_client(authority).fetch_concepts()
    assert batch.items[0].status == "registered"
    assert batch.full is True
    assert batch.items[0].updated_at is not None
    assert batch.next_watermark == batch.items[0].updated_at


# ── 分页（limit/offset，无 cursor）───────────────────────────────────────────


def test_pagination_advances_offset_until_short_page():
    rows = [native_row(f"C{i:03d}") for i in range(5)]
    authority = FakeAuthority(rows=rows)
    client = make_client(authority, page_size=2)

    batch = client.fetch_concepts()

    calls = authority.calls("tools/call")
    offsets = [json.loads(c.content)["params"]["arguments"]["offset"] for c in calls]
    # 翻页：0,2（满页）→ 4（短页 1 行 < 2 即停，无需第 4 次探底）
    assert offsets == [0, 2, 4]
    assert len(batch.items) == 5
    assert {r.indicator_id.split("@")[0] for r in batch.items} == {f"C{i:03d}" for i in range(5)}


def test_exact_multiple_pages_stops_on_empty_page():
    rows = [native_row(f"C{i}") for i in range(4)]
    authority = FakeAuthority(rows=rows)
    client = make_client(authority, page_size=2)

    batch = client.fetch_concepts()

    offsets = [
        json.loads(c.content)["params"]["arguments"]["offset"]
        for c in authority.calls("tools/call")
    ]
    assert offsets == [0, 2, 4]  # 末页恰好排空 → 一次空页确认终止
    assert len(batch.items) == 4


def test_deprecated_rows_dropped_but_pagination_counts_them():
    rows = [
        native_row("KEEP_1"),
        native_row("DROP_1", deprecated=True),
        native_row("DROP_2", deprecated=True),
        native_row("KEEP_2"),
    ]
    authority = FakeAuthority(rows=rows)
    client = make_client(authority, page_size=2)

    batch = client.fetch_concepts()

    assert {r.code for r in batch.items} == {"KEEP_1", "KEEP_2"}


# ── 增量水位（权威无 updated_since 参数 → 本地过滤）────────────────────────


def test_updated_since_filters_only_rows_with_stamp():
    next_day = utcnow() + timedelta(days=1)
    rows = [
        native_row("NEW", updated_at=next_day.isoformat()),
        native_row("OLD", updated_at=(utcnow() - timedelta(days=30)).isoformat()),
        native_row("UNSTAMPED"),  # 当前真实契约：行不携带 updated_at
    ]
    authority = FakeAuthority(rows=rows)
    client = make_client(authority)

    batch = client.fetch_concepts(updated_since=utcnow())

    # 带旧时间戳的行被滤掉；无时间戳的保守保留（幂等 upsert 兜底）
    assert {r.code for r in batch.items} == {"NEW", "UNSTAMPED"}
    assert batch.full is False
    assert batch.next_watermark == next_day

    # force_full 一律全量
    full = client.fetch_concepts(updated_since=utcnow(), force_full=True)
    assert {r.code for r in full.items} == {"NEW", "OLD", "UNSTAMPED"}
    assert full.full is True


def test_watermark_falls_back_when_no_row_carries_stamp():
    authority = FakeAuthority(rows=[native_row("C1")])
    since = utcnow() - timedelta(hours=1)
    batch = make_client(authority).fetch_concepts(updated_since=since)
    assert batch.next_watermark == since


# ── 凭据与端点归一 ──────────────────────────────────────────────────────────


def test_missing_token_sends_no_authorization_header():
    authority = FakeAuthority(rows=[native_row("C1")], token="")
    client = make_client(authority, token="")
    batch = client.fetch_concepts()
    assert len(batch.items) == 1
    assert all(
        "authorization" not in r.headers for r in authority.requests if r.method == "POST"
    )


def test_wrong_token_surfaces_as_http_401():
    authority = FakeAuthority(rows=[native_row("C1")], token="right-token")
    client = make_client(authority, token="wrong-token")
    with pytest.raises(httpx.HTTPStatusError, match="401"):
        client.fetch_concepts()


def test_endpoint_normalization_appends_mcp_suffix():
    for base, expected in [
        ("https://mcp.finddatatech.cloud/fd-open-data-mcp",
         "https://mcp.finddatatech.cloud/fd-open-data-mcp/mcp"),
        ("https://mcp.finddatatech.cloud/fd-open-data-mcp/",
         "https://mcp.finddatatech.cloud/fd-open-data-mcp/mcp"),
        ("https://mcp.finddatatech.cloud/fd-open-data-mcp/mcp",
         "https://mcp.finddatatech.cloud/fd-open-data-mcp/mcp"),
        ("http://fd-open-data-mcp.mcp.svc:8899",
         "http://fd-open-data-mcp.mcp.svc:8899/mcp"),
    ]:
        authority = FakeAuthority(rows=[native_row("C1")])
        client = make_client(authority, base_url=base)
        client.fetch_concepts()
        assert authority.requests[0].url == expected


def test_token_defaults_to_settings(monkeypatch):
    from fd_wire_api.catalog import settings as catalog_settings_module

    authority = FakeAuthority(rows=[native_row("C1")], token="from-settings")
    monkeypatch.setattr(
        catalog_settings_module.settings, "indicator_registry_token", "from-settings"
    )
    client = HttpRegistryClient(
        base_url="https://mcp.example/fd-open-data-mcp",
        transport=httpx.MockTransport(authority.handler),
    )
    batch = client.fetch_concepts()
    assert len(batch.items) == 1


# ── 协议变体与错误面 ────────────────────────────────────────────────────────


def test_protocol_version_fallback_on_400():
    authority = FakeAuthority(rows=[native_row("C1")])
    authority.reject_first_versions = 1  # 2025-06-18 被拒 → 回落 2025-03-26
    client = make_client(authority)

    batch = client.fetch_concepts()

    inits = authority.calls("initialize")
    versions = [json.loads(r.content)["params"]["protocolVersion"] for r in inits]
    assert versions == ["2025-06-18", "2025-03-26"]
    assert len(batch.items) == 1


def test_plain_json_body_response_path():
    authority = FakeAuthority(rows=[native_row("C1")])
    authority.json_body = True  # 服务端以纯 JSON（非 SSE）应答
    batch = make_client(authority).fetch_concepts()
    assert len(batch.items) == 1


def test_text_block_payload_path_without_structured_content():
    """structuredContent 缺失时从 content[0].text 解析（与 fastmcp 兼容兜底）。"""
    authority = FakeAuthority(rows=[native_row("C1")])

    original_handler = authority.handler

    def text_only_handler(request: httpx.Request) -> httpx.Response:
        response = original_handler(request)
        if request.method == "POST":
            message = json.loads(request.content)
            if message.get("method") == "tools/call":
                payload = json.loads(response.text.split("data: ", 1)[1])
                payload["result"].pop("structuredContent")
                return sse(payload)
        return response

    client = HttpRegistryClient(
        base_url="https://mcp.example/fd-open-data-mcp",
        token="svc-token",
        transport=httpx.MockTransport(text_only_handler),
    )
    batch = client.fetch_concepts()
    assert len(batch.items) == 1
    assert batch.items[0].code == "C1"


def test_rpc_error_payload_raises():
    authority = FakeAuthority(rows=[native_row("C1")])
    authority.fail_mode = ("rpc_error", "unknown tool")
    with pytest.raises(RuntimeError, match="RPC error -32602: unknown tool"):
        make_client(authority).fetch_concepts()


def test_tool_is_error_result_raises():
    authority = FakeAuthority(rows=[native_row("C1")])
    authority.fail_mode = ("tool_is_error", "database unreadable")
    with pytest.raises(RuntimeError, match="database unreadable"):
        make_client(authority).fetch_concepts()


# ── 行映射单元 ──────────────────────────────────────────────────────────────


def test_long_identity_composite_gets_hash_suffix_without_collision():
    long_unit = "U" * 200
    record_a = mcp_concept_row_to_record(native_row("GDP", unit=long_unit))
    record_b = mcp_concept_row_to_record(native_row("GDP", unit="X" + long_unit))
    assert len(record_a.indicator_id) == 128
    assert len(record_b.indicator_id) == 128
    assert record_a.indicator_id != record_b.indicator_id  # 同前缀不同行不可撞


def test_row_without_code_raises():
    with pytest.raises(ValueError, match="without a usable code"):
        mcp_concept_row_to_record({"id": None, "entity_type": None})
