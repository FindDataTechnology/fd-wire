"""fd_mcp_client 契约钉住（daas-deployment-profiles 任务 2.1/2.2）。

覆盖：
- gateway 模式报文契约：``{"tool","arguments"}`` 简化 POST + Bearer 平台
  凭据（逐字段断言）；响应 ``{"result":...}`` / 直接业务 dict 双形态；
- native 模式线协议：initialize 握手序列（→ Mcp-Session-Id →
  notifications/initialized → tools/call 带会话头）、惰性握手与会话复用、
  list_tools、SSE 应答解码、协议版本回退、close 释放会话；
- 错误体系：传输层失败 → ``McpTransportError``；工具报错/契约不符 →
  ``McpCallError``；
- ingest 经新客户端：env 解析复用、工具新名（无 ``daas_`` 前缀）调用
  序列、``EngineUnavailable``/``EngineCallError`` 包装不回归。

外部 HTTP 全部经注入的 httpx.MockTransport mock，绝不打真网。
"""

from __future__ import annotations

import json

import httpx
import pytest

from fd_mcp_client import (
    GatewayMcpClient,
    McpCallError,
    McpTransportError,
    NativeMcpClient,
    unwrap_tool_result,
)
from fd_wire_api.datasets.ingest import (
    TOOL_INGEST_BEGIN,
    TOOL_PREVIEW,
    EngineCallError,
    EngineToolClient,
    EngineUnavailable,
)


# ------------------------------------------------------------------ gateway


def test_gateway_call_posts_simplified_body_with_bearer() -> None:
    """gateway 报文契约：简化 POST 形态 + Bearer 头，逐字段钉住。"""
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("Authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"result": {"rows": 3, "preview": [1, 2]}})

    client = GatewayMcpClient(
        "http://cell-1/mcp",
        "platform-secret",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    result = client.call("customer_dataset_preview", {"dataset_key": "d1", "limit": 10})
    assert result == {"rows": 3, "preview": [1, 2]}
    assert seen["url"] == "http://cell-1/mcp"
    assert seen["auth"] == "Bearer platform-secret"
    assert seen["body"] == {
        "tool": "customer_dataset_preview",
        "arguments": {"dataset_key": "d1", "limit": 10},
    }
    client.close()


def test_gateway_accepts_plain_business_dict() -> None:
    """gateway 响应双形态之二：直接业务 dict 原样透传。"""
    client = GatewayMcpClient(
        "http://cell-1/mcp",
        "cred",
        http_client=httpx.Client(
            transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"ok": True}))
        ),
    )
    assert client.call("t", {}) == {"ok": True}
    client.close()


