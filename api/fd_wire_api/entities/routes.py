"""实体语义层 API 路由（wire-entity-layer）。

客户侧（Bearer ID token → ``require_console_customer_id``，与
artifacts/schedules 切片同款身份键）：

- ``GET    /api/v1/entities``                          实体列表（含数据集摘要）
- ``POST   /api/v1/entities``                          声明实体 → 201
- ``PUT    /api/v1/entities/{id}`                      整量更新（重校验）
- ``DELETE /api/v1/entities/{id}`                      删（级联两端关系，带计数）
- ``POST   /api/v1/entities/{id}/relationships`        声明关系 → 201
- ``DELETE /api/v1/entities/{id}/relationships/{rid}`  删关系（须以该实体为端点）
- ``GET    /api/v1/entities/graph`                     同源图谱（空图谱 200 空集）

错误矩阵：404（他企/不存在，不泄露）；409（唯一冲突，detail 带冲突方）；
422（结构/校验，逐条文案，零半写）。

数据集摘要与属主/列校验查 datasets 表 → 必须用 datasets 库会话（生产
wire_platform/wire_datasets 分库，实体表所在的元数据库会话落不到表——
与 artifacts 的 form 属主校验同款双库注入，测试夹具合库不得掩盖此拓扑）。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..console.auth import require_console_customer_id
from ..datasets.db import get_db as get_datasets_db
from ..datasets.models import Dataset
from . import service
from .db import get_db as get_entities_db
from .models import Entity
from .service import dataset_summary

router = APIRouter(prefix="/api/v1/entities", tags=["entities"])


# ------------------------------------------------------------------ schemas


class EntityCreateIn(BaseModel):
    """声明/更新实体请求体（PUT 为整量替换，重走同一条校验链）。"""

    name: str
    dataset_id: str = Field(min_length=1)
    pk_columns: list[str]
    description: str | None = None


class DatasetSummaryOut(BaseModel):
    """数据集摘要（数据集行缺失=drift 时除 id 外如实置 None）。"""

    id: str
    key: str | None = None
    name: str | None = None
    row_count: int | None = None
    storage_tier: str | None = None


class EntityOut(BaseModel):
    """实体卡片（含数据集摘要——datasets 库会话取）。"""

    id: int
    name: str
    dataset_id: str
    pk_columns: list[str]
    description: str | None = None
    dataset: DatasetSummaryOut
    created_at: datetime
    updated_at: datetime


class RelationshipCreateIn(BaseModel):
    """声明关系请求体：目标实体 + 源列 + 目标主键列 + 基数。"""

    to_entity_id: int
    from_column: str = Field(min_length=1)
    to_column: str = Field(min_length=1)
    kind: str
    label: str | None = None


class RelationshipOut(BaseModel):
    """关系卡片（图谱 edges 同形）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    from_entity_id: int
    from_column: str
    to_entity_id: int
    to_column: str
    kind: str
    label: str | None = None
    created_at: datetime


class GraphNodeOut(BaseModel):
    id: int
    name: str
    description: str | None = None
    pk_columns: list[str]
    dataset: DatasetSummaryOut


class GraphEdgeOut(BaseModel):
    id: int
    from_entity_id: int
    from_column: str
    to_entity_id: int
    to_column: str
    kind: str
    label: str | None = None


class GraphOut(BaseModel):
    nodes: list[GraphNodeOut]
    edges: list[GraphEdgeOut]


# ------------------------------------------------------------------ helpers


def _entity_or_404(db: Session, entity_id: int, customer_id: str) -> Entity:
    try:
        return service.get_owned_entity(db, entity_id=entity_id, customer_id=customer_id)
    except service.EntityNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _entity_out(entity: Entity, datasets_db: Session) -> EntityOut:
    dataset = datasets_db.get(Dataset, entity.dataset_id)
    return EntityOut(
        id=entity.id,
        name=entity.name,
        dataset_id=entity.dataset_id,
        pk_columns=list(entity.pk_columns or []),
        description=entity.description,
        dataset=DatasetSummaryOut(
            **dataset_summary(dataset, entity.dataset_id)
        ),
        created_at=entity.created_at,
        updated_at=entity.updated_at,
    )


# ------------------------------------------------------------------ 端点


