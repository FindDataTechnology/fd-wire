"""需求单 API 路由。

客户侧（Bearer ID token → logto_sub → Customer，wire-self-serve-launch 4.5
身份切换；X-Customer-Id 占位头退位不再接受，缺失/未映射 401）：
- ``POST /api/v1/demands``            提交意向单（四入参：需求描述/联系邮箱/
                                      公司名/目录锚点，wire-ux-consolidation 3.2；
                                      新单 submitted 时异步邮件通知运营邮箱）
- ``GET  /api/v1/demands``            本企业列表（含当前状态+时间线）
- ``GET  /api/v1/demands/{id}``       详情（非本企业一律 404；只含客户可见字段）

内部侧（``X-Internal-Token`` 与 ``FD_WIRE_INTERNAL_TOKEN`` 比对）：
- ``POST /internal/demands/{id}/transition``  目标状态+note（三态白名单裁决，
                                      非法 409；delivered 后自动建私有 scope）
- ``POST /internal/demands/{id}/evaluation``  旧八态工作流遗留：对现行状态
                                      一律 409（评估字段随旧单保留可查）
- ``POST /internal/demands/{id}/quote``       旧八态工作流遗留：报价不进三态
                                      状态机，一律 409（quote 字段保留可查）

另见 admin_routes.py：``GET /internal/demands/{id}``（确认台内部完整视图）；
pipeline_routes.py：流水线事实 / gate 结果 / 交付 / 授权转公开端点。
"""

from __future__ import annotations

import os
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from . import delivery as delivery_service
from . import notifications, service
from .db import get_db
from ..console.auth import require_console_customer_id
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
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> DemandOut:
    """提交意向单：初始 submitted；新单异步邮件通知运营（失败仅留痕）。"""
    demand = service.create_demand(db, customer_id=customer_id, payload=payload)
    notifications.notify_new_demand(demand)  # 解耦：通知失败不影响提交结果
    return DemandOut.model_validate(demand)


@router.get("/api/v1/demands", response_model=list[DemandOut])
def list_demands(
    status_filter: DemandStatus | None = Query(default=None, alias="status"),
    customer_id: str = Depends(require_console_customer_id),
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
    customer_id: str = Depends(require_console_customer_id),
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
    """状态迁移：三态白名单裁决（非法 409 如实回显），历史只追加。

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
        )
    except TransitionError as exc:
        raise _conflict(exc) from exc
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
    """写 AI 预评估结论概要（旧八态工作流遗留端点：现行状态一律 409）。"""
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
    """报价端点（旧八态工作流遗留）：报价不进三态状态机，一律 409。

    硬前置（confirmed_by_operator 与 operator 缺一 409）维持原语义；
    「须先处于 evaluating」的前置在现行单上永不满足——存量 quote 字段
    随旧单保留可查（设计 D4）。
    """
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
