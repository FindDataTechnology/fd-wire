"""api 层轻量行存储引擎（wire-free-tier-data-gate §2，design D2）。

免费档（无 cell）数据集的存取通道：列元数据（``dataset_columns``）+
JSON 行（``dataset_rows``）。**全链路不触碰 EngineToolClient**——读取同
样不计 metering_records（D7 口径：客户数据读取不过计量轨道）。

- 写入：复用 :mod:`.uploads` 的 CSV 解析与类型推断（``iter_ingest_chunks``
  + ``coerce_value``，不复制实现）；数值列按 dtype 归一后入 JSON 行。
- 查询面（窄）：过滤 eq/in/gt/gte/lt/lte/contains/startswith、排序、分页、
  count、distinct——引擎面支持的其余算子（ne/notin/like/isnull…）在此
  明确拒绝（400，如实标注免费面差异）。
- 聚合面：group by ≤3 列 × count/sum/avg/min/max；sum/avg 仅数值列。
- 双方言：JSON 取值经 SQLAlchemy JSON 抽象（``data["列"].as_string()``）
  + 数值 CAST——SQLite 渲染 ``CAST(JSON_EXTRACT(...) AS FLOAT)``、PG 渲染
  ``CAST(data ->> '列' AS FLOAT)``；``data`` 列 PG 端为 JSONB（models）。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import service, uploads
from .models import Dataset, DatasetColumn, DatasetRow
from .settings import get_settings

#: 查询/聚合支持的过滤算子（窄面；与 tasks §2.2 逐字对齐）
SUPPORTED_FILTER_OPS = ("eq", "in", "gt", "gte", "lt", "lte", "contains", "startswith")
#: 聚合允许的度量函数
AGGREGATE_FNS = ("count", "sum", "avg", "min", "max")
#: 聚合分组列数上限（design D2：group by ≤3 列）
AGGREGATE_MAX_GROUP_COLUMNS = 3
#: 聚合返回的分组数上限（10k 行规模的全展开保护；截断如实标记）
AGGREGATE_MAX_GROUPS = 1000
#: 行写入的会话内分块（防 10k 行 ORM 会话膨胀）
_WRITE_FLUSH_ROWS = 1000


class LocalQueryError(ValueError):
    """本地窄查询面的参数/契约错误（路由层转 400，如实提示免费面差异）。"""


# ------------------------------------------------------------------ 列注册表


def _column_map(db: Session, dataset_id: str) -> dict[str, str]:
    """dataset_columns → {列名: dtype}（查询面的列校验与取值依据）。"""
    rows = db.execute(
        select(DatasetColumn.name, DatasetColumn.dtype)
        .where(DatasetColumn.dataset_id == dataset_id)
        .order_by(DatasetColumn.ordinal, DatasetColumn.id)
    ).all()
    return {name: dtype for name, dtype in rows}


def _require_column(columns: dict[str, str], name: Any, *, what: str) -> tuple[str, str]:
    if not isinstance(name, str) or name not in columns:
        raise LocalQueryError(f"{what}引用了不存在的列 {name!r}（可用列: {sorted(columns)}）")
    return name, columns[name]


# ------------------------------------------------------------------ 表达式（双方言）


def _text_expr(name: str):
    """JSON 取值的文本形态：SQLite=JSON_EXTRACT、PG=data ->>（as_string 抽象）。"""
    return DatasetRow.data[name].as_string()


def _numeric_expr(name: str):
    """JSON 取值的数值形态：双方言经 CAST(... AS FLOAT)（整数亦走 FLOAT，
    避免 PG text/int 比较报错与 SQLite 整型截断分歧；展示端再按 dtype 归整）。"""
    return sa.cast(_text_expr(name), sa.Float)


def _typed_expr(name: str, dtype: str):
    """按 dtype 选择取值形态：INTEGER/REAL → 数值 CAST；TEXT → 文本。"""
    if dtype in (uploads.INTEGER, uploads.REAL):
        return _numeric_expr(name)
    return _text_expr(name)


def _as_number(value: Any, *, column: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise LocalQueryError(
            f"列 {column!r} 是数值列，过滤值必须是数值（收到 {value!r}）"
        ) from exc


def _as_text(value: Any) -> str:
    if value is None:
        raise LocalQueryError("contains/startswith 过滤值不能为 null")
    return str(value)


def _norm_value(dtype: str, value: Any) -> Any:
    """SQL 产出值的展示归整：INTEGER 列的整值浮点（1.0）还原为 int。"""
    if dtype == uploads.INTEGER and isinstance(value, float) and value.is_integer():
        return int(value)
    return value


# ------------------------------------------------------------------ 过滤/排序编译


def _compile_filters(columns: dict[str, str], filters: list[dict]) -> list:
    conditions: list = []
    for flt in filters or []:
        if not isinstance(flt, dict):
            raise LocalQueryError(f"过滤项必须是对象（收到 {flt!r}）")
        op = str(flt.get("op") or "")
        if op not in SUPPORTED_FILTER_OPS:
            raise LocalQueryError(
                f"api 层数据集不支持过滤算子 {op!r}"
                f"（支持: {', '.join(SUPPORTED_FILTER_OPS)}；完整算子面需 cell 层/付费档）"
            )
        name, dtype = _require_column(columns, flt.get("column"), what="过滤")
        value = flt.get("value")
        if dtype in (uploads.INTEGER, uploads.REAL):
            expr = _numeric_expr(name)
            if op == "in":
                values = _in_values(flt)
                conditions.append(
                    expr.in_([_as_number(v, column=name) for v in values])
                )
            elif op == "contains":
                raise LocalQueryError(
                    f"数值列 {name!r} 不支持 contains（文本匹配仅 TEXT 列）"
                )
            elif op == "startswith":
                raise LocalQueryError(
                    f"数值列 {name!r} 不支持 startswith（文本匹配仅 TEXT 列）"
                )
            elif value is None:
                conditions.append(expr.is_(None))
            else:
                number = _as_number(value, column=name)
                conditions.append(
                    {
                        "eq": expr == number,
                        "gt": expr > number,
                        "gte": expr >= number,
                        "lt": expr < number,
                        "lte": expr <= number,
                    }[op]
                )
        else:
            expr = _text_expr(name)
            if op == "contains":
                conditions.append(expr.like(f"%{_as_text(value)}%"))
            elif op == "startswith":
                conditions.append(expr.like(f"{_as_text(value)}%"))
            elif op == "in":
                values = _in_values(flt)
                conditions.append(expr.in_([str(v) for v in values]))
            else:
                text = None if value is None else str(value)
                if op == "eq":
                    conditions.append(expr == text)  # None → IS NULL
                else:
                    conditions.append(
                        {"gt": expr > text, "gte": expr >= text, "lt": expr < text, "lte": expr <= text}[op]
                    )
    return conditions


def _in_values(flt: dict) -> list:
    """in 算子取值：兼容引擎契约的 values 数组与 value 数组两种形态。"""
    values = flt.get("values")
    if values is None:
        values = flt.get("value")
    if not isinstance(values, list) or not values:
        raise LocalQueryError("in 过滤必须带非空 values 数组")
    return values


def _compile_order_by(columns: dict[str, str], sort: list[dict]) -> list:
    order: list = []
    for item in sort or []:
        if not isinstance(item, dict):
            raise LocalQueryError(f"排序项必须是对象（收到 {item!r}）")
        name, dtype = _require_column(columns, item.get("column"), what="排序")
        direction = str(item.get("dir") or "asc").lower()
        if direction not in ("asc", "desc"):
            raise LocalQueryError(f"排序方向必须是 asc/desc（收到 {direction!r}）")
        expr = _typed_expr(name, dtype)
        order.append(expr.desc() if direction == "desc" else expr.asc())
    order.append(DatasetRow.row_index.asc())  # 同键行按建集序（兜底稳定序）
    return order


# ------------------------------------------------------------------ 写入（§2.1）


def ingest_local(
    db: Session, *, dataset: Dataset, path: Path, columns: list[dict]
) -> int:
    """api 层物化：登记列 + 流式写行（复用 uploads 的暂存 CSV 解析）。

    行值经 ``coerce_value`` 按声明 dtype 归一（INTEGER→int、REAL→float、
    TEXT→str、空串→None）；行数闸在途中兜底（超限抛 QuotaExceeded，调用
    方 rollback 即无半写状态）。返回写入行数。
    """
    max_rows = get_settings().free_tier_max_rows
    # 列注册表（先清后写：本入口只服务新建集，清写保持幂等）
    db.execute(sa.delete(DatasetColumn).where(DatasetColumn.dataset_id == dataset.id))
    db.execute(sa.delete(DatasetRow).where(DatasetRow.dataset_id == dataset.id))
    for ordinal, column in enumerate(columns):
        db.add(
            DatasetColumn(
                dataset_id=dataset.id,
                name=str(column.get("name")),
                dtype=str(column.get("type") or uploads.TEXT),
                ordinal=ordinal,
            )
        )
    db.flush()
    total = 0
    size_bytes = 0
    pending = 0
    for chunk in uploads.iter_ingest_chunks(path, columns):
        if total + len(chunk) > max_rows:
            raise service.QuotaExceeded(
                f"行数 {total + len(chunk)} 超过免费档单数据集上限 {max_rows}——"
                "请拆分数据，或升级到基础档及以上套餐"
            )
        for offset, row in enumerate(chunk):
            db.add(DatasetRow(dataset_id=dataset.id, row_index=total + offset, data=row))
            size_bytes += len(json.dumps(row, ensure_ascii=False, default=str))
        total += len(chunk)
        pending += len(chunk)
        if pending >= _WRITE_FLUSH_ROWS:
            db.flush()
            pending = 0
    dataset.row_count = total
    dataset.size_bytes = size_bytes
    return total


def delete_local_rows(db: Session, *, dataset_id: str) -> None:
    """删除 api 层行/列数据（数据集登记行由调用方删；不留孤儿行）。"""
    db.execute(sa.delete(DatasetRow).where(DatasetRow.dataset_id == dataset_id))
    db.execute(sa.delete(DatasetColumn).where(DatasetColumn.dataset_id == dataset_id))


# ------------------------------------------------------------------ schema 预览（§2.4）


def schema_of(db: Session, *, dataset_id: str) -> dict:
    """列/类型/行数统计（dataset_columns 聚合；详情端点与配额条共用）。"""
    columns = _column_map(db, dataset_id)
    rows = int(
        db.execute(
            select(func.count(DatasetRow.id)).where(DatasetRow.dataset_id == dataset_id)
        ).scalar_one()
    )
    return {
        "columns": [
            {"name": name, "type": dtype} for name, dtype in columns.items()
        ],  # _column_map 已按 ordinal 排序
        "row_count": rows,
    }


# ------------------------------------------------------------------ 查询（§2.2）


def execute_query(
    db: Session,
    *,
    dataset_id: str,
    filters: list[dict] | None = None,
    sort: list[dict] | None = None,
    limit: int = 100,
    offset: int = 0,
    count_only: bool = False,
    distinct_column: str | None = None,
) -> dict:
    """本地查询：过滤/排序/分页/count/distinct（响应形态对齐引擎 query）。"""
    columns = _column_map(db, dataset_id)
    conditions = _compile_filters(columns, filters or [])
    order = _compile_order_by(columns, sort or [])
    base = sa.select(DatasetRow).where(DatasetRow.dataset_id == dataset_id, *conditions)
    total = int(
        db.execute(
            sa.select(func.count()).select_from(base.subquery())
        ).scalar_one()
    )
    column_cards = [
        {"name": name, "type": dtype} for name, dtype in columns.items()
    ]
    if count_only:
        return {
            "columns": column_cards,
            "rows": [],
            "total": total,
            "limit": limit,
            "offset": offset,
            "truncated": False,
        }
    if distinct_column is not None:
        name, dtype = _require_column(columns, distinct_column, what="distinct")
        expr = _typed_expr(name, dtype)
        values = [
            _norm_value(dtype, value)
            for (value,) in db.execute(
                sa.select(expr)
                .distinct()
                .where(DatasetRow.dataset_id == dataset_id, *conditions)
                .order_by(expr)
            ).all()
        ]
        return {
            "columns": column_cards,
            "distinct_column": name,
            "values": values,
            "count": len(values),
            "total": total,
            "limit": limit,
            "offset": offset,
            "truncated": False,
        }
    entities = (
        db.execute(base.order_by(*order).offset(offset).limit(limit)).scalars().all()
    )
    rows = []
    for entity in entities:
        row = dict(entity.data or {})
        row["__row_id"] = str(entity.row_index)
        rows.append(row)
    return {
        "columns": column_cards,
        "rows": rows,
        "total": total,
        "limit": limit,
        "offset": offset,
        "truncated": total > offset + len(rows),
    }


# ------------------------------------------------------------------ 聚合（§2.3）


def _parse_measures(
    columns: dict[str, str], measures: list[dict]
) -> list[tuple[str, str, str, Any]]:
    """度量解析 → [(输出键, fn, 列名, SQL 表达式)]；fn 语法/数值性校验。"""
    parsed: list[tuple[str, str, str, Any]] = []
    for measure in measures or []:
        if not isinstance(measure, dict):
            raise LocalQueryError(f"度量项必须是对象（收到 {measure!r}）")
        fn = str(measure.get("fn") or measure.get("op") or "").lower()
        if fn not in AGGREGATE_FNS:
            raise LocalQueryError(
                f"不支持的聚合函数 {fn!r}（支持: {', '.join(AGGREGATE_FNS)}）"
            )
        name = measure.get("column")
        if fn == "count" and name in (None, "", "*"):
            # 无列 count = 组内行数（按主键计数；ORM 语义下 count(*) 不能
            # 与其他表达式同列输出，行数口径等价）
            parsed.append(("count", "count", "", func.count(DatasetRow.id)))
            continue
        name, dtype = _require_column(columns, name, what="聚合")
        if fn in ("sum", "avg") and dtype not in (uploads.INTEGER, uploads.REAL):
            raise LocalQueryError(
                f"聚合 {fn} 仅支持数值列（列 {name!r} 是 {dtype}）——"
                "文本列可聚合 count/min/max"
            )
        expr = _typed_expr(name, dtype)
        sql_fn = {"count": func.count, "sum": func.sum, "avg": func.avg, "min": func.min, "max": func.max}[fn]
        key = "count" if fn == "count" else f"{name}_{fn}"
        parsed.append((key, fn, name, sql_fn(expr)))
    return parsed


def execute_aggregate(
    db: Session,
    *,
    dataset_id: str,
    group_by: list[str],
    measures: list[dict],
    filters: list[dict] | None = None,
) -> dict:
    """本地聚合：group by ≤3 列 × count/sum/avg/min/max（形态对齐引擎）。"""
    if not group_by:
        raise LocalQueryError("aggregate 必须带 group_by（全局聚合请用单组哨兵列）")
    if len(group_by) > AGGREGATE_MAX_GROUP_COLUMNS:
        raise LocalQueryError(
            f"api 层数据集的聚合分组列数上限为 {AGGREGATE_MAX_GROUP_COLUMNS}"
            f"（收到 {len(group_by)}）；更宽的聚合面需 cell 层/付费档"
        )
    columns = _column_map(db, dataset_id)
    group_specs = [
        _require_column(columns, name, what="group_by") for name in group_by
    ]
    parsed = _parse_measures(columns, measures)
    conditions = _compile_filters(columns, filters or [])
    group_exprs = [_typed_expr(name, dtype) for name, dtype in group_specs]
    stmt = (
        sa.select(*group_exprs, *[item[3] for item in parsed])
        .where(DatasetRow.dataset_id == dataset_id, *conditions)
        .group_by(*group_exprs)
        .order_by(*group_exprs)
        .limit(AGGREGATE_MAX_GROUPS + 1)
    )
    result = db.execute(stmt).all()
    truncated = len(result) > AGGREGATE_MAX_GROUPS
    if truncated:
        result = result[:AGGREGATE_MAX_GROUPS]
    dtypes = dict(group_specs)
    groups = []
    for row in result:
        group: dict[str, Any] = {}
        for (name, dtype), value in zip(group_specs, row[: len(group_specs)]):
            group[name] = _norm_value(dtype, value)
        for (key, _fn, _name, _expr), value in zip(parsed, row[len(group_specs) :]):
            group[key] = _norm_number_out(value)
        groups.append(group)
    return {
        "group_by": [name for name, _ in group_specs],
        "groups": groups,
        "group_count": len(groups),
        "truncated": truncated,
    }


def _norm_number_out(value: Any) -> Any:
    """数值聚合产出的展示归整（1.0 → 1；None 保持 None）。"""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


# ------------------------------------------------------------------ 行预览（控制台）


def preview_rows(
    db: Session, *, dataset_id: str, page: int, page_size: int
) -> dict:
    """控制台行预览（本地执行；形态对齐引擎 preview：columns/rows/total）。"""
    columns = _column_map(db, dataset_id)
    total = int(
        db.execute(
            select(func.count(DatasetRow.id)).where(DatasetRow.dataset_id == dataset_id)
        ).scalar_one()
    )
    entities = (
        db.execute(
            sa.select(DatasetRow)
            .where(DatasetRow.dataset_id == dataset_id)
            .order_by(DatasetRow.row_index)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .scalars()
        .all()
    )
    rows = []
    for entity in entities:
        row = dict(entity.data or {})
        row["__row_id"] = str(entity.row_index)
        rows.append(row)
    return {
        "columns": [
            {"name": name, "type": dtype} for name, dtype in columns.items()
        ],
        "rows": rows,
        "total": total,
    }
