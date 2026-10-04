"""cell 侧工具执行出口：``CellMcpExecutor``（ToolExecutor 生产实现）。

把 LLM 的工具调用打到**该企业 cell 的 MCP 端点**；端点由
:func:`resolve_cell_endpoint` 按 customer_id 解析（v1 = env
``AI_CELL_ENDPOINT_MAP`` 映射），未配置即 cell 未开通。

计量归属：本执行器所有调用统一携带**平台服务凭据**
（env ``AI_PLATFORM_CREDENTIAL``）——AI 探索不计费（探索行数归集到
平台轨道；真正的计量发生在 registry audit 侧，凭据是平台身份，
绝不落到客户账单）。产物物化走客户凭据是任务 5.6 的活。
外部 HTTP 依赖在测试中经注入的 httpx 客户端 mock。
"""

from __future__ import annotations

import os
from typing import Any

import httpx

from .settings import get_settings, parse_endpoint_map

#: cell 未开通时对话里的常量如实回复（不调 LLM、不产生任何工具执行）
CELL_NOT_PROVISIONED_MESSAGE = (
    "该企业尚未开通数据 cell，AI 构建暂不可用。请联系平台开通 cell 后再试。"
)


class CellNotProvisionedError(RuntimeError):
    """该企业没有 cell MCP 端点（未开通）。"""


class CellToolError(RuntimeError):
    """cell MCP 端点返回非 2xx 或响应不合契约（如实上抛给循环回灌）。"""


def resolve_cell_endpoint(
    customer_id: str, *, endpoint_map: str | dict[str, str] | None = None
) -> str | None:
    """v1：customer_id → cell MCP 端点；映射来自 ``AI_CELL_ENDPOINT_MAP``。

    返回 None 即该企业 cell 未开通（调用方须如实报错，不得静默降级）。
    """
    raw = endpoint_map if endpoint_map is not None else get_settings().ai_cell_endpoint_map
    return parse_endpoint_map(raw).get(customer_id)


class CellMcpExecutor:
    """ToolExecutor 生产实现：工具调用 → 该企业 cell 的 MCP 端点。

    凭据固定走平台服务身份（AI_PLATFORM_CREDENTIAL，见模块 docstring 的
    计量归属说明）；HTTP 客户端可注入（httpx mock），便于全离线测试。
    """

    def __init__(
        self,
        customer_id: str,
        *,
        endpoint: str | None = None,
        credential: str | None = None,
        http_client: httpx.Client | None = None,
        timeout: float = 10.0,
    ) -> None:
        self._customer_id = customer_id
        self._endpoint = endpoint if endpoint is not None else resolve_cell_endpoint(customer_id)
        self._credential = (
            credential if credential is not None else get_settings().ai_platform_credential
        )
        self._owns_http = http_client is None
        self._http = http_client or httpx.Client(timeout=timeout)

    @property
    def endpoint(self) -> str | None:
        return self._endpoint

    def close(self) -> None:
        if self._owns_http:
            self._http.close()

    def execute(self, tool_name: str, args: dict) -> dict:
        """执行一次 cell 工具调用，返回 MCP 端点的 JSON 结果 dict。

        端点契约（v1 约定）：``POST {endpoint}`` body
        ``{"tool": name, "arguments": args}``，鉴权 ``Authorization:
        Bearer <AI_PLATFORM_CREDENTIAL>``（平台凭据轨道）。
        """
        if not self._endpoint:
            raise CellNotProvisionedError(
                f"customer {self._customer_id} 的 cell 未开通（无 MCP 端点）"
            )
        if not self._credential:
            raise CellToolError(
                "平台服务凭据未配置（AI_PLATFORM_CREDENTIAL），拒绝以客户凭据执行 AI 探索"
            )
        body = {"tool": tool_name, "arguments": args}
        try:
            resp = self._http.post(
                self._endpoint,
                json=body,
                headers={"Authorization": f"Bearer {self._credential}"},
            )
        except httpx.HTTPError as exc:
            raise CellToolError(f"cell MCP 端点不可达: {exc}") from exc
        if resp.status_code >= 400:
            raise CellToolError(
                f"cell MCP 端点返回 {resp.status_code}: {resp.text[:200]}"
            )
        try:
            payload: Any = resp.json()
        except ValueError as exc:
            raise CellToolError("cell MCP 端点返回非 JSON") from exc
        if isinstance(payload, dict) and isinstance(payload.get("result"), dict):
            return payload["result"]
        if isinstance(payload, dict):
            return payload
        raise CellToolError("cell MCP 端点返回形态不合契约（需 JSON 对象）")
