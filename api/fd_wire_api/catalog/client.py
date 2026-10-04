"""权威源客户端：统一指标注册目录（fd-open-data-mcp 侧 list_concepts 族）。

- ``RegistryClient`` 是协议（Protocol）：测试用内存假实现替换，生产用
  ``HttpRegistryClient``。同步器只依赖协议，不依赖 HTTP 细节。
- 权威源是 fd-open-data-mcp 的 MCP streamable-http 端点（fastmcp 3.4.4 /
  mcp 1.28.1，实测线格式 2026-10）：
  1. POST ``initialize``（JSON-RPC 2.0）→ 200，SSE 或 JSON 体携带 result，
     响应头 ``Mcp-Session-Id`` 是后续请求的会话凭证；
  2. POST ``notifications/initialized``（202 无体）；
  3. POST ``tools/call`` ``list_concepts``，参数 ``limit``/``offset``（服务端
     clamp 至 [1,1000]），「页短于 limit 即末页」翻页——无 cursor、无 total；
     结果在 ``structuredContent.result``（fastmcp 对 list 返回的包装）或
     ``content[0].text``（JSON 文本）。
- 增量游标：权威 ``list_concepts`` **没有** ``updated_since`` 参数——客户端
  每次全量翻页，行级 ``updated_at`` 存在时按 ``updated_since`` 水位本地过滤；
  行不携带该字段（当前契约，Concept.toDict / registry 行均无）时保守保留，
  交由同步器以 indicator_id 幂等 upsert。
- 凭据：``INDICATOR_REGISTRY_TOKEN`` 以 Bearer 随每个请求上行（公网入口
  网关鉴权）；空值 = 匿名。
- ``INDICATOR_REGISTRY_URL`` 指权威基地址（如
  ``https://mcp.finddatatech.cloud/fd-open-data-mcp``），``/mcp`` 后缀由
  客户端自动补齐（已带则不重复）。
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol

import httpx

from .settings import settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


@dataclass
class ConceptRecord:
    """规范化后的权威库指标记录（展示字段 + 变更时间）。"""

    indicator_id: str
    code: str = ""
    name_zh: str | None = None
    name_en: str | None = None
    description_zh: str | None = None
    description_en: str | None = None
    domain: str | None = None
    frequency: str | None = None
    time_span_start: str | None = None
    time_span_end: str | None = None
    entity_coverage_count: int | None = None
    sample_value: str | None = None
    status: str = "registered"  # verified | registered，只来自权威库
    updated_at: datetime | None = None


@dataclass
class ConceptBatch:
    """一次拉取的结果：记录集合 + 推进后的水位。"""

    items: list[ConceptRecord] = field(default_factory=list)
    next_watermark: datetime | None = None
    full: bool = False


class RegistryClient(Protocol):
    """权威源客户端协议（可 mock）。"""

    def fetch_concepts(
        self, updated_since: datetime | None = None, force_full: bool = False
    ) -> ConceptBatch:
        ...  # pragma: no cover


def _first_str(raw: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = raw.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if value is not None and not isinstance(value, (dict, list)):
            return str(value)
    return None


def _first_int(raw: dict[str, Any], *keys: str) -> int | None:
    for key in keys:
        value = raw.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.strip().isdigit():
            return int(value.strip())
    return None


def normalize_status(value: Any) -> str:
    """权威状态归一：只允许 verified | registered（保守落 registered）。"""
    text = str(value or "").strip().lower()
    return "verified" if text == "verified" else "registered"


def normalize_record(raw: dict[str, Any]) -> ConceptRecord:
    """把权威侧记录（别名容错）规范化为 ConceptRecord。"""
    indicator_id = _first_str(raw, "indicator_id", "concept_id", "identifier", "id")
    if not indicator_id:
        raise ValueError(f"authority record without a usable id: {raw!r}")
    return ConceptRecord(
        indicator_id=indicator_id,
        code=_first_str(raw, "code", "indicator_code", "concept_code") or "",
        name_zh=_first_str(raw, "name_zh", "title_zh", "label_zh", "name", "title"),
        name_en=_first_str(raw, "name_en", "title_en", "label_en"),
        description_zh=_first_str(raw, "description_zh", "summary_zh", "desc_zh"),
        description_en=_first_str(raw, "description_en", "summary_en", "desc_en", "description"),
        domain=_first_str(raw, "domain", "theme", "category"),
        frequency=_first_str(raw, "frequency", "period", "freq"),
        time_span_start=_first_str(raw, "time_span_start", "start_date", "start"),
        time_span_end=_first_str(raw, "time_span_end", "end_date", "end"),
        entity_coverage_count=_first_int(
            raw, "entity_coverage_count", "coverage_count", "entities", "entity_count"
        ),
        sample_value=_first_str(raw, "sample_value", "example_value", "sample"),
        status=normalize_status(raw.get("status")),
        updated_at=_parse_dt(raw.get("updated_at") or raw.get("updated") or raw.get("last_modified")),
    )


_LIST_KEYS = ("items", "data", "concepts", "results", "records")


def _extract_items(payload: Any) -> tuple[list[Any], str | None]:
    """从权威响应中提取记录列表与 next cursor（别名容错）。"""
    next_cursor: str | None = None
    if isinstance(payload, list):
        return payload, None
    if isinstance(payload, dict):
        next_cursor = payload.get("next_cursor") or payload.get("cursor") or payload.get("next")
        for key in _LIST_KEYS:
            value = payload.get(key)
            if isinstance(value, list):
                return value, next_cursor
        # 单条对象本身即记录
        if any(k in payload for k in ("indicator_id", "concept_id", "identifier", "id")):
            return [payload], None
    raise ValueError(f"unexpected authority payload shape: {type(payload)!r}")


# ─── MCP streamable-http 线协议（与 fd-open-data-mcp server.py 对齐） ────────

_MCP_PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
_SESSION_HEADER = "Mcp-Session-Id"
_LIST_TOOL = "list_concepts"
_TOOL_LIST_KEYS = ("result", "items", "data", "concepts", "results", "records")


def _mcp_endpoint(base_url: str) -> str:
    """归一权威基地址为 streamable-http 端点：确保以 ``/mcp`` 结尾。"""
    trimmed = (base_url or "").rstrip("/")
    if trimmed.endswith("/mcp"):
        return trimmed
    return f"{trimmed}/mcp"


def _decode_rpc_payload(resp: httpx.Response) -> dict[str, Any]:
    """解码 JSON-RPC 响应体：streamable-http 以 SSE（``data:`` 行）或纯 JSON 应答。"""
    ctype = resp.headers.get("content-type", "")
    if "text/event-stream" in ctype:
        for line in resp.text.splitlines():
            if line.startswith("data:"):
                try:
                    payload = json.loads(line[len("data:"):].strip())
                except json.JSONDecodeError:
                    continue
                if isinstance(payload, dict) and ("result" in payload or "error" in payload):
                    return payload
        raise ValueError(
            f"authority SSE response carried no JSON-RPC message: {resp.text[:200]!r}"
        )
    return resp.json()


def _raise_on_rpc_error(payload: dict[str, Any], context: str) -> None:
    error = payload.get("error")
    if isinstance(error, dict):
        raise RuntimeError(
            f"authority {context} RPC error {error.get('code')}: {error.get('message')}"
        )


def _tool_result_rows(payload: dict[str, Any], context: str = "tools/call") -> list[Any]:
    """从 ``tools/call`` 结果提取行集合：``structuredContent`` 优先，text 块兜底。"""
    result = payload.get("result")
    if not isinstance(result, dict):
        raise ValueError(f"authority {context} returned no result object: {payload!r}")
    if result.get("isError"):
        texts = [
            block.get("text", "")
            for block in result.get("content") or []
            if isinstance(block, dict)
        ]
        detail = " ".join(t for t in texts if t) or repr(result)
        raise RuntimeError(f"authority {context} tool error: {detail}")
    structured = result.get("structuredContent")
    if isinstance(structured, dict):
        for key in _TOOL_LIST_KEYS:
            if isinstance(structured.get(key), list):
                return structured[key]
    for block in result.get("content") or []:
        if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
            try:
                parsed = json.loads(block["text"])
            except json.JSONDecodeError:
                continue
            try:
                items, _cursor = _extract_items(parsed)
            except ValueError:
                continue
            return items
    raise ValueError(f"authority {context} carried no row payload")


# list_concepts 行的权威身份五元组（concepts 表唯一约束的列序）
_IDENTITY_KEYS = ("code", "entity_type", "measure", "unit", "frequency")


def _segment(row: dict[str, Any], key: str) -> str | None:
    """行的非空字符串段（None / 空白 → None）。"""
    value = row.get(key)
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    text = str(value).strip()
    return text or None


def _stable_indicator_id(composite: str) -> str:
    """五元组拼接超列宽（128）时退化为前缀 + sha1 后缀（确定性、无截断碰撞）。"""
    if len(composite) <= 128:
        return composite
    digest = hashlib.sha1(composite.encode("utf-8")).hexdigest()[:7]
    return f"{composite[:120]}~{digest}"


def mcp_concept_row_to_record(row: dict[str, Any]) -> ConceptRecord:
    """``list_concepts`` 行（Concept.toDict() / 统一注册目录行）→ ConceptRecord。

    - ``indicator_id``：权威五元组 (code, entity_type, measure, unit,
      frequency) 的非空段 ``@`` 拼接（registry 行只携带 code 段）——与权威
      唯一约束同口径，重灌权威库也稳定；
    - ``domain`` ← 权威 ``category``（registry 行即 domain）；
    - ``status`` ← 权威 ``verified``（两级口径：verified | registered）。
    """
    code = _segment(row, "code") or _segment(row, "semantic_code") or _segment(row, "native_code")
    if code is None:
        raise ValueError(f"list_concepts row without a usable code: {row!r}")
    parts = [_segment(row, key) for key in _IDENTITY_KEYS]
    composite = "@".join(part for part in parts if part)
    verified = row.get("verified")
    is_verified = verified is True or (
        isinstance(verified, str) and verified.strip().lower() == "true"
    )
    return ConceptRecord(
        indicator_id=_stable_indicator_id(composite),
        code=code,
        name_zh=_first_str(row, "name_zh"),
        name_en=_first_str(row, "name_en"),
        description_zh=_first_str(row, "description_zh"),
        description_en=_first_str(row, "description_en"),
        domain=_first_str(row, "domain", "category"),
        frequency=_first_str(row, "frequency"),
        time_span_start=_first_str(row, "time_span_start"),
        time_span_end=_first_str(row, "time_span_end"),
        entity_coverage_count=_first_int(row, "entity_coverage_count"),
        sample_value=_first_str(row, "sample_value"),
        status="verified" if is_verified else "registered",
        updated_at=_parse_dt(row.get("updated_at") or row.get("updated")),
    )


class HttpRegistryClient:
    """MCP streamable-http 权威源客户端（fd-open-data-mcp 的 list_concepts 族）。

    ``transport`` 可注入（httpx.MockTransport）供全 mock 测试；生产缺省走
    真实网络。凭据 ``token`` 缺省取 ``settings.indicator_registry_token``
    （env ``INDICATOR_REGISTRY_TOKEN``），非空即随每个请求上行 Bearer。
    """

    def __init__(
        self,
        base_url: str | None = None,
        token: str | None = None,
        timeout: float = 30.0,
        page_size: int = 500,
        max_pages: int = 1000,
        transport: httpx.BaseTransport | None = None,
    ):
        self._base_url = _mcp_endpoint(base_url or settings.indicator_registry_url)
        effective_token = token if token is not None else settings.indicator_registry_token
        self._token = (effective_token or "").strip()
        self._timeout = timeout
        self._page_size = max(1, min(int(page_size), 1000))
        self._max_pages = max(1, int(max_pages))
        self._transport = transport
        self._rpc_id = 0

    # ── 线协议 plumbing ─────────────────────────────────────────────────────

    def _post(
        self,
        client: httpx.Client,
        payload: dict[str, Any],
        session_id: str | None = None,
    ) -> httpx.Response:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        if session_id:
            headers[_SESSION_HEADER] = session_id
        return client.post(self._base_url, headers=headers, json=payload)

    def _initialize(self, client: httpx.Client) -> str:
        """initialize 握手（协议版本按序试探），返回 ``Mcp-Session-Id``。"""
        for version in _MCP_PROTOCOL_VERSIONS:
            self._rpc_id += 1
            resp = self._post(
                client,
                {
                    "jsonrpc": "2.0",
                    "id": self._rpc_id,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": version,
                        "capabilities": {},
                        "clientInfo": {"name": "fd-wire-api", "version": "1.0"},
                    },
                },
            )
            if resp.status_code == 400 and "protocol" in resp.text.lower():
                continue  # 服务端不支持该协议版本 → 试下一档
            resp.raise_for_status()
            payload = _decode_rpc_payload(resp)
            _raise_on_rpc_error(payload, "initialize")
            session_id = resp.headers.get("mcp-session-id")
            if not session_id:
                raise ValueError("authority MCP initialize returned no Mcp-Session-Id header")
            # initialized 通知（无 id；服务端 202 无体）
            note = self._post(
                client,
                {"jsonrpc": "2.0", "method": "notifications/initialized"},
                session_id=session_id,
            )
            if note.status_code >= 400:
                raise RuntimeError(
                    f"authority MCP initialized notification rejected: {note.status_code}"
                )
            return session_id
        raise ValueError("authority MCP rejected every known protocol version")

    def _call_list_concepts(
        self, client: httpx.Client, session_id: str, offset: int
    ) -> list[Any]:
        self._rpc_id += 1
        resp = self._post(
            client,
            {
                "jsonrpc": "2.0",
                "id": self._rpc_id,
                "method": "tools/call",
                "params": {
                    "name": _LIST_TOOL,
                    "arguments": {"limit": self._page_size, "offset": offset},
                },
            },
            session_id=session_id,
        )
        resp.raise_for_status()
        payload = _decode_rpc_payload(resp)
        _raise_on_rpc_error(payload, f"{_LIST_TOOL} (offset={offset})")
        return _tool_result_rows(payload, context=f"{_LIST_TOOL} (offset={offset})")

    def _close_session(self, client: httpx.Client, session_id: str) -> None:
        """尽力关闭 MCP 会话（streamable-http DELETE）；失败不影响结果。"""
        try:
            headers = {_SESSION_HEADER: session_id}
            if self._token:
                headers["Authorization"] = f"Bearer {self._token}"
            client.delete(self._base_url, headers=headers)
        except Exception:  # pragma: no cover - 清理失败可忽略
            pass

    # ── RegistryClient 协议实现 ─────────────────────────────────────────────

    def fetch_concepts(
        self, updated_since: datetime | None = None, force_full: bool = False
    ) -> ConceptBatch:
        pulled: list[ConceptRecord] = []
        with httpx.Client(timeout=self._timeout, transport=self._transport) as client:
            session_id = self._initialize(client)
            try:
                offset = 0
                # 保守分页上限，防权威侧异常翻页不终止
                for _ in range(self._max_pages):
                    page = self._call_list_concepts(client, session_id, offset)
                    for row in page:
                        if not isinstance(row, dict) or row.get("deprecated"):
                            # deprecated 权威行已从发现/调度下线，目录镜像同样不带
                            continue
                        pulled.append(mcp_concept_row_to_record(row))
                    if len(page) < self._page_size:
                        break
                    offset += self._page_size
                else:  # pragma: no cover - 权威侧异常时的防御
                    raise ValueError("authority pagination did not terminate")
            finally:
                self._close_session(client, session_id)
        # 权威 list_concepts 无 updated_since 参数：全量翻页后按行级 updated_at
        # 本地过滤；行不携带 updated_at（当前契约）时保守保留，幂等 upsert 兜底。
        if updated_since is not None and not force_full:
            pulled = [
                rec for rec in pulled
                if rec.updated_at is None or rec.updated_at > updated_since
            ]
        batch = ConceptBatch(items=pulled, full=updated_since is None or force_full)
        stamps = [rec.updated_at for rec in pulled if rec.updated_at is not None]
        batch.next_watermark = max(stamps) if stamps else (updated_since or utcnow())
        return batch


__all__ = [
    "ConceptBatch",
    "ConceptRecord",
    "HttpRegistryClient",
    "RegistryClient",
    "mcp_concept_row_to_record",
    "normalize_record",
    "normalize_status",
    "utcnow",
]
