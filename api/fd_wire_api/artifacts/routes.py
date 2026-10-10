"""产物生命周期 API 路由（wire-artifacts-persistence）。

客户侧（Bearer ID token → logto_sub → Customer，与 ai/datasets 切片
同款身份键 ``require_console_customer_id``）：

- ``GET  /api/v1/artifacts``                 本企业产物列表（kind/status 过滤、更新倒序）
- ``GET  /api/v1/artifacts/{id}``             产物详情（他企一律 404）
- ``PUT  /api/v1/artifacts/{id}``             spec 更新（最小校验 → 追加新版本）
- ``GET  /api/v1/artifacts/{id}/versions``     版本历史（append-only，新在前）
- ``GET  /api/v1/artifacts/{id}/versions/{n}`` 查看任一历史版本
- ``POST /api/v1/artifacts/{id}/publish``      发布（draft → published）
- ``POST /api/v1/artifacts/{id}/archive``      归档（→ archived，不删除）
- ``POST /api/v1/artifacts/{id}/restore``      恢复（archived → draft）
- ``POST /api/v1/artifacts/from-draft``        会话草稿导入为 draft 产物

版本行只读——没有任何改写历史版本的端点（append-only 由路由面保证）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..ai.db import get_db
from ..console.auth import require_console_customer_id
from . import service
from .schemas import (
    ArtifactDetailOut,
    ArtifactFromDraftIn,
    ArtifactOut,
    ArtifactUpdateIn,
    ArtifactVersionDetailOut,
    ArtifactVersionOut,
    artifact_detail,
    version_detail,
)

router = APIRouter(tags=["artifacts"])


def _artifact_or_404(db: Session, artifact_id: int, customer_id: str):
    try:
        return service.get_customer_artifact(
            db, artifact_id=artifact_id, customer_id=customer_id
        )
    except service.ArtifactNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/api/v1/artifacts", response_model=list[ArtifactOut])
def list_artifacts(
    kind: str | None = Query(default=None),
    artifact_status: str | None = Query(default=None, alias="status"),
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> list[ArtifactOut]:
    """本企业产物列表（按更新时间倒序；kind/status 可选过滤）。"""
    rows = service.list_artifacts(
        db, customer_id=customer_id, kind=kind, status=artifact_status
    )
    return [ArtifactOut.model_validate(a) for a in rows]


@router.get("/api/v1/artifacts/{artifact_id}", response_model=ArtifactDetailOut)
def get_artifact(
    artifact_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> ArtifactDetailOut:
    """产物详情（当前 spec + 状态迁移记录；他企或不存在一律 404）。"""
    artifact = _artifact_or_404(db, artifact_id, customer_id)
    return artifact_detail(artifact, service.current_spec(db, artifact))


@router.put("/api/v1/artifacts/{artifact_id}", response_model=ArtifactDetailOut)
def update_artifact(
    artifact_id: int,
    payload: ArtifactUpdateIn,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> ArtifactDetailOut:
    """spec 更新：最小校验通过后追加新版本并递增计数（archived 拒改 409）。"""
    artifact = _artifact_or_404(db, artifact_id, customer_id)
    try:
        artifact = service.update_spec(
            db, artifact, spec=payload.spec, customer_id=customer_id
        )
    except service.ArtifactLocked as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except service.InvalidArtifactSpec as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return artifact_detail(artifact, service.current_spec(db, artifact))


@router.get(
    "/api/v1/artifacts/{artifact_id}/versions",
    response_model=list[ArtifactVersionOut],
)
def list_versions(
    artifact_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> list[ArtifactVersionOut]:
    """版本历史（新版本在前；历史版本 append-only 不可改）。"""
    artifact = _artifact_or_404(db, artifact_id, customer_id)
    rows = service.list_versions(db, artifact)
    return [ArtifactVersionOut.model_validate(r) for r in rows]


@router.get(
    "/api/v1/artifacts/{artifact_id}/versions/{version}",
    response_model=ArtifactVersionDetailOut,
)
def get_version(
    artifact_id: int,
    version: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> ArtifactVersionDetailOut:
    """查看任一历史版本（含该版本 spec 快照）。"""
    artifact = _artifact_or_404(db, artifact_id, customer_id)
    try:
        row = service.get_version(db, artifact, version)
    except service.ArtifactNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return version_detail(row)


def _transition(artifact_id: int, action: str, customer_id: str, db: Session):
    """状态迁移端点共用骨架：取产物 → 迁移 → 404/409 语义映射。"""
    artifact = _artifact_or_404(db, artifact_id, customer_id)
    handler = {
        "publish": service.publish_artifact,
        "archive": service.archive_artifact,
        "restore": service.restore_artifact,
    }[action]
    try:
        artifact = handler(db, artifact, customer_id=customer_id)
    except service.InvalidStatusTransition as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return artifact_detail(artifact, service.current_spec(db, artifact))


@router.post("/api/v1/artifacts/{artifact_id}/publish", response_model=ArtifactDetailOut)
def publish_artifact(
    artifact_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> ArtifactDetailOut:
    """发布：draft → published（非法迁移 409 说明合法路径）。"""
    return _transition(artifact_id, "publish", customer_id, db)


@router.post("/api/v1/artifacts/{artifact_id}/archive", response_model=ArtifactDetailOut)
def archive_artifact(
    artifact_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> ArtifactDetailOut:
    """归档：draft/published → archived（不删除，留操作记录）。"""
    return _transition(artifact_id, "archive", customer_id, db)


@router.post("/api/v1/artifacts/{artifact_id}/restore", response_model=ArtifactDetailOut)
def restore_artifact(
    artifact_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> ArtifactDetailOut:
    """恢复：archived → draft（唯一回退边；恢复后方可再编辑/发布）。"""
    return _transition(artifact_id, "restore", customer_id, db)


@router.post(
    "/api/v1/artifacts/from-draft",
    status_code=status.HTTP_201_CREATED,
    response_model=ArtifactDetailOut,
)
def import_from_draft(
    payload: ArtifactFromDraftIn,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> ArtifactDetailOut:
    """会话草稿导入：固化为 draft 产物（version=1，保留来源会话指针）。

    会话不存在/非本人、草稿不存在一律 404（不泄露他企存在性）。
    """
    try:
        artifact = service.import_from_draft(
            db,
            customer_id=customer_id,
            conversation_id=payload.conversation_id,
            draft_id=payload.draft_id,
        )
    except service.ArtifactNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except service.InvalidArtifactSpec as exc:  # pragma: no cover - 防御位
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return artifact_detail(artifact, service.current_spec(db, artifact))
