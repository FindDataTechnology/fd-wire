"""源健康判定与不健康前置声明（add-securities-industry-line 任务 5.7）。

规格契约（securities-source-alerting「告警诚实性」）：任一数据源处于不健康
态时，依赖该源产出的预警与看板输出 MUST 前置声明「信息可能不完整」，MUST
NOT 在源断更期间以旧数据冒充最新状态。

判定依据（全部来自在产真实水位，零 always-true 硬编码）：

1. **水位**：新鲜度快照数据集里的 ``series=freshness`` 行，携带 ``family``
   （源族）、``lag_days``（该族最新数据距快照日的自然日滞后）、``as_of``
   （快照日）与 ``period``（最近一期成功数据的日期）。这些行由数据管道按
   快照日计算写入（见 reports/5.6-alert-rules.md）。
2. **容忍窗**：由**已发布的「断更」告警规则**声明——规则 query 过滤
   ``series=freshness`` + ``family=<F>``，聚合列 ``lag_days``，条件
   ``gt``/``gte``。容忍窗即规则阈值，不在代码里再写一份数字。同一族存在
   多条此类规则时取最严（最小）窗口。
3. **判定**：``lag_days > tolerance_days`` → 不健康。最近成功时间优先取
   行内 ``period``（最近成功期），缺失时按 ``as_of − lag_days`` 推导。
4. **不确定就不声明**：没有断更规则、没有快照行、或读不到水位 → 该族不进
   入「不健康」集合（既不冒充健康，也不凭空告警）。

输出面：
- 告警通知：:func:`disclosure_prefix` 的文本前置到邮件正文首部，同时以
  ``disclosures`` 数组进入 webhook payload；
- 看板刷新/渲染/详情：:func:`board_disclosure` 返回同一文本 + 结构化
  ``source_health`` 元数据。

看板依赖哪些源族 :func:`resolve_board_families` 按三档解析：板级显式声明
``spec.spec.source_families``（typed 可选字段）→ 面板 query 的
``family`` 等值过滤 → 面板 ``source``/``title`` 文本与「族 key / 快照名称」
归一化匹配（如「A 股日线行情（前复权）」命中 astock_daily）。三档全无 →
不声明。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..artifacts.models import Artifact
from ..datasets import api_store

logger = logging.getLogger(__name__)

#: 新鲜度快照行的 series 取值（数据管道口径）
FRESHNESS_SERIES = "freshness"
#: 滞后列名（自然日）
LAG_COLUMN = "lag_days"


@dataclass(frozen=True)
class FreshnessRule:
    """一条已发布「断更」规则声明的源族容忍窗。"""

    family: str
    dataset_id: str
    tolerance_days: float
    artifact_id: int


@dataclass(frozen=True)
class SourceHealth:
    """单一源族此刻的健康快照（水位 + 容忍窗）。"""

    family: str
    label: str
    last_success_at: str | None
    lag_days: float
    tolerance_days: float
    as_of: str | None = None
    dataset_id: str | None = None

    @property
    def unhealthy(self) -> bool:
        return self.lag_days > self.tolerance_days

    def to_dict(self) -> dict[str, Any]:
        return {
            "family": self.family,
            "label": self.label,
            "last_success_at": self.last_success_at,
            "lag_days": self.lag_days,
            "tolerance_days": self.tolerance_days,
            "as_of": self.as_of,
            "unhealthy": self.unhealthy,
        }


# --------------------------------------------------------------- 供给解析


def _as_number(value: object) -> float | None:
    """宽松数值化（bool 拒收——bool 是 int 子类须先判）。"""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def freshness_rules(ai_session: Session, *, cache: dict | None = None) -> dict[str, FreshnessRule]:
    """扫已发布 alert_rule，取出「断更」规则声明的源族容忍窗。

    判定形态（与 spec_validate 契约一致）：query.filters 含
    ``series=freshness`` 与 ``family=<F>``（均 eq）；aggregate.column ==
    ``lag_days``；condition.op ∈ {gt, gte} 且 value 为数值。任一不满足即
    不是断更规则（业务越阈规则不参与源健康判定）。

    同族多规则取最严窗口（阈值最小）。``cache`` 供同一 tick 内复用。
    """
    if cache is not None and "rules" in cache:
        return cache["rules"]
    rules: dict[str, FreshnessRule] = {}
    artifacts = list(
        ai_session.scalars(
            select(Artifact).where(
                Artifact.kind == "alert_rule", Artifact.status == "published"
            )
        )
    )
    for artifact in artifacts:
        # 延迟导入避免 artifacts ↔ alerts 循环导入（service 已反向引用 alerts）
        from ..artifacts import service as artifacts_service

        try:
            spec = artifacts_service.current_spec(ai_session, artifact)
        except Exception:  # noqa: BLE001 - 读不到版本行不阻断，如实跳过
            logger.warning("源健康：规则 %s 版本读取失败，跳过", artifact.id)
            continue
        inner = spec.get("spec") if isinstance(spec, dict) else None
        claim = _freshness_claim(inner, artifact.id)
        if claim is None:
            continue
        family, dataset_id, tolerance = claim
        existing = rules.get(family)
        if existing is None or tolerance < existing.tolerance_days:
            rules[family] = FreshnessRule(
                family=family,
                dataset_id=dataset_id,
                tolerance_days=tolerance,
                artifact_id=artifact.id,
            )
    if cache is not None:
        cache["rules"] = rules
    return rules


def _freshness_claim(inner: object, artifact_id: int) -> tuple[str, str, float] | None:
    """从规则内层解析 (family, dataset_id, tolerance)；非断更规则返回 None。"""
    if not isinstance(inner, dict):
        return None
    query = inner.get("query")
    if not isinstance(query, dict):
        return None
    dataset_id = query.get("dataset_id")
    if not isinstance(dataset_id, str) or not dataset_id:
        return None
    filters = query.get("filters")
    if not isinstance(filters, list):
        return None
    series = family = None
    for flt in filters:
        if not isinstance(flt, dict) or flt.get("op") != "eq":
            continue
        column = flt.get("column")
        if column == "series":
            series = flt.get("value")
        elif column == "family":
            family = flt.get("value")
    if series != FRESHNESS_SERIES or not isinstance(family, str) or not family:
        return None
    aggregate = inner.get("aggregate")
    if not isinstance(aggregate, dict) or aggregate.get("column") != LAG_COLUMN:
        return None
    condition = inner.get("condition")
    if not isinstance(condition, dict) or condition.get("op") not in ("gt", "gte"):
        return None
    tolerance = _as_number(condition.get("value"))
    if tolerance is None:
        return None
    logger.debug("源健康：规则 %s 声明 %s 容忍窗 %s 天", artifact_id, family, tolerance)
    return family, dataset_id, tolerance


def _read_freshness_row(
    datasets_db: Session, dataset_id: str, family: str
) -> dict | None:
    """读该族最新一条新鲜度行（as_of 最大者）；读不到返回 None。

    只走本地 api 档行存（免费档同款路径）。cell 档或结构不符 → None（不猜）。
    """
    try:
        result = api_store.execute_query(
            datasets_db,
            dataset_id=dataset_id,
            filters=[
                {"column": "series", "op": "eq", "value": FRESHNESS_SERIES},
                {"column": "family", "op": "eq", "value": family},
            ],
            sort=[{"column": "as_of", "dir": "desc"}],
            limit=5,
        )
    except Exception as exc:  # noqa: BLE001 - 结构不符/非本地档如实未知
        logger.debug("源健康：读取 %s/%s 新鲜度行失败：%s", dataset_id, family, exc)
        return None
    rows = result.get("rows") if isinstance(result, dict) else None
    if not isinstance(rows, list):
        return None
    best: dict | None = None
    for row in rows:
        if not isinstance(row, dict):
            continue
        if _as_number(row.get(LAG_COLUMN)) is None:
            continue
        if best is None:
            best = row
            continue
        if str(row.get("as_of") or "") > str(best.get("as_of") or ""):
            best = row
    return best


def _last_success_at(row: dict, lag_days: float) -> str | None:
    """最近成功时间：优先 period（最近成功期）；缺失时 as_of − lag_days 推导。"""
    period = row.get("period")
    if isinstance(period, str) and period.strip():
        return period.strip()
    as_of = row.get("as_of")
    if isinstance(as_of, str) and as_of.strip():
        try:
            return (date.fromisoformat(as_of.strip()) - timedelta(days=int(lag_days))).isoformat()
        except ValueError:
            return None
    return None


def health_from_row(
    row: dict, rule: FreshnessRule, *, dataset_id: str | None = None
) -> SourceHealth | None:
    """把一条新鲜度行 + 规则转成健康快照；行不合法返回 None。"""
    lag = _as_number(row.get(LAG_COLUMN))
    if lag is None or lag < 0:
        return None
    family = row.get("family")
    if family != rule.family:
        return None
    label = row.get("name")
    if not isinstance(label, str) or not label.strip():
        label = rule.family
    as_of = row.get("as_of")
    return SourceHealth(
        family=rule.family,
        label=label.strip(),
        last_success_at=_last_success_at(row, lag),
        lag_days=lag,
        tolerance_days=rule.tolerance_days,
        as_of=as_of.strip() if isinstance(as_of, str) and as_of.strip() else None,
        dataset_id=dataset_id or rule.dataset_id,
    )


def health_map(
    ai_session: Session,
    datasets_db: Session,
    *,
    cache: dict | None = None,
) -> dict[str, SourceHealth]:
    """全部已声明源族此刻的健康快照（读不到水位的族不出现）。"""
    rules = freshness_rules(ai_session, cache=cache)
    out: dict[str, SourceHealth] = {}
    rows_cache: dict[tuple[str, str], dict | None] = (
        cache.setdefault("rows", {}) if cache is not None else {}
    )
    for family, rule in rules.items():
        key = (rule.dataset_id, family)
        if key not in rows_cache:
            rows_cache[key] = _read_freshness_row(datasets_db, rule.dataset_id, family)
        row = rows_cache[key]
        if row is None:
            continue
        health = health_from_row(row, rule)
        if health is not None:
            out[family] = health
    return out


# ----------------------------------------------------------- 依赖源解析


def snapshot_records(snapshot: object) -> list[dict]:
    """把 ``{columns, rows}`` 快照还原为字典行（列序→列名）。

    规则评估路径的快照行是位置数组（query_contract._build_snapshot），而
    api_store 直读返回字典行——两种形态都接受，调用方无需关心来源。
    纯位置行在缺列时如实为 None。
    """
    if not isinstance(snapshot, dict):
        return []
    rows = snapshot.get("rows")
    if not isinstance(rows, list):
        return []
    columns = snapshot.get("columns")
    names = [name for name in columns if isinstance(name, str)] if isinstance(columns, list) else []
    records: list[dict] = []
    for row in rows:
        if isinstance(row, dict):
            records.append(row)
            continue
        if isinstance(row, list) and names:
            records.append(
                {
                    name: row[index] if index < len(row) else None
                    for index, name in enumerate(names)
                }
            )
    return records


def families_in_snapshot(snapshot: object) -> set[str]:
    """从一次规则查询快照里取依赖源族（行的 family 列去重）。

    规则 183/184 的快照本身就是新鲜度行；规则 181/182 的行也带 family
    列（performance / financials）——取到即真实依赖，无需外部映射。
    """
    families: set[str] = set()
    for row in snapshot_records(snapshot):
        family = row.get("family")
        if isinstance(family, str) and family:
            families.add(family)
    return families


def _normalize(text: object) -> str:
    """文本归一：小写 + 去空白（「A 股日线行情」↔「A股日线行情」）。"""
    if not isinstance(text, str):
        return ""
    return "".join(text.lower().split())


def resolve_board_families(
    spec: object, known: Iterable[str] | dict[str, SourceHealth]
) -> list[str]:
    """解析看板依赖的源族（三档：显式声明 → query family 过滤 → 文本匹配）。

    只返回 ``known`` 里存在的族（无断更规则声明的族不参与判定）。
    """
    known_set = set(known.keys()) if isinstance(known, dict) else set(known)
    labels = (
        {health.family: health.label for health in known.values()}
        if isinstance(known, dict)
        else {}
    )
    inner = spec.get("spec") if isinstance(spec, dict) else None
    if not isinstance(inner, dict):
        return []

    found: list[str] = []

    def add(family: object) -> None:
        if isinstance(family, str) and family in known_set and family not in found:
            found.append(family)

    explicit = inner.get("source_families")
    if isinstance(explicit, list):
        for family in explicit:
            add(family)

    panels = inner.get("panels")
    if isinstance(panels, list):
        for panel in panels:
            if not isinstance(panel, dict):
                continue
            query = panel.get("query")
            if isinstance(query, dict):
                filters = query.get("filters")
                if isinstance(filters, list):
                    for flt in filters:
                        if (
                            isinstance(flt, dict)
                            and flt.get("column") == "family"
                            and flt.get("op") == "eq"
                        ):
                            add(flt.get("value"))
            text = _normalize(panel.get("source")) + "|" + _normalize(panel.get("title"))
            for family in known_set:
                token = _normalize(family)
                label = _normalize(labels.get(family))
                if (token and token in text) or (label and label in text):
                    add(family)
    return found


# --------------------------------------------------------------- 声明文本


def disclosure_line(health: SourceHealth) -> str:
    """单源声明行（规格文案：来源 + 最近成功时间）。"""
    last = health.last_success_at or "未知"
    return f"信息可能不完整（来源：{health.label}；最近成功时间：{last}）"


def unhealthy(items: Iterable[SourceHealth]) -> list[SourceHealth]:
    """只保留不健康态（滞后超容忍窗）。"""
    return [item for item in items if item.unhealthy]


def disclosure_prefix(items: Iterable[SourceHealth]) -> str:
    """不健康前置声明块（多条各一行；健康/空集返回空串——不产生噪声）。"""
    lines = [disclosure_line(item) for item in unhealthy(items)]
    if not lines:
        return ""
    return "\n".join(lines) + "\n\n"


def board_disclosure(
    ai_session: Session,
    datasets_db: Session,
    spec: object,
    *,
    cache: dict | None = None,
) -> tuple[str | None, list[dict[str, Any]]]:
    """看板输出的声明与结构化源健康元数据。

    返回 ``(声明文本或 None, source_health 列表)``。source_health 覆盖该板
    依赖的全部已声明源族（含健康态，便于披露「已核对且健康」）；声明文本
    仅在不健康时非 None。
    """
    health = health_map(ai_session, datasets_db, cache=cache)
    families = resolve_board_families(spec, health)
    items = [health[family] for family in families]
    prefix = disclosure_prefix(items)
    text = prefix.strip() or None
    return text, [item.to_dict() for item in items]


def safe_board_disclosure(
    ai_session: Session,
    datasets_db: Session | None,
    spec: object,
    *,
    cache: dict | None = None,
) -> tuple[str | None, list[dict[str, Any]]]:
    """输出面薄包装：判定失败不得拖垮刷新/渲染（如实记日志、不声明）。

    「判不出」与「健康」在输出上都不产生声明文本——区别在于前者不会伪装
    成已核对健康（``source_health`` 为空）。
    """
    if datasets_db is None:
        return None, []
    try:
        return board_disclosure(ai_session, datasets_db, spec, cache=cache)
    except Exception:  # noqa: BLE001 - 监控元数据永不阻断主输出
        logger.exception("源健康判定失败（本次输出不作声明）")
        return None, []


__all__ = [
    "FRESHNESS_SERIES",
    "LAG_COLUMN",
    "FreshnessRule",
    "SourceHealth",
    "board_disclosure",
    "disclosure_line",
    "disclosure_prefix",
    "families_in_snapshot",
    "freshness_rules",
    "health_from_row",
    "health_map",
    "resolve_board_families",
    "safe_board_disclosure",
    "snapshot_records",
    "unhealthy",
]