def test_gateway_transport_errors_are_mcp_transport_error() -> None:
    """不可达 / 非 2xx / 非 JSON → McpTransportError（带 label 措辞）。"""
    def unreachable(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    def _client(handler) -> GatewayMcpClient:
        return GatewayMcpClient(
            "http://cell-1/mcp",
            "cred",
            http_client=httpx.Client(transport=httpx.MockTransport(handler)),
        )

    with pytest.raises(McpTransportError, match="MCP 端点不可达"):
        _client(unreachable).call("t", {})
    with pytest.raises(McpTransportError, match="返回 500"):
        _client(lambda r: httpx.Response(500, text="boom")).call("t", {})
    with pytest.raises(McpTransportError, match="返回非 JSON"):
        _client(lambda r: httpx.Response(200, text="not-json")).call("t", {})


def test_gateway_tool_errors_are_mcp_call_error() -> None:
    """JSON-RPC error / isError / success=False → McpCallError。"""
    cases = [
        ({"jsonrpc": "2.0", "id": 1, "error": {"code": -32601, "message": "no such tool"}},
         "返回 JSON-RPC 错误"),
        ({"result": {"isError": True, "error": "行数超限"}}, "工具报错"),
        # 顶层 truthy error 键先按 JSON-RPC error 处理（与提炼源 _unwrap 同序），
        # 故 success=False 用例不带 error 键
        ({"success": False, "reason": "配额超限"}, "工具报错"),
    ]
    for payload, pattern in cases:
        client = GatewayMcpClient(
            "http://cell-1/mcp",
            "cred",
            http_client=httpx.Client(
                transport=httpx.MockTransport(lambda r, p=payload: httpx.Response(200, json=p))
            ),
        )
        with pytest.raises(McpCallError, match=pattern):
            client.call("t", {})
        client.close()


def test_gateway_close_is_safe_without_owned_client() -> None:
    """注入的 HTTP 客户端不归 gateway 关（幂等，不抛）。"""
    http = httpx.Client()
    client = GatewayMcpClient("http://cell-1/mcp", "cred", http_client=http)
    client.close()
    assert not client._owns_http
    http.close()


# ------------------------------------------------------------------ unwrap


def test_unwrap_tool_result_forms() -> None:
    """解包契约：structuredContent 优先、content 文本 JSON 兜底、信封语义。"""
    assert unwrap_tool_result({"result": {"structuredContent": {"rows": 2}}}) == {"rows": 2}
    assert unwrap_tool_result(
        {
            "result": {
                "content": [
                    {"type": "text", "text": json.dumps({"success": True, "rows": 3})}
                ],
                "isError": False,
            }
        }
    ) == {"rows": 3}  # success 信封剥掉
    assert unwrap_tool_result({"rows": 1}) == {"rows": 1}
    with pytest.raises(McpCallError, match="缺少结果内容"):
        unwrap_tool_result({"result": {"content": []}})
    with pytest.raises(McpCallError, match="结果非 JSON"):
        unwrap_tool_result({"result": {"content": [{"type": "text", "text": "nope"}]}})
    with pytest.raises(McpCallError, match="不合契约"):
        unwrap_tool_result([1, 2])


# ------------------------------------------------------------------ native


class FakeNativeServer:
    """有状态 native 服务端假实现：记录请求序列，按 MCP streamable-http 应答。"""

    def __init__(self, *, session_id: str = "sess-abc123", sse: bool = False) -> None:
        self.requests: list[dict] = []
        self.session_id = session_id
        self.sse = sse  # tools/call 以 SSE 应答（其余 JSON）

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.method == "DELETE":  # 会话释放（无体）
            self.requests.append(
                {"method": "DELETE", "headers": dict(request.headers), "body": {}}
            )
            return httpx.Response(200)
        body = json.loads(request.content)
        method = body.get("method")
        self.requests.append(
            {"method": method, "headers": dict(request.headers), "body": body}
        )
        rpc_id = body.get("id")
        if method == "initialize":
            return httpx.Response(
                200,
                headers={"Mcp-Session-Id": self.session_id},
                json={
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "result": {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {},
                        "serverInfo": {"name": "fake", "version": "1"},
                    },
                },
            )
        if method == "notifications/initialized":
            return httpx.Response(202)
        if method == "tools/call":
            payload = {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "result": {"structuredContent": {"ok": True, "rows": 3}},
            }
            if self.sse:
                return httpx.Response(
                    200,
                    headers={"Content-Type": "text/event-stream"},
                    text=f"event: message\ndata: {json.dumps(payload)}\n\n",
                )
            return httpx.Response(200, json=payload)
        if method == "tools/list":
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "result": {
                        "tools": [
                            {
                                "name": "customer_dataset_overview",
                                "description": "概览",
                                "inputSchema": {"type": "object"},
                            }
                        ]
                    },
                },
            )
        return httpx.Response(404, text="unknown")


def _native(server: FakeNativeServer, endpoint: str = "http://cell-1") -> NativeMcpClient:
    return NativeMcpClient(
        endpoint,
        credential="platform-secret",
        http_client=httpx.Client(transport=httpx.MockTransport(server.handler)),
    )


def test_native_handshake_sequence_then_call_with_session_header() -> None:
    """握手序列钉住：initialize → notifications/initialized（带会话头）→
    tools/call（带会话头）；端点自动补 /mcp；结果经统一解包。"""
    server = FakeNativeServer()
    client = _native(server)  # 故意不给 /mcp 后缀
    try:
        result = client.call("customer_dataset_overview", {"dataset_key": "d1"})
        assert result == {"ok": True, "rows": 3}
        assert [r["method"] for r in server.requests] == [
            "initialize",
            "notifications/initialized",
            "tools/call",
        ]
        init = server.requests[0]
        assert init["body"]["jsonrpc"] == "2.0"
        assert init["body"]["params"]["protocolVersion"] == "2025-06-18"
        assert init["body"]["params"]["clientInfo"]["name"] == "fd-wire-api"
        # 端点归一：/mcp 自动补齐
        assert client.endpoint == "http://cell-1/mcp"
        assert str(server.requests[0].get("headers", {}))  # headers 记录存在
        # initialized 通知与会话头
        note = server.requests[1]
        assert note["headers"].get("mcp-session-id") == "sess-abc123"
        assert "id" not in note["body"]  # 通知无 id
        # tools/call 带会话头 + 简化参数进 JSON-RPC params
        call = server.requests[2]
        assert call["headers"].get("mcp-session-id") == "sess-abc123"
        assert call["body"]["params"] == {
            "name": "customer_dataset_overview",
            "arguments": {"dataset_key": "d1"},
        }
        assert client.session_id == "sess-abc123"
    finally:
        client.close()


