"""gateway 模式客户端：经 registry wire 入口的 **call-only** 简化调用。

报文契约（与 ``ai/executor.py`` 生产验证形态逐字节一致，D7）：

- 请求：``POST {endpoint}``，JSON body ``{"tool": <工具全名>, "arguments":
  {...}}``，鉴权 ``Authorization: Bearer <credential>``；
- 响应：JSON 对象，兼容 ``{"result": ...}``（JSON-RPC 形态信封）与直接
  业务 dict 两种，统一经 :func:`unwrap_tool_result` 解包；
- **只有** ``call(tool, arguments)``——发现类操作（list_tools 等）一律走
  native 模式（:mod:`fd_mcp_client.native`），计量门没有理由处理 list 请求，
  契约面最小化。

计量轨道不变量（spec「计量轨道不变量」）：gateway 模式是**计量轨**——
平台服务凭据归集，用量入平台审计侧，绝不落客户账单。对 cell 的客户数据
读取 SHALL 走本模式；凭据身份不与 native 混用。包不强制（无 auth 边界可
依），由调用方（executor / ingest）保证。

错误：传输层失败（不可达 / 非 2xx / 非 JSON）→ :class:`McpTransportError`；
工具报错 / 响应不合契约 → :class:`McpCallError`。``label`` 用于错误消息
前缀（如 ``"cell MCP 端点"`` / ``"引擎端点"``），调用方透传领域措辞。

纯包约束：endpoint / credential / http 客户端全部构造注入，**不读任何
env**——env 解析（``AI_CELL_ENDPOINT_MAP`` / ``AI_PLATFORM_CREDENTIAL``）
留在调用方，部署零改动。
"""

from __future__ import annotations

from typing import Any

import httpx

from ._result import unwrap_tool_result
from .errors import McpTransportError


class GatewayMcpClient:
    """gateway 简化形态的 MCP 工具调用客户端（HTTP 客户端可注入 mock）。

    ``http_client`` 缺省时自建 :class:`httpx.Client` 并持有（``close()``
    负责释放）；注入时不持有、不关闭（所有权归注入方）。
    """

    def __init__(
        self,
        endpoint: str | None,
        credential: str | None,
        *,
        http_client: httpx.Client | None = None,
        timeout: float = 30.0,
        label: str = "MCP 端点",
    ) -> None:
        self._endpoint = endpoint
        self._credential = credential
        self._label = label
        self._owns_http = http_client is None
        self._http = http_client or httpx.Client(timeout=timeout)

    @property
    def endpoint(self) -> str | None:
        return self._endpoint

    def close(self) -> None:
        """释放自建的 HTTP 客户端（注入的客户端不归本客户端管）。"""
        if self._owns_http:
            self._http.close()

    def call(self, tool: str, arguments: dict) -> dict:
        """``tools/call`` 一次（gateway 简化形态），返回工具结果 dict。

        任何异常都不降级：不可达 / 非 2xx / 非 JSON →
        :class:`McpTransportError`；工具报错 / 响应不合契约 →
        :class:`McpCallError`。
        """
        body: dict[str, Any] = {"tool": tool, "arguments": arguments}
        headers = {"Authorization": f"Bearer {self._credential}"} if self._credential else {}
        try:
            resp = self._http.post(self._endpoint or "", json=body, headers=headers)
        except httpx.HTTPError as exc:
            raise McpTransportError(f"{self._label}不可达: {exc}") from exc
        if resp.status_code >= 400:
            raise McpTransportError(
                f"{self._label}返回 {resp.status_code}: {resp.text[:200]}"
            )
        try:
            payload: Any = resp.json()
        except ValueError as exc:
            raise McpTransportError(f"{self._label}返回非 JSON") from exc
        return unwrap_tool_result(payload)


__all__ = ["GatewayMcpClient"]
