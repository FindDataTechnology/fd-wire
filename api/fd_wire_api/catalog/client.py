"""权威源客户端：统一指标注册目录（fd-open-data-mcp 侧 list_concepts 族）。

- ``RegistryClient`` 是协议（Protocol）：测试用内存假实现替换，生产用
  ``HttpRegistryClient``。同步器只依赖协议，不依赖 HTTP 细节。
- 增量游标：客户端接受 ``updated_since`` 水位（上次成功同步的权威库
  updated_at 口径），只返回该水位之后变更的指标；``force_full=True``
  或水位为空时拉全量。
- 权威侧响应形状做了别名容错（list / ``items`` / ``data`` / ``concepts``
  包装、字段别名、分页 cursor）——真实 list_concepts 契约落地时只需对齐
  ``INDICATOR_REGISTRY_URL``，不改同步器。
"""

from __future__ import annotations

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


class HttpRegistryClient:
    """HTTP 权威源客户端（list_concepts 族的占位契约，env 可重指）。"""

    def __init__(self, base_url: str | None = None, timeout: float = 30.0):
        self._base_url = (base_url or settings.indicator_registry_url).rstrip("/")
        self._timeout = timeout

    def fetch_concepts(
        self, updated_since: datetime | None = None, force_full: bool = False
    ) -> ConceptBatch:
        params: dict[str, str] = {}
        if updated_since is not None and not force_full:
            params["updated_since"] = updated_since.isoformat()
        pulled: list[ConceptRecord] = []
        cursor: str | None = None
        with httpx.Client(timeout=self._timeout) as client:
            # 保守分页上限，防权威侧 cursor 死循环
            for _ in range(1000):
                if cursor:
                    params["cursor"] = cursor
                resp = client.get(f"{self._base_url}/concepts", params=params)
                resp.raise_for_status()
                raw_items, next_cursor = _extract_items(resp.json())
                pulled.extend(normalize_record(item) for item in raw_items if isinstance(item, dict))
                cursor = next_cursor
                if not cursor:
                    break
            else:  # pragma: no cover - 权威侧异常时的防御
                raise ValueError("authority pagination did not terminate")
        batch = ConceptBatch(items=pulled, full=updated_since is None or force_full)
        stamps = [rec.updated_at for rec in pulled if rec.updated_at is not None]
        batch.next_watermark = max(stamps) if stamps else (updated_since or utcnow())
        return batch


__all__ = [
    "ConceptBatch",
    "ConceptRecord",
    "HttpRegistryClient",
    "RegistryClient",
    "normalize_record",
    "normalize_status",
    "utcnow",
]