def test_native_lazy_handshake_and_session_reuse() -> None:
    """惰性握手：构造不发包；多次调用只握手一次（会话复用）。"""
    server = FakeNativeServer()
    client = _native(server, endpoint="http://cell-1/mcp")
    assert server.requests == []  # 构造零请求
    client.call("t1", {})
    client.call("t2", {})
    client.list_tools()
    inits = [r for r in server.requests if r["method"] == "initialize"]
    assert len(inits) == 1
    assert client.session_id == "sess-abc123"
    client.close()


def test_native_list_tools() -> None:
    server = FakeNativeServer()
    client = _native(server)
    try:
        tools = client.list_tools()
        assert tools == [
            {
                "name": "customer_dataset_overview",
                "description": "概览",
                "inputSchema": {"type": "object"},
            }
        ]
        assert server.requests[-1]["method"] == "tools/list"
        assert server.requests[-1]["headers"].get("mcp-session-id") == "sess-abc123"
    finally:
        client.close()


def test_native_accept_header_pinned() -> None:
    """请求头契约：``Accept: application/json, text/event-stream``（既有一致）。"""
    server = FakeNativeServer()
    client = _native(server)
    try:
        client.call("t", {})
    finally:
        client.close()
    for record in server.requests:
        if record["method"] == "DELETE":  # 会话释放请求无 JSON-RPC 头契约
            continue
        assert record["headers"].get("accept") == "application/json, text/event-stream"
        assert record["headers"].get("authorization") == "Bearer platform-secret"


def test_native_sse_response_decoded() -> None:
    """streamable-http SSE 应答（data: 行）解出同一 JSON-RPC 消息。"""
    server = FakeNativeServer(sse=True)
    client = _native(server)
    try:
        assert client.call("t", {}) == {"ok": True, "rows": 3}
    finally:
        client.close()


def test_native_protocol_version_fallback() -> None:
    """首档协议版本被拒（400 + protocol 字样）→ 自动试下一档。"""
    server = FakeNativeServer()
    attempts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if body.get("method") == "initialize":
            version = body["params"]["protocolVersion"]
            attempts.append(version)
            if version == "2025-06-18":
                return httpx.Response(400, text="unsupported protocol version")
            return httpx.Response(
                200,
                headers={"Mcp-Session-Id": "sess-fb"},
                json={"jsonrpc": "2.0", "id": body["id"], "result": {}},
            )
        if body.get("method") == "notifications/initialized":
            return httpx.Response(202)
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": body["id"],
                "result": {"structuredContent": {"ok": True}},
            },
        )

    client = NativeMcpClient(
        "http://cell-1/mcp",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    try:
        client.call("t", {})
        assert attempts == ["2025-06-18", "2025-03-26"]
        assert client.session_id == "sess-fb"
    finally:
        client.close()


def test_native_transport_errors() -> None:
    """握手不可达 / 非 2xx / 缺会话头 → McpTransportError。"""
    def unreachable(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    def _client(handler) -> NativeMcpClient:
        return NativeMcpClient(
            "http://cell-1/mcp",
            http_client=httpx.Client(transport=httpx.MockTransport(handler)),
        )

    with pytest.raises(McpTransportError, match="MCP 端点不可达"):
        _client(unreachable).call("t", {})
    with pytest.raises(McpTransportError, match="initialize 返回 503"):
        _client(lambda r: httpx.Response(503, text="down")).call("t", {})
    with pytest.raises(McpTransportError, match="Mcp-Session-Id"):
        _client(
            lambda r: httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {}})
        ).call("t", {})


def test_native_tool_error_is_mcp_call_error() -> None:
    """tools/call 的 JSON-RPC error 对象 / isError → McpCallError。"""
    def rpc_error(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if body.get("method") == "initialize":
            return httpx.Response(
                200,
                headers={"Mcp-Session-Id": "s"},
                json={"jsonrpc": "2.0", "id": body["id"], "result": {}},
            )
        if body.get("method") == "notifications/initialized":
            return httpx.Response(202)
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": body["id"],
                "error": {"code": -32000, "message": "tool exploded"},
            },
        )

    client = NativeMcpClient(
        "http://cell-1/mcp", http_client=httpx.Client(transport=httpx.MockTransport(rpc_error))
    )
    with pytest.raises(McpCallError, match="tool exploded"):
        client.call("t", {})
    client.close()


