"""追踪主体路由（wire-subject-tracking）。

全部端点登录客户身份（``require_console_customer_id``，客户隔离）：
- ``POST   /api/v1/subjects``                        创建主体
- ``GET    /api/v1/subjects``                        列出（可选 kind 过滤）
- ``GET    /api/v1/subjects/{id}``                   详情
- ``DELETE /api/v1/subjects/{id}``                   归档（删主体并级联删通道）
- ``POST   /api/v1/subjects/{id}/channels``          加通道
- ``DELETE /api/v1/subjects/{id}/channels/{cid}``    删通道
- ``GET    /api/v1/subjects/{id}/read``              扇出读（只读，零计量）
- ``POST   /api/v1/subjects/{id}/snapshot``          物化为客户数据集
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..console.auth import require_console_customer_id
from . import service
from .db import get_db
from .schemas import ChannelIn, SubjectCreateIn, SubjectOut

router = APIRouter(prefix="/api/v1/subjects", tags=["subjects"])


def _domain_error(exc: Exception) -> HTTPException:
    if isinstance(exc, service.SubjectNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, service.SubjectError):
        return HTTPException(status_code=422, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


def _out(subject) -> SubjectOut:
    return SubjectOut.model_validate(service._subject_dict(subject))


@router.post("", response_model=SubjectOut)
def create_subject(
    body: SubjectCreateIn,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> SubjectOut:
    try:
        subject = service.create_subject(
            db, customer_id=customer_id, kind=body.kind, ref=body.ref.model_dump(),
            title=body.title, description=body.description,
            channels=[c.model_dump() for c in body.channels],
        )
        db.commit()
        db.refresh(subject)
    except service.SubjectError as exc:
        db.rollback()
        raise _domain_error(exc) from exc
    return _out(subject)


@router.get("", response_model=list[SubjectOut])
def list_subjects(
    kind: str | None = Query(default=None),
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> list[SubjectOut]:
    return [_out(s) for s in service.list_subjects(db, customer_id=customer_id, kind=kind)]


@router.get("/{subject_id}", response_model=SubjectOut)
def get_subject(
    subject_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> SubjectOut:
    try:
        return _out(service.get_subject(db, customer_id=customer_id, subject_id=subject_id))
    except service.SubjectError as exc:
        raise _domain_error(exc) from exc


@router.delete("/{subject_id}")
def archive_subject(
    subject_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        service.archive_subject(db, customer_id=customer_id, subject_id=subject_id)
        db.commit()
    except service.SubjectError as exc:
        db.rollback()
        raise _domain_error(exc) from exc
    return {"archived": subject_id}


@router.post("/{subject_id}/channels")
def add_channel(
    subject_id: int,
    body: ChannelIn,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        ch = service.add_channel(
            db, customer_id=customer_id, subject_id=subject_id,
            ctype=body.type, spec=body.spec,
        )
        db.commit()
        db.refresh(ch)
    except service.SubjectError as exc:
        db.rollback()
        raise _domain_error(exc) from exc
    return {"id": ch.id, "type": ch.type, "spec": ch.spec}


@router.delete("/{subject_id}/channels/{channel_id}")
def remove_channel(
    subject_id: int,
    channel_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        service.remove_channel(
            db, customer_id=customer_id, subject_id=subject_id, channel_id=channel_id
        )
        db.commit()
    except service.SubjectError as exc:
        db.rollback()
        raise _domain_error(exc) from exc
    return {"removed": channel_id}


@router.get("/{subject_id}/read")
def read_subject(
    subject_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        return service.read_subject(db, customer_id=customer_id, subject_id=subject_id)
    except service.SubjectError as exc:
        raise _domain_error(exc) from exc


@router.post("/{subject_id}/snapshot")
def snapshot_subject(
    subject_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        dataset = service.snapshot_subject(db, customer_id=customer_id, subject_id=subject_id)
    except service.SubjectError as exc:
        db.rollback()
        raise _domain_error(exc) from exc
    except Exception as exc:  # noqa: BLE001 - 配额等
        db.rollback()
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    return {
        "dataset_id": dataset.id,
        "dataset_key": dataset.key,
        "row_count": dataset.row_count,
    }
