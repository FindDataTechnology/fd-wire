"""需求单 API 路由。

客户侧（``X-Customer-Id`` 头标识企业，暂为骨架鉴权，接 wire-customer-identity 后替换）：
- ``POST /api/v1/demands``            提交（可带目录预填 linked_indicators）
- ``GET  /api/v1/demands``            本企业列表（含当前状态+时间线）
- ``GET  /api/v1/demands/{id}``       详情（非本企业一律 404；只含客户可见字段，
                                      评估只给概要 evaluation_summary，报价只给
                                      金额/说明/有效期，绝不携带 operator 等内部信息）

内部侧（``X-Internal-Token`` 与 ``FD_WIRE_INTERNAL_TOKEN`` 比对）：
- ``POST /internal/demands/{id}/transition``  目标状态+note（校验白名单与前置；
                                      迁移到 evaluating 成功后自动跑 AI 预评估）
- ``POST /internal/demands/{id}/evaluation``  写 AI 预评估结论概要（可带内部 detail）
- ``POST /internal/demands/{id}/quote``       报价确认台：confirmed_by_operator
                                      与 operator 缺一 409；落库微元金额+有效期，
                                      quote_history append-only，迁移 quoted

另见 admin_routes.py：``POST /internal/demands/{id}/evaluate``（AI 预评估独立
触发端点）与 ``GET /internal/demands/{id}``（确认台内部完整视图）。
"""

from __future__ import annotations

import os
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from . import delivery as delivery_service
from . import evaluation, service
from .db import get_db
from ..delivery.scope_client import ScopeClient, scope_client_dep
from .schemas import (
    DemandCreate,
    DemandInternalOut,
    DemandOut,
    EvaluationIn,
    QuoteIn,
    TransitionIn,
)
from .statemachine import DemandStatus, TransitionError

router = APIRouter(tags=["demands"])

_DEFAULT_INTERNAL_TOKEN = "wire-internal-dev"


def _customer_id(
    x_customer_id: str | None = Header(default=None, alias="X-Customer-Id"),
) -> str:
    """客户身份：骨架阶段用显式头，缺失即 401。"""
    if not x_customer_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少 X-Customer-Id（客户身份头）",
        )
    return x_customer_id


def _require_internal(
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> None:
    """内部调用鉴权：与 FD_WIRE_INTERNAL_TOKEN 常量时间比对。"""
    expected = os.getenv("FD_WIRE_INTERNAL_TOKEN", _DEFAULT_INTERNAL_TOKEN)
    if not x_internal_token or not secrets.compare_digest(x_internal_token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="内部端点需要有效的 X-Internal-Token",
        )


def _demand_or_404(db: Session, demand_id: int):
    try:
        return service.get_demand(db, demand_id)
    except service.DemandNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _conflict(exc: TransitionError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


# ---------------------------------------------------------------- 客户侧


@router.post(
    "/api/v1/demands",
    status_code=status.HTTP_201_CREATED,
    response_model=DemandOut,
)
def submit_demand(
    payload: DemandCreate,
    customer_id: str = Depends(_customer_id),
    db: Session = Depends(get_db),
) -> DemandOut:
    """提交需求单：初始 submitted，可携带目录导流的 indicator code 列表。"""
    demand = service.create_demand(db, customer_id=customer_id, payload=payload)
    return DemandOut.model_validate(demand)


@router.get("/api/v1/demands", response_model=list[DemandOut])
def list_demands(
    status_filter: DemandStatus | None = Query(default=None, alias="status"),
    customer_id: str = Depends(_customer_id),
    db: Session = Depends(get_db),
) -> list[DemandOut]:
    """本企业需求单列表：当前状态 + 完整时间线。"""
    demands = service.list_demands(
        db, customer_id=customer_id, status=status_filter
    )
    return [DemandOut.model_validate(d) for d in demands]


@router.get("/api/v1/demands/{demand_id}", response_model=DemandOut)
def get_demand(
    demand_id: int,
    customer_id: str = Depends(_customer_id),
    db: Session = Depends(get_db),
) -> DemandOut:
    """需求单详情（仅本企业可见；他企或不存在一律 404）。"""
    try:
        demand = service.get_customer_demand(
            db, demand_id=demand_id, customer_id=customer_id
        )
    except service.DemandNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return DemandOut.model_validate(demand)


# ---------------------------------------------------------------- 内部侧


@router.post(
    "/internal/demands/{demand_id}/transition",
    response_model=DemandInternalOut,
    dependencies=[Depends(_require_internal)],
)
def transition_demand(
    demand_id: int,
    payload: TransitionIn,
    db: Session = Depends(get_db),
    scope_client: ScopeClient | None = Depends(scope_client_dep),
) -> DemandInternalOut:
    """状态迁移：校验合法迁移表与前置条件（非法 409），历史只追加。

    迁移到 ``evaluating`` 成功后自动跑一次 AI 预评估（evaluation.py）：
    LLM 不可用/解析失败时如实落 doubtful 兜底，绝不因评估失败打断迁移。
    迁移到 ``delivered`` 成功后自动发起客户私有 scope 交付（任务 6.6）：
    scope 面失败只落 ``scope_pending`` 留档，绝不打断迁移响应。
    """
    demand = _demand_or_404(db, demand_id)
    try:
        demand = service.apply_transition(
            db,
            demand,
            target=payload.target_status,
            by=payload.by,
            note=payload.note,
            reason=payload.reason,
            confirmed_by_operator=payload.confirmed_by_operator,
        )
    except TransitionError as exc:
        raise _conflict(exc) from exc
    demand = evaluation.maybe_auto_evaluate(db, demand)
    if payload.target_status is DemandStatus.delivered:
        demand = delivery_service.maybe_auto_deliver(db, demand, scope_client=scope_client)
    return DemandInternalOut.model_validate(demand)


@router.post(
    "/internal/demands/{demand_id}/evaluation",
    response_model=DemandInternalOut,
    dependencies=[Depends(_require_internal)],
)
def write_evaluation(
    demand_id: int,
    payload: EvaluationIn,
    db: Session = Depends(get_db),
) -> DemandInternalOut:
    """写 AI 预评估结论概要（submitted 下自动接单进入 evaluating）。"""
    demand = _demand_or_404(db, demand_id)
    try:
        demand = service.write_evaluation(
            db,
            demand,
            summary=payload.summary,
            by=payload.by,
            detail=payload.detail,
        )
    except TransitionError as exc:
        raise _conflict(exc) from exc
    return DemandInternalOut.model_validate(demand)


@router.post(
    "/internal/demands/{demand_id}/quote",
    response_model=DemandInternalOut,
    dependencies=[Depends(_require_internal)],
)
def submit_quote(
    demand_id: int,
    payload: QuoteIn,
    db: Session = Depends(get_db),
) -> DemandInternalOut:
    """报价确认台：confirmed_by_operator 与 operator 缺一 409，绝不进 quoted。"""
    demand = _demand_or_404(db, demand_id)
    try:
        demand = service.submit_quote(
            db,
            demand,
            amount=payload.amount,
            amount_micro=payload.amount_micro,
            note=payload.note,
            valid_until=payload.valid_until,
            operator=payload.operator,
            confirmed_by_operator=payload.confirmed_by_operator,
            by=payload.by,
        )
    except TransitionError as exc:
        raise _conflict(exc) from exc
    return DemandInternalOut.model_validate(demand)
