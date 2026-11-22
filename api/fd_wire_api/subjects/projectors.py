"""通道投影器（wire-subject-tracking design D3）。

每个投影器：给定 ``subject.ref`` 与通道 ``spec``，**只读**地向上游取一次数据，
返回统一形状 ``{type, status, coverage, rows, as_of, errors?}``：

- ``status``   ∈ {ok, partial, unavailable}
- ``coverage`` ∈ {available, stale, unavailable}

纪律（与柏讯全部分析面同口径）：MUST NOT 把「上游不可用」或「该源不支持」渲染
成「0 条」——空结果若是「窗口内无条目」，那是 ``available`` + 空 ``rows``。

客户端全部可注入（测试用假件）；生产走与 ``datasets/indicator_fetch.py`` 同款
的 ``NativeMcpClient``（business-mcp 四通道）与 ``HttpInfoClient``（fd-info 公告）。
各投影器互不共享状态，扇出时逐个 try 包裹（失败隔离）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

# ---------------------------------------------------------------------------
# 统一结果形状
# ---------------------------------------------------------------------------

STATUS_OK = "ok"
STATUS_PARTIAL = "partial"
STATUS_UNAVAILABLE = "unavailable"

COVERAGE_AVAILABLE = "available"
COVERAGE_STALE = "stale"
COVERAGE_UNAVAILABLE = "unavailable"

#: 各通道的「数据截至」容忍滞后（小时后判 stale）。announcements 沿 fd-info
#: 近实时口径给窄窗；指标类给宽窗（月度数据本就滞后）。
STALE_HOURS = {"announcements": 24, "indicators": 24 * 45, "context": 24 * 90,
               "graph": 24 * 365, "registry": 24 * 365}


@dataclass
class ChannelResult:
    """一个通道的一次读取结果（统一形状）。"""

    type: str
    status: str
    coverage: str
    rows: list[dict] = field(default_factory=list)
    as_of: str | None = None
    errors: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "type": self.type,
            "status": self.status,
            "coverage": self.coverage,
            "rows": self.rows,
            "as_of": self.as_of,
        }
        if self.errors:
            out["errors"] = self.errors
        return out


def ok(type_: str, rows: list[dict], as_of: str | None = None) -> ChannelResult:
    return ChannelResult(type=type_, status=STATUS_OK, coverage=COVERAGE_AVAILABLE,
                         rows=rows, as_of=as_of)


def unavailable(type_: str, reason: str) -> ChannelResult:
    return ChannelResult(type=type_, status=STATUS_UNAVAILABLE,
                         coverage=COVERAGE_UNAVAILABLE,
                         errors=[{"reason": reason}])


# ---------------------------------------------------------------------------
# 客户端协议（可注入假件）
# ---------------------------------------------------------------------------


class McpCaller(Protocol):
    """business-mcp 的工具调用面（NativeMcpClient 形状的窄接口）。"""

    def call(self, tool: str, args: dict[str, Any]) -> dict[str, Any]: ...


class InfoLister(Protocol):
    """fd-info 的条目列表面（HttpInfoClient.list_items 形状）。"""

    def list_items(self, query: dict[str, Any]) -> dict[str, Any]: ...


# ---------------------------------------------------------------------------
# ref 解析：把 subject.ref 映射到通道所需标识
# ---------------------------------------------------------------------------


@dataclass
class ResolvedRef:
    """解析后的主体标识面。"""

    kind: str
    stock_code: str | None = None
    industry_code: str | None = None
    country_code: str | None = None
    region_code: str | None = None
    custom_label: str | None = None
    chain_segments: list[dict] = field(default_factory=list)


def resolve_ref(kind: str, ref: dict) -> ResolvedRef:
    """按 ref.source 填 ResolvedRef；缺关键标识（除 chain_spec）时不报错，
    由调用它的投影器判定 unavailable（不静默替换邻近实体）。"""
    source = ref.get("source")
    code = ref.get("code")
    out = ResolvedRef(kind=kind)
    if source == "stock_code":
        out.stock_code = code
    elif source == "industry_code":
        out.industry_code = code
    elif source == "country_code":
        out.country_code = code
    elif source == "region_code":
        out.region_code = code
    elif source == "custom_label":
        out.custom_label = code or ref.get("name")
    elif source == "chain_spec":
        out.chain_segments = list(ref.get("segments") or [])
        out.custom_label = ref.get("name")
    return out


# ---------------------------------------------------------------------------
# 5 个投影器
# ---------------------------------------------------------------------------


def project_indicators(rr: ResolvedRef, spec: dict, caller: McpCaller) -> ChannelResult:
    """指标通道：经 business-mcp ``indicator_series_read`` 拉序列。

    spec: ``{indicator_ids: [...], entity_type?, start?, end?}``。实体标识默认从
    ref 推（stock_code → entity_type=stock, entity_id=code）。
    """
    ids = spec.get("indicator_ids") or []
    if not ids:
        return unavailable("indicators", "spec 缺 indicator_ids")
    entity_type, entity_id = _indicator_entity(rr, spec)
    if entity_type is None:
        return unavailable("indicators", "ref 无法映射为指标实体（需 stock_code 等）")
    try:
        payload = caller.call("indicator_series_read", {
            "indicator_ids": ids,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "start": spec.get("start"),
            "end": spec.get("end"),
        })
    except Exception as exc:  # noqa: BLE001 - 上游失败如实降级
        return unavailable("indicators", f"上游不可用: {exc}")
    results = payload.get("results") or []
    errors = payload.get("errors") or []
    as_of = _max_date(r.get("date") for r in results)
    status = STATUS_PARTIAL if (results and errors) else (
        STATUS_OK if results else (STATUS_UNAVAILABLE if errors else STATUS_OK)
    )
    coverage = COVERAGE_AVAILABLE if results or not errors else COVERAGE_UNAVAILABLE
    return ChannelResult("indicators", status, coverage, rows=results,
                         as_of=as_of, errors=errors)


def project_announcements(rr: ResolvedRef, spec: dict, lister: InfoLister) -> ChannelResult:
    """公告通道：经 fd-info ``list_since(source_codes=[...])``（依赖 Change 1）。

    spec: ``{sources?, published_after?, limit?}``；证券代码从 ref.stock_code 推。
    """
    code = rr.stock_code or spec.get("stock_code")
    if not code:
        return unavailable("announcements", "ref 无证券代码，公告源按主体过滤需要 stock_code")
    query: dict[str, Any] = {"source_codes": [code], "limit": spec.get("limit", 50)}
    if spec.get("sources"):
        query["sources"] = spec["sources"]
    if spec.get("published_after"):
        query["published_after"] = spec["published_after"]
    try:
        payload = lister.list_items(query)
    except Exception as exc:  # noqa: BLE001
        return unavailable("announcements", f"fd-info 不可用: {exc}")
    items = payload.get("items") or []
    if not items and payload.get("empty_reason") == "sources_lack_entity_attribution":
        return unavailable("announcements", "限定源不提供主体标注")
    as_of = _max_date(i.get("published_at") for i in items)
    return ok("announcements", items, as_of)


def project_registry(rr: ResolvedRef, spec: dict, caller: McpCaller) -> ChannelResult:
    """工商登记通道：经 business-mcp ``ia35_company_search``（credit_code 优先）。

    spec: ``{credit_code?}``；缺则用 ref.stock_code / custom_label。
    """
    code = spec.get("credit_code") or rr.stock_code
    name = spec.get("name") or rr.custom_label
    args: dict[str, Any] = {"limit": spec.get("limit", 5)}
    if code:
        args["credit_code"] = code
    elif name:
        args["name_prefix"] = name
    else:
        return unavailable("registry", "ref 无信用代码或企业名")
    try:
        payload = caller.call("ia35_company_search", args)
    except Exception as exc:  # noqa: BLE001
        return unavailable("registry", f"上游不可用: {exc}")
    if payload.get("status") == "domain_unavailable":
        return unavailable("registry", "工商域不可用（domain_unavailable）")
    if payload.get("status") in ("invalid_params", "not_found"):
        return unavailable("registry", str(payload.get("status")))
    rows = payload.get("results") or []
    return ok("registry", rows, payload.get("snapshot_year"))


def project_graph(rr: ResolvedRef, spec: dict, caller: McpCaller) -> ChannelResult:
    """关系网通道：经 business-mcp ``graph_search``（belongs_to 展开）。

    spec: ``{algorithm: neighbors|ego_graph|bfs, max_depth?}``；中心实体从 ref 推
    （stock_code / industry_code）。
    """
    center = _graph_center(rr, spec)
    if not center:
        return unavailable("graph", "ref 无法映射为图中心实体")
    algo = spec.get("algorithm", "neighbors")
    args = {
        "algorithm": algo,
        "start_entity_code": center[0],
        "max_depth": spec.get("max_depth", 1),
    }
    # entity_type_filter 在 graph_search 里过滤的是**邻居**类型，不是中心实体类型
    # ——传中心类型（如 stock）会把 industry/person 邻居全滤掉、通道恒空。只在
    # 调用方显式在 spec 里指定想看的邻居类型时才传。
    if spec.get("neighbor_type"):
        args["entity_type_filter"] = spec["neighbor_type"]
    try:
        payload = caller.call("graph_search", args)
    except Exception as exc:  # noqa: BLE001
        return unavailable("graph", f"上游不可用: {exc}")
    if payload.get("error"):
        return unavailable("graph", str(payload["error"]))
    rows = payload.get("results") or payload.get("nodes") or []
    return ok("graph", rows, None)


def project_context(rr: ResolvedRef, spec: dict, caller: McpCaller) -> ChannelResult:
    """背景指标通道：与国家/行业周期相关的宽口径序列（indicator_series_read）。

    spec: ``{indicator_ids, entity_type?, entity_id?}``——与 indicators 同工具，
    但语义是「背景」而非「主体自身」，单列一种通道便于时间轴区分。缺 indicator_ids
    时按 kind 给一组缺省（country → 常见宏观；industry → 景气）。
    """
    ids = spec.get("indicator_ids") or _default_context_indicators(rr, spec)
    if not ids:
        return unavailable("context", "无背景指标可取（spec 缺 indicator_ids 且无缺省）")
    entity_type = spec.get("entity_type")
    entity_id = spec.get("entity_id")
    if not entity_type or not entity_id:
        entity_type, entity_id = _indicator_entity(rr, spec)
    if entity_type is None:
        return unavailable("context", "ref 无法映射为背景实体")
    try:
        payload = caller.call("indicator_series_read", {
            "indicator_ids": ids,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "start": spec.get("start"),
            "end": spec.get("end"),
        })
    except Exception as exc:  # noqa: BLE001
        return unavailable("context", f"上游不可用: {exc}")
    results = payload.get("results") or []
    errors = payload.get("errors") or []
    as_of = _max_date(r.get("date") for r in results)
    status = STATUS_PARTIAL if (results and errors) else (STATUS_OK if results else STATUS_UNAVAILABLE)
    coverage = COVERAGE_AVAILABLE if results else COVERAGE_UNAVAILABLE
    return ChannelResult("context", status, coverage, rows=results, as_of=as_of, errors=errors)


# ---------------------------------------------------------------------------
# 内部工具
# ---------------------------------------------------------------------------


def _indicator_entity(rr: ResolvedRef, spec: dict) -> tuple[str | None, Any]:
    """主体 → (entity_type, entity_id) 给 indicator_series_read。"""
    if spec.get("entity_type") and spec.get("entity_id") is not None:
        return spec["entity_type"], spec["entity_id"]
    if rr.stock_code:
        return "stock", rr.stock_code
    if rr.country_code:
        return "country", rr.country_code
    if rr.industry_code:
        return "industry", rr.industry_code
    if rr.region_code:
        return "region", rr.region_code
    return None, None


def _graph_center(rr: ResolvedRef, spec: dict) -> tuple[str, str] | None:
    """主体 → (code, entity_type) 给 graph_search。"""
    if spec.get("start_entity_code"):
        return str(spec["start_entity_code"]), spec.get("entity_type_filter") or "stock"
    if rr.stock_code:
        return rr.stock_code, "stock"
    if rr.industry_code:
        return rr.industry_code, "industry"
    return None


def _default_context_indicators(rr: ResolvedRef, spec: dict) -> list[str]:
    """按 kind 的缺省背景指标（宁缺毋滥：拿不到就空，由投影器标 unavailable）。"""
    return []


def _max_date(values) -> str | None:
    """若干日期串里的最大者（ISO 串字典序即时间序）。"""
    seen = [str(v) for v in values if v]
    return max(seen) if seen else None
