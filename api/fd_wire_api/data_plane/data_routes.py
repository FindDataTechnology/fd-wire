"""数据面读写端点（wire-customer-data-engine 5.3，路径契约=design 附录 A）。

薄壳转发引擎（ADR-0007：单点执行层，REST 与 MCP 工具零漂移）：
- 双凭据经 require_data_plane_principal（wdk- key 或 console 会话）；
- allowlist 越界 403、额度满 fail-closed 429、引擎不可达如实 502/503
  （绝不静默降级）；
- 写入按凭据通道归属（data-key/console）落引擎编辑记录。
"""

from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..datasets import service
from ..datasets.db import get_db
from ..datasets.ingest import (
    EngineCallError,
    EngineClientFactory,
    EngineUnavailable,
    TOOL_ADD_COLUMN,
    TOOL_AGGREGATE,
    TOOL_DERIVE,
    TOOL_DERIVE_REFRESH,
    TOOL_JOIN_INDICATORS,
    TOOL_LINEAGE,
    TOOL_OVERVIEW,
    TOOL_QUERY,
    TOOL_WRITE_BATCH,
    get_engine_client_factory,
)
from ..datasets.models import Dataset
from ..datasets.routes import _actor, _dataset_or_404, _ensure_engine_ok, _raise_quota
from ..datasets.schemas import ColumnIn, DatasetOut
from .auth import DataPlanePrincipal, ensure_dataset_allowed, require_data_plane_principal

router = APIRouter(tags=["data-plane"])


# ── 请求体（契约 = 引擎工具入参同形，附录 A）─────────────────────────


class QueryIn(BaseModel):
    filters: list[dict] = Field(default_factory=list, max_length=50)
    sort: list[dict] = Field(default_factory=list, max_length=10)
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)
    count_only: bool = False
    distinct_column: Optional[str] = None
    raw: bool = False


class AggregateIn(BaseModel):
    group_by: list[str] = Field(min_length=1, max_length=10)
    measures: list[dict] = Field(min_length=1, max_length=10)
    filters: list[dict] = Field(default_factory=list, max_length=50)
    raw: bool = False


class BatchOpIn(BaseModel):
    op: str
    anchor: Optional[str] = None
    values: Optional[dict] = None


class BatchWriteIn(BaseModel):
    ops: list[BatchOpIn] = Field(min_length=1, max_length=1000)
    actor_label: Optional[str] = Field(default=None, max_length=200)


class AddColumnIn(BaseModel):
    column: ColumnIn


class DeriveIn(BaseModel):
    filters: list[dict] = Field(default_factory=list, max_length=50)
    sort: list[dict] = Field(default_factory=list, max_length=10)
    limit: Optional[int] = Field(default=None, ge=1, le=1_000_000)
    name: str = Field(min_length=1, max_length=200)


class JoinIndicatorIn(BaseModel):
    code: Optional[str] = None
    concept_id: Optional[int] = None
    as_: str = Field(alias="as")

    model_config = {"populate_by_name": True}


class JoinIn(BaseModel):
    indicators: list[JoinIndicatorIn] = Field(min_length=1, max_length=10)
    date_column: str
    region_column: Optional[str] = None
    default_entity: str = "中国"
    filters: list[dict] = Field(default_factory=list, max_length=50)
    name: str = Field(min_length=1, max_length=200)


# ── 薄壳工具 ─────────────────────────────────────────────────────────


def _engine_call(
    engine_factory: EngineClientFactory, principal: DataPlanePrincipal, tool: str, args: dict
) -> dict:
    client = engine_factory(principal.customer_id)
    try:
        result = client.call(tool, args)
    except (EngineUnavailable, EngineCallError) as exc:
        raise _ensure_engine_ok(exc) from exc
    if isinstance(result, dict) and result.get("error"):
        raise HTTPException(status_code=400, detail=f"引擎拒绝: {result['error']}")
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail=f"引擎返回形态异常: {result!r}")
    return result


def _sync_row_count(
    db: Session,
    dataset: Dataset,
    engine_factory: EngineClientFactory,
    principal: DataPlanePrincipal,
) -> None:
    """写入后以引擎 overview 为准刷新本地元数据（row_count；绝不用估算冒充）。"""
    result = _engine_call(engine_factory, principal, TOOL_OVERVIEW, {"dataset_key": dataset.key})
    dataset.row_count = int(result.get("rows") or 0)
    dataset.size_bytes = int(result.get("size_bytes") or 0)
    db.commit()


def _estimate_batch_bytes(ops: list[BatchOpIn]) -> int:
    """批量写的存储预检估算（fail-closed 方向宁严勿松：值 JSON 长 + 每条开销）。"""
    total = 0
    for op in ops:
        total += len(json.dumps(op.values or {}, ensure_ascii=False, default=str)) + 128
    return total