@router.get("", response_model=list[EntityOut])
def list_entities(
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_entities_db),
    datasets_db: Session = Depends(get_datasets_db),
) -> list[EntityOut]:
    """本企业实体列表（创建序；数据集摘要经 datasets 库会话）。"""
    return [
        _entity_out(entity, datasets_db)
        for entity in service.list_entities(db, customer_id=customer_id)
    ]


@router.get("/graph", response_model=GraphOut)
def get_graph(
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_entities_db),
    datasets_db: Session = Depends(get_datasets_db),
) -> GraphOut:
    """同源图谱（控制台实体页与 AI 上下文注入的唯一同源；空图谱 200 空集）。"""
    graph: dict[str, list[dict[str, Any]]] = service.entity_graph(
        db, datasets_db, customer_id=customer_id
    )
    return GraphOut(
        nodes=[GraphNodeOut(**node) for node in graph["nodes"]],
        edges=[GraphEdgeOut(**edge) for edge in graph["edges"]],
    )


@router.post("", response_model=EntityOut, status_code=status.HTTP_201_CREATED)
def create_entity(
    payload: EntityCreateIn,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_entities_db),
    datasets_db: Session = Depends(get_datasets_db),
) -> EntityOut:
    """声明实体：name/dataset 属主/pk ⊆ 列快照/双唯一 全过才落行（否则零半写）。"""
    try:
        entity = service.create_entity(
            db,
            datasets_db,
            customer_id=customer_id,
            name=payload.name,
            dataset_id=payload.dataset_id,
            pk_columns=payload.pk_columns,
            description=payload.description,
        )
    except service.EntityConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except service.InvalidEntity as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _entity_out(entity, datasets_db)


@router.put("/{entity_id}", response_model=EntityOut)
def update_entity(
    entity_id: int,
    payload: EntityCreateIn,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_entities_db),
    datasets_db: Session = Depends(get_datasets_db),
) -> EntityOut:
    """整量更新（重校验——与创建同一条链；他企/不存在一律 404）。"""
    entity = _entity_or_404(db, entity_id, customer_id)
    try:
        entity = service.update_entity(
            db,
            datasets_db,
            entity,
            name=payload.name,
            dataset_id=payload.dataset_id,
            pk_columns=payload.pk_columns,
            description=payload.description,
        )
    except service.EntityConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except service.InvalidEntity as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _entity_out(entity, datasets_db)


@router.delete("/{entity_id}")
def delete_entity(
    entity_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_entities_db),
) -> dict:
    """删实体：同事务级联删两端关系（响应带 deleted_relationships 计数留痕）。"""
    entity = _entity_or_404(db, entity_id, customer_id)
    removed = service.delete_entity(db, entity)
    return {
        "id": entity_id,
        "deleted": True,
        "deleted_relationships": removed,
    }


@router.post(
    "/{entity_id}/relationships",
    response_model=RelationshipOut,
    status_code=status.HTTP_201_CREATED,
)
def create_relationship(
    entity_id: int,
    payload: RelationshipCreateIn,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_entities_db),
    datasets_db: Session = Depends(get_datasets_db),
) -> RelationshipOut:
    """声明关系：源列 ∈ 源集列、目标列 ∈ 目标实体主键（纪律）、四元组唯一。"""
    entity = _entity_or_404(db, entity_id, customer_id)
    try:
        relationship = service.create_relationship(
            db,
            datasets_db,
            customer_id=customer_id,
            source_entity=entity,
            to_entity_id=payload.to_entity_id,
            from_column=payload.from_column,
            to_column=payload.to_column,
            kind=payload.kind,
            label=payload.label,
        )
    except service.EntityNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except service.EntityConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except service.InvalidEntity as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return RelationshipOut.model_validate(relationship)


@router.delete("/{entity_id}/relationships/{rel_id}")
def delete_relationship(
    entity_id: int,
    rel_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_entities_db),
) -> dict:
    """删关系：须属本企业且以该实体为端点，否则一律 404（不泄露）。"""
    _entity_or_404(db, entity_id, customer_id)
    try:
        service.delete_relationship(
            db, customer_id=customer_id, entity_id=entity_id, rel_id=rel_id
        )
    except service.EntityNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"id": rel_id, "deleted": True}