def test_native_close_deletes_session_and_is_idempotent() -> None:
    server = FakeNativeServer()
    client = _native(server)
    client.call("t", {})
    client.close()
    client.close()  # 幂等
    deletes = [r for r in server.requests if r["method"] == "DELETE"]
    assert len(deletes) == 1
    assert deletes[0]["headers"].get("mcp-session-id") == "sess-abc123"


# ------------------------------------------------------------------ ingest 经新客户端


@pytest.fixture()
def engine_env(monkeypatch):
    """配好 cell 端点映射与平台凭据（env 复用纪律：解析留在调用方）。"""
    monkeypatch.setenv(
        "AI_CELL_ENDPOINT_MAP", "cust-001=http://registry.example/mcp-proxy/cell-cust-001/mcp"
    )
    monkeypatch.setenv("AI_PLATFORM_CREDENTIAL", "platform-service-credential")
    from fd_wire_api.ai.settings import get_settings as ai_get_settings

    ai_get_settings.cache_clear()
    yield
    ai_get_settings.cache_clear()


def test_engine_client_call_sequence_with_renamed_tools(engine_env) -> None:
    """ingest 走 fd_mcp_client gateway：工具新名（无 daas_ 前缀）+ 简化报文 +
    平台凭据 + env 解析；引擎 success 信封剥掉。"""
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(
            {
                "url": str(request.url),
                "auth": request.headers.get("Authorization"),
                "body": body,
            }
        )
        result_text = json.dumps({"success": True, "ingest_id": "ing-1", "rows": 2})
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "content": [{"type": "text", "text": result_text}],
                    "isError": False,
                },
            },
        )

    client = EngineToolClient("cust-001", http_client=httpx.Client(
        transport=httpx.MockTransport(handler)
    ))
    try:
        begin = client.call(TOOL_INGEST_BEGIN, {"dataset_key": "d1", "columns": []})
        assert TOOL_INGEST_BEGIN == "customer_dataset_ingest_begin"
        assert begin == {"ingest_id": "ing-1", "rows": 2}
        client.call(TOOL_PREVIEW, {"dataset_key": "d1", "limit": 10})
        assert [c["body"]["tool"] for c in seen] == [
            "customer_dataset_ingest_begin",
            "customer_dataset_preview",
        ]
        assert seen[0]["url"] == "http://registry.example/mcp-proxy/cell-cust-001/mcp"
        assert seen[0]["auth"] == "Bearer platform-service-credential"
        assert seen[0]["body"]["arguments"] == {"dataset_key": "d1", "columns": []}
        assert not any("daas_" in json.dumps(c["body"]) for c in seen)
    finally:
        client.close()


def test_engine_client_error_mapping_unchanged(engine_env) -> None:
    """错误包装不回归：传输层/工具报错 → EngineCallError；未配置 → EngineUnavailable。"""
    def _client(handler) -> EngineToolClient:
        return EngineToolClient(
            "cust-001", http_client=httpx.Client(transport=httpx.MockTransport(handler))
        )

    with pytest.raises(EngineCallError, match="引擎端点返回 500"):
        _client(lambda r: httpx.Response(500, text="boom")).call("t", {})
    with pytest.raises(EngineCallError, match="引擎工具报错: 行数超过上限"):
        _client(
            lambda r: httpx.Response(
                200,
                json={"result": {"structuredContent": {"success": False, "error": "行数超过上限"}}},
            )
        ).call("t", {})
    with pytest.raises(EngineUnavailable, match="AI_CELL_ENDPOINT_MAP 无映射"):
        EngineToolClient("cust-999").call("t", {})


def test_engine_client_refuses_without_platform_credential(engine_env, monkeypatch) -> None:
    monkeypatch.delenv("AI_PLATFORM_CREDENTIAL", raising=False)
    from fd_wire_api.ai.settings import get_settings as ai_get_settings

    ai_get_settings.cache_clear()
    try:
        client = EngineToolClient(
            "cust-001",
            endpoint="http://cell-1/mcp",
            http_client=httpx.Client(),
        )
        with pytest.raises(EngineUnavailable, match="AI_PLATFORM_CREDENTIAL"):
            client.call("t", {})
    finally:
        ai_get_settings.cache_clear()