# ── 查询/聚合 ────────────────────────────────────────────────────────


@router.post("/api/v1/datasets/{dataset_id}/query")
def dataset_query(
    dataset_id: str,
    body: QueryIn,
    principal: DataPlanePrincipal = Depends(require_data_plane_principal),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> dict:
    dataset = _dataset_or_404(db, dataset_id, principal.customer_id)
    ensure_dataset_allowed(principal, dataset_id)
    return _engine_call(
        engine_factory,
        principal,
        TOOL_QUERY,
        {"dataset_key": dataset.key, **body.model_dump()},
    )


@router.post("/api/v1/datasets/{dataset_id}/aggregate")
def dataset_aggregate(
    dataset_id: str,
    body: AggregateIn,
    principal: DataPlanePrincipal = Depends(require_data_plane_principal),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> dict:
    dataset = _dataset_or_404(db, dataset_id, principal.customer_id)
    ensure_dataset_allowed(principal, dataset_id)
    return _engine_call(
        engine_factory,
        principal,
        TOOL_AGGREGATE,
        {"dataset_key": dataset.key, **body.model_dump()},
    )


# ── 批量写 ───────────────────────────────────────────────────────────


@router.post("/api/v1/datasets/{dataset_id}/rows:batchWrite")
def dataset_batch_write(
    dataset_id: str,
    body: BatchWriteIn,
    principal: DataPlanePrincipal = Depends(require_data_plane_principal),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> dict:
    """业务写通道（Q1/ADR-0006）：ops 单事务原子；通道归属由凭据决定
    （wdk- → data-key + 指纹；console 会话 → console）。"""
    dataset = _dataset_or_404(db, dataset_id, principal.customer_id)
    ensure_dataset_allowed(principal, dataset_id)
    try:
        service.ensure_storage_quota(
            db,
            customer_id=principal.customer_id,
            incoming_bytes=_estimate_batch_bytes(body.ops),
        )
    except service.QuotaExceeded as exc:
        _raise_quota(exc)
    result = _engine_call(
        engine_factory,
        principal,
        TOOL_WRITE_BATCH,
        {
            "dataset_key": dataset.key,
            "ops": [op.model_dump() for op in body.ops],
            "actor": principal.actor_label or principal.actor_id or principal.customer_id,
            "channel": principal.channel,
            "actor_id": principal.actor_id,
            "actor_label": body.actor_label or principal.actor_label,
        },
    )
    _sync_row_count(db, dataset, engine_factory, principal)
    return result


# ── schema 演化 ──────────────────────────────────────────────────────


@router.post("/api/v1/datasets/{dataset_id}/columns", response_model=DatasetOut)
def dataset_add_column(
    dataset_id: str,
    body: AddColumnIn,
    principal: DataPlanePrincipal = Depends(require_data_plane_principal),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> DatasetOut:
    dataset = _dataset_or_404(db, dataset_id, principal.customer_id)
    ensure_dataset_allowed(principal, dataset_id)
    result = _engine_call(
        engine_factory,
        principal,
        TOOL_ADD_COLUMN,
        {"dataset_key": dataset.key, "column": body.column.model_dump()},
    )
    if isinstance(result.get("columns"), list):
        dataset.columns_json = result["columns"]
        db.commit()
        db.refresh(dataset)
    return DatasetOut.from_dataset(dataset)


# ── 派生 ─────────────────────────────────────────────────────────────


def _register_derived_child(
    db: Session,
    *,
    principal: DataPlanePrincipal,
    source: Dataset,
    name: str,
    engine_result: dict,
) -> Dataset:
    child_key = str(engine_result.get("dataset_key") or "")
    if not child_key:
        raise HTTPException(status_code=502, detail="引擎派生未返回 dataset_key")
    dataset = Dataset(
        customer_id=principal.customer_id,
        key=child_key,
        name=name,
        source_kind="derived",
        connector_id=None,
        source_ref=source.key,
        columns_json=[],
        row_count=int(engine_result.get("rows") or 0),
        size_bytes=0,
        sync_status="ok",
    )
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return dataset


@router.post("/api/v1/datasets/{dataset_id}/derive", response_model=DatasetOut, status_code=201)
def dataset_derive(
    dataset_id: str,
    body: DeriveIn,
    principal: DataPlanePrincipal = Depends(require_data_plane_principal),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> DatasetOut:
    """以 {dataset_id} 为源派生子集（Q13）：引擎血缘留档，子 key 由引擎侧
    （本 api 经 create_declared 同款 allocate 语义）落定。"""
    source = _dataset_or_404(db, dataset_id, principal.customer_id)
    ensure_dataset_allowed(principal, dataset_id)
    try:
        service.ensure_new_dataset_room(db, customer_id=principal.customer_id)
    except service.QuotaExceeded as exc:
        _raise_quota(exc)
    child_key = service.allocate_key(db, customer_id=principal.customer_id, name=body.name)
    result = _engine_call(
        engine_factory,
        principal,
        TOOL_DERIVE,
        {
            "child_key": child_key,
            "parent_key": source.key,
            "filters": body.filters,
            "sort": body.sort,
            "limit": body.limit,
            "actor": _actor(principal.customer_id),
            "channel": principal.channel,
        },
    )
    child = _register_derived_child(
        db, principal=principal, source=source, name=body.name, engine_result={**result, "dataset_key": child_key}
    )
    # 列与体量以引擎为准回填（派生集列=源列，join 额外值列）
    _sync_columns_and_size(db, child, engine_factory, principal)
    return DatasetOut.from_dataset(child)


def _sync_columns_and_size(
    db: Session,
    dataset: Dataset,
    engine_factory: EngineClientFactory,
    principal: DataPlanePrincipal,
) -> None:
    result = _engine_call(engine_factory, principal, TOOL_OVERVIEW, {"dataset_key": dataset.key})
    if isinstance(result.get("columns"), list):
        dataset.columns_json = result["columns"]
    dataset.row_count = int(result.get("rows") or 0)
    dataset.size_bytes = int(result.get("size_bytes") or 0)
    db.commit()


@router.post("/api/v1/datasets/{dataset_id}/join", response_model=DatasetOut, status_code=201)
def dataset_join(
    dataset_id: str,
    body: JoinIn,
    principal: DataPlanePrincipal = Depends(require_data_plane_principal),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> DatasetOut:
    """指标连接派生（Q17）：指标序列经 cell 引擎走 wire 入口拉取并计量；
    未命中值列填 null。未解析地区在响应明细（dataset.detail 查 lineage）。"""
    source = _dataset_or_404(db, dataset_id, principal.customer_id)
    ensure_dataset_allowed(principal, dataset_id)
    try:
        service.ensure_new_dataset_room(db, customer_id=principal.customer_id)
    except service.QuotaExceeded as exc:
        _raise_quota(exc)
    child_key = service.allocate_key(db, customer_id=principal.customer_id, name=body.name)
    result = _engine_call(
        engine_factory,
        principal,
        TOOL_JOIN_INDICATORS,
        {
            "child_key": child_key,
            "parent_key": source.key,
            "indicators": [i.model_dump(by_alias=True) for i in body.indicators],
            "date_column": body.date_column,
            "region_column": body.region_column,
            "default_entity": body.default_entity,
            "filters": body.filters,
            "actor": _actor(principal.customer_id),
            "channel": principal.channel,
        },
    )
    child = _register_derived_child(
        db, principal=principal, source=source, name=body.name, engine_result={**result, "dataset_key": child_key}
    )
    _sync_columns_and_size(db, child, engine_factory, principal)
    return DatasetOut.from_dataset(child)


@router.post("/api/v1/datasets/{dataset_id}/refresh", response_model=DatasetOut)
def dataset_refresh(
    dataset_id: str,
    principal: DataPlanePrincipal = Depends(require_data_plane_principal),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> DatasetOut:
    """重派生：按存档 spec 对源当前有效态重算（join 会重拉指标=再次计量）。"""
    dataset = _dataset_or_404(db, dataset_id, principal.customer_id)
    ensure_dataset_allowed(principal, dataset_id)
    if dataset.source_kind != "derived":
        raise HTTPException(
            status_code=400,
            detail=f"仅派生数据集可刷新（source_kind={dataset.source_kind}）",
        )
    _engine_call(
        engine_factory, principal, TOOL_DERIVE_REFRESH, {"dataset_key": dataset.key}
    )
    _sync_columns_and_size(db, dataset, engine_factory, principal)
    db.refresh(dataset)
    return DatasetOut.from_dataset(dataset)


@router.get("/api/v1/datasets/{dataset_id}/lineage")
def dataset_lineage(
    dataset_id: str,
    principal: DataPlanePrincipal = Depends(require_data_plane_principal),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> dict:
    """血缘（引擎 key → dataset_id 映射后返回，附未解析地区等派生明细）。"""
    dataset = _dataset_or_404(db, dataset_id, principal.customer_id)
    ensure_dataset_allowed(principal, dataset_id)
    result = _engine_call(
        engine_factory, principal, TOOL_LINEAGE, {"dataset_key": dataset.key}
    )
    key_to_id = {
        row.key: row.id
        for row in db.execute(
            select(Dataset).where(Dataset.customer_id == principal.customer_id)
        ).scalars()
    }
    for entry in result.get("derivation", []):
        if entry.get("parent_key") in key_to_id:
            entry["parent_dataset_id"] = key_to_id[entry["parent_key"]]
    for child in result.get("children", []):
        if child.get("dataset_key") in key_to_id:
            child["dataset_id"] = key_to_id[child["dataset_key"]]
    return result


# ── 定时重派生（6.1，搭 materialization 调度器）─────────────────────


class ScheduleIn(BaseModel):
    """五字段 cron（naive UTC；客户时区由登记侧换算——cron.py 既有 v1 口径）。"""

    cron: str = Field(min_length=5, max_length=64)


@router.put("/api/v1/datasets/{dataset_id}/schedule")
def dataset_put_schedule(
    dataset_id: str,
    body: ScheduleIn,
    principal: DataPlanePrincipal = Depends(require_data_plane_principal),
    db: Session = Depends(get_db),
) -> dict:
    """为派生数据集登记/更新定时重派生（唯一调度行 per 数据集）。"""
    from ..materialization.cron import parse_cron
    from ..materialization.db import get_session as get_mat_session
    from ..materialization.models import MaterializedArtifact

    dataset = _dataset_or_404(db, dataset_id, principal.customer_id)
    ensure_dataset_allowed(principal, dataset_id)
    if dataset.source_kind != "derived":
        raise HTTPException(
            status_code=400, detail=f"仅派生数据集可登记定时重派生（source_kind={dataset.source_kind}）"
        )
    try:
        parse_cron(body.cron)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    mat = get_mat_session()
    try:
        row = mat.execute(
            select(MaterializedArtifact).where(
                MaterializedArtifact.kind == "derived_dataset",
                MaterializedArtifact.ref_key == dataset_id,
            )
        ).scalar_one_or_none()
        if row is None:
            row = MaterializedArtifact(
                artifact_id=None,
                customer_id=principal.customer_id,
                kind="derived_dataset",
                ref_key=dataset_id,
                spec={"dataset_id": dataset_id, "name": dataset.name},
                schedule=body.cron,
                enabled=True,
            )
            mat.add(row)
        else:
            row.schedule = body.cron
            row.enabled = True
        mat.commit()
        mat.refresh(row)
        return {
            "dataset_id": dataset_id,
            "cron": row.schedule,
            "enabled": row.enabled,
            "last_run_at": row.last_run_at.isoformat() if row.last_run_at else None,
            "last_status": row.last_status,
        }
    finally:
        mat.close()


@router.get("/api/v1/datasets/{dataset_id}/schedule")
def dataset_get_schedule(
    dataset_id: str,
    principal: DataPlanePrincipal = Depends(require_data_plane_principal),
    db: Session = Depends(get_db),
) -> dict:
    _dataset_or_404(db, dataset_id, principal.customer_id)
    ensure_dataset_allowed(principal, dataset_id)
    from ..materialization.db import get_session as get_mat_session
    from ..materialization.models import MaterializedArtifact

    mat = get_mat_session()
    try:
        row = mat.execute(
            select(MaterializedArtifact).where(
                MaterializedArtifact.kind == "derived_dataset",
                MaterializedArtifact.ref_key == dataset_id,
            )
        ).scalar_one_or_none()
        if row is None:
            return {"dataset_id": dataset_id, "cron": None, "enabled": False}
        return {
            "dataset_id": dataset_id,
            "cron": row.schedule,
            "enabled": row.enabled,
            "last_run_at": row.last_run_at.isoformat() if row.last_run_at else None,
            "last_status": row.last_status,
            "last_error": row.last_error,
            "last_rows": row.last_rows,
        }
    finally:
        mat.close()


@router.delete("/api/v1/datasets/{dataset_id}/schedule")
def dataset_delete_schedule(
    dataset_id: str,
    principal: DataPlanePrincipal = Depends(require_data_plane_principal),
    db: Session = Depends(get_db),
) -> dict:
    _dataset_or_404(db, dataset_id, principal.customer_id)
    ensure_dataset_allowed(principal, dataset_id)
    from ..materialization.db import get_session as get_mat_session
    from ..materialization.models import MaterializedArtifact

    mat = get_mat_session()
    try:
        row = mat.execute(
            select(MaterializedArtifact).where(
                MaterializedArtifact.kind == "derived_dataset",
                MaterializedArtifact.ref_key == dataset_id,
            )
        ).scalar_one_or_none()
        if row is not None:
            mat.delete(row)
            mat.commit()
        return {"dataset_id": dataset_id, "removed": True}
    finally:
        mat.close()
