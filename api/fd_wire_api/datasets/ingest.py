"""客户数据集引擎通道：``EngineToolClient``（契约 §3.1，唯一数据通道）。

平台侧**永不直读** cell 数据卷：一切族数据面读写都经该客户端打
**该企业 cell 的 MCP 端点**（registry wire 入口，复用 AI 轨道）：

- 端点解析：``AI_CELL_ENDPOINT_MAP``（customer_id → registry wire 入口），
  经 ``ai.executor.resolve_cell_endpoint`` 复用同一解析纪律。
- 凭据：``AI_PLATFORM_CREDENTIAL``（平台服务身份，计量归集轨，**不计费**）。
- 报文：与 ``ai/executor.py`` 同轨的 per-tool 简化形态
  ``{"tool": <全名>, "arguments": {...}}``——这是 registry mcp-proxy 在
  wire-platform-v1 生产 E2E（9.3）里验证过的唯一报文形态；响应兼容
  ``{"result": ...}`` 与直接业务 dict 两种（JSON-RPC 形态的 result 也认）。
  工具全名 ``daas_customer_dataset_*``（引擎侧 daas 组注册名）。
- 未配 map/凭据一律 ``EngineUnavailable`` → 路由 502 fail-closed，
  绝不静默降级、绝不假成功、绝不改走直连数据卷。

本模块不存任何客户源账密；连接器 key 与配对令牌也绝不出现在这里。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import httpx

from ..ai.executor import resolve_cell_endpoint
from ..ai.settings import get_settings as get_ai_settings


class EngineUnavailable(RuntimeError):
    """cell 未开通或平台凭据未配置——fail-closed（502）。"""


class EngineCallError(RuntimeError):
    """引擎端点不可达 / 非 2xx / 响应不合契约 / 工具报错。"""


#: 引擎工具全名（契约 §2.1，daas 组注册名）
TOOL_INGEST_BEGIN = "daas_customer_dataset_ingest_begin"
TOOL_INGEST_CHUNK = "daas_customer_dataset_ingest_chunk"
TOOL_INGEST_COMMIT = "daas_customer_dataset_ingest_commit"
TOOL_INGEST_ABORT = "daas_customer_dataset_ingest_abort"
TOOL_OVERVIEW = "daas_customer_dataset_overview"
TOOL_PREVIEW = "daas_customer_dataset_preview"
TOOL_CORRECTION_ADD = "daas_customer_dataset_correction_add"
TOOL_CORRECTION_LIST = "daas_customer_dataset_correction_list"
TOOL_CORRECTION_DANGLING = "daas_customer_dataset_correction_dangling"
TOOL_CORRECTION_REVERT = "daas_customer_dataset_correction_revert"
TOOL_DELETE = "daas_customer_dataset_delete"


def _unwrap(payload: Any) -> dict:
    """从 MCP 响应取工具结果 dict（structuredContent 优先，text JSON 兜底）。"""
    if isinstance(payload, dict) and payload.get("error"):
        error = payload["error"]
        message = error.get("message") if isinstance(error, dict) else str(error)
        raise EngineCallError(f"引擎返回 JSON-RPC 错误: {message}")
    result = payload.get("result") if isinstance(payload, dict) else None
    if result is None and isinstance(payload, dict) and "success" in payload:
        result = payload
    if isinstance(result, dict):
        structured = result.get("structuredContent")
        if isinstance(structured, dict):
            result = structured
        elif isinstance(result.get("content"), list):
            texts = [
                item.get("text", "")
                for item in result["content"]
                if isinstance(item, dict) and item.get("type") == "text"
            ]
            joined = "".join(texts).strip()
            if not joined:
                raise EngineCallError("引擎响应缺少结果内容")
            try:
                result = json.loads(joined)
            except ValueError as exc:
                raise EngineCallError("引擎结果非 JSON") from exc
    if not isinstance(result, dict):
        raise EngineCallError("引擎响应形态不合契约（需 JSON 对象）")
    if result.get("isError") is True:
        raise EngineCallError(f"引擎工具报错: {result.get('error') or result}")
    if result.get("success") is False:
        raise EngineCallError(f"引擎工具报错: {result.get('error') or result}")
    if result.get("success") is True:
        # 引擎成功信封统一剥掉，调用方只见业务字段
        return {key: value for key, value in result.items() if key != "success"}
    return result


class EngineToolClient:
    """一次同步/预览/修正操作的引擎调用句柄（HTTP 客户端可注入 mock）。"""

    def __init__(
        self,
        customer_id: str,
        *,
        endpoint: str | None = None,
        credential: str | None = None,
        http_client: httpx.Client | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._customer_id = customer_id
        self._endpoint = endpoint if endpoint is not None else None
        self._endpoint_explicit = endpoint is not None
        self._credential = credential
        self._credential_explicit = credential is not None
        self._owns_http = http_client is None
        self._http = http_client or httpx.Client(timeout=timeout)

    # ------------------------------------------------------------------ 解析

    @property
    def endpoint(self) -> str | None:
        if not self._endpoint_explicit:
            self._endpoint = resolve_cell_endpoint(self._customer_id)
        return self._endpoint

    @property
    def credential(self) -> str | None:
        if not self._credential_explicit:
            self._credential = get_ai_settings().ai_platform_credential
        return self._credential

    def close(self) -> None:
        if self._owns_http:
            self._http.close()

    # ------------------------------------------------------------------ 调用

    def call(self, tool: str, arguments: dict) -> dict:
        """``tools/call`` 一次，返回工具结果 dict；任何异常都不降级。"""
        endpoint = self.endpoint
        if not endpoint:
            raise EngineUnavailable(
                f"customer {self._customer_id} 的 cell 未开通（AI_CELL_ENDPOINT_MAP 无映射）"
            )
        credential = self.credential
        if not credential:
            raise EngineUnavailable(
                "平台服务凭据未配置（AI_PLATFORM_CREDENTIAL），拒绝以其他身份访问客户数据"
            )
        body = {"tool": tool, "arguments": arguments}
        try:
            resp = self._http.post(
                endpoint,
                json=body,
                headers={"Authorization": f"Bearer {credential}"},
            )
        except httpx.HTTPError as exc:
            raise EngineCallError(f"引擎端点不可达: {exc}") from exc
        if resp.status_code >= 400:
            raise EngineCallError(
                f"引擎端点返回 {resp.status_code}: {resp.text[:200]}"
            )
        try:
            payload: Any = resp.json()
        except ValueError as exc:
            raise EngineCallError("引擎端点返回非 JSON") from exc
        return _unwrap(payload)


#: 引擎客户端工厂（路由依赖注入；测试覆写为 fake 工厂断言调用序列）
EngineClientFactory = Callable[[str], EngineToolClient]


def get_engine_client_factory() -> EngineClientFactory:
    """FastAPI 依赖：按 customer_id 造引擎客户端。"""
    return EngineToolClient