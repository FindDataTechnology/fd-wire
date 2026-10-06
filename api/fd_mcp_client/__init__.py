"""fd_mcp_client：平台服务调用 MCP 端点的**唯一**客户端包（D6-D9）。

双模式契约（spec「统一客户端双模式」，单测钉住）：

- **gateway 模式**（:class:`GatewayMcpClient`）：经 registry wire 入口，
  ``{"tool", "arguments"}`` 简化 POST + Bearer 凭据，**仅** ``call``；
  响应兼容 ``{"result": ...}`` 与直接业务 dict。
- **native 模式**（:class:`NativeMcpClient`）：标准 MCP streamable-http，
  initialize 握手 + 会话复用 + ``tools/call`` + ``list_tools``；不经
  wire 入口。

计量轨道不变量（spec 同名 Requirement，包 docstring 声明、代码不强制）：

- gateway = **计量轨**：平台服务凭据归集，对 cell 的客户数据读取一律走
  此轨（datasets ingest、AI 探索）；
- native = 平台内部数据写入通道 + 开发/测试直连，不经 wire 入口、不产生
  计量记录，SHALL NOT 用于对 cell 的客户数据读取；
- 两种模式 SHALL NOT 混用身份凭据。

纯包约束：endpoint / credential / HTTP 客户端全部**构造注入**，本包不读
任何 env——env 解析（``AI_CELL_ENDPOINT_MAP`` / ``AI_PLATFORM_CREDENTIAL``，
语义归本包所有、见 D9）留在调用方，部署零改动。

错误体系（:mod:`fd_mcp_client.errors`）：

- :class:`McpTransportError`：端点不可达 / 非 2xx / 非 JSON / 握手失败；
- :class:`McpCallError`：JSON-RPC error / 工具报错 / 响应不合契约。

调用方包装成自己的领域错误（``EngineUnavailable``/``EngineCallError``、
``CellNotProvisionedError``/``CellToolError``），fail-closed 路由语义留在
调用方，行为与迁移前逐字对齐。
"""

from __future__ import annotations

from ._result import unwrap_tool_result
from .errors import McpCallError, McpTransportError
from .gateway import GatewayMcpClient
from .native import (
    MCP_PROTOCOL_VERSIONS,
    SESSION_HEADER,
    NativeMcpClient,
    normalize_mcp_endpoint,
)

__all__ = [
    "MCP_PROTOCOL_VERSIONS",
    "SESSION_HEADER",
    "GatewayMcpClient",
    "McpCallError",
    "McpTransportError",
    "NativeMcpClient",
    "normalize_mcp_endpoint",
    "unwrap_tool_result",
]
