"""内部后台路由（wire-platform-v1 任务 7.1）：``/internal/admin/*``。

一面五台：
1. **客户管理**：GET/POST ``/customers``、PATCH ``/customers/{id}``——
   只新增对 billing_customers/billing_plans 的只读查询与开户记录
   （直接落 Customer 行；sub2api 代建账户留给后续任务，先本地档位关联），
   不改 billing 模块内部逻辑。
2. **额度与账本**：GET ``/customers/{id}/usage``（metering_records 只读联查：
   credential_track=customer × caller=billing_customers.sub2api_user_id——v1
   身份映射由该列承载）、GET ``/ledger``（billing_ledger_entries 只读）。
3. **需求单派发台**：GET ``/demands``（全客户）、POST ``/demands/{id}/transition``
   ——转发既有内部 transition 端点语义（直接调 service 层，无 HTTP 自调）。
4. **目录治理**：GET ``/catalog/pending``（读镜像表）、POST
   ``/catalog/{indicator_id}/verify-note``——不改镜像数据（仅同步管道可写），
   审核意见只记 admin 自己的 catalog_review_notes（append-only）。
5. **用量视图（分轨）**：GET ``/usage/overview``——按 credential_track 与
   source 聚合 metering_records（复用计量聚合口径）。

鉴权：全部端点经 ``X-Admin-Token``（env ``FD_WIRE_ADMIN_TOKEN``，
fail-closed，见 auth.py）。
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..billing.models import Customer, CustomerStatus, LedgerEntry
from ..billing.models import Plan as BillingPlan
from ..billing.models import validate_period
from ..billing.plans import get_plan
from ..catalog.db import readonly_session
from ..catalog.models import IndicatorSnapshot
from ..demands import evaluation, service as demands_service
from ..demands.db import get_db as get_demands_db
from ..demands.models import Demand
from ..demands.schemas import DemandInternalOut, TransitionIn
from ..demands.statemachine import DemandStatus, TransitionError
from ..metering.db import to_utc
from ..metering.models import MeteringRecord
from ..metering.settings import ALLOWED_TRACKS
from .auth import require_admin_token
from .db import get_db
from .models import CatalogReviewNote
from .schemas import (
    CatalogPendingOut,
    CustomerCreateIn,
    CustomerOut,
    CustomerPatchIn,
    CustomerUsageOut,
    IndicatorPendingItem,
    LedgerEntryOut,
    PlanOut,
    ReviewNoteIn,
    ReviewNoteOut,
    TrackRow,
    UsageOverviewOut,
    UsagePeriodRow,
)

router = APIRouter(
    prefix="/internal/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin_token)],
)

#: 镜像状态的合法取值（与 indicator_snapshots 的 CHECK 约束一致）
_MIRROR_STATUSES = ("verified", "registered")


# ---------------------------------------------------------------------------
# 客户管理（billing_customers / billing_plans：只读查询 + 开户记录）
# ---------------------------------------------------------------------------


def _customer_or_404(db: Session, customer_id: int) -> Customer:
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail=f"customer {customer_id} 不存在")
    return customer


def _customer_out(db: Session, customer: Customer) -> CustomerOut:
    plan = db.get(BillingPlan, customer.plan_id)
    return CustomerOut(
        id=customer.id,
        name=customer.name,
        sub2api_user_id=customer.sub2api_user_id,
        plan_id=customer.plan_id,
        plan_code=plan.code if plan else "",
        plan_name=plan.name if plan else "",
        status=customer.status,
        created_at=customer.created_at,
    )


@router.get("/plans", response_model=list[PlanOut])
def list_plans(db: Session = Depends(get_db)) -> list[PlanOut]:
    """套餐档位下拉数据源（billing_plans 只读）。"""
    plans = db.execute(select(BillingPlan).order_by(BillingPlan.id)).scalars().all()
    return [PlanOut.from_plan(p) for p in plans]


@router.get("/customers", response_model=list[CustomerOut])
def list_customers(db: Session = Depends(get_db)) -> list[CustomerOut]:
    """客户列表（新→旧，带套餐档位联查字段）。"""
    customers = db.execute(select(Customer).order_by(Customer.id.desc())).scalars().all()
    return [_customer_out(db, c) for c in customers]


@router.post(
    "/customers",
    response_model=CustomerOut,
    status_code=status.HTTP_201_CREATED,
)
def create_customer(
    payload: CustomerCreateIn, db: Session = Depends(get_db)
) -> CustomerOut:
    """开户：名称 + 套餐档位（本地档位关联；sub2api 代建留给后续任务）。

    ``sub2api_user_id`` 在 v1 兼作计量身份映射（metering caller 名），
    开户时录入即建立客户 ↔ 调用身份的联查键。
    """
    try:
        plan = get_plan(db, payload.plan_code)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    duplicate = db.execute(
        select(Customer).where(Customer.name == payload.name, Customer.plan_id == plan.id)
    ).scalar_one_or_none()
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"同名同档客户已存在（id={duplicate.id}）",
        )

    customer = Customer(
        name=payload.name,
        sub2api_user_id=payload.sub2api_user_id or None,
        plan_id=plan.id,
        status=CustomerStatus.ACTIVE.value,
    )
    db.add(customer)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="客户创建冲突（sub2api_user_id 已被其他客户占用？）",
        ) from exc
    return _customer_out(db, customer)


@router.patch("/customers/{customer_id}", response_model=CustomerOut)
def patch_customer(
    customer_id: int, payload: CustomerPatchIn, db: Session = Depends(get_db)
) -> CustomerOut:
    """改套餐档位 / 客户状态（active | suspended | closed）。"""
    if payload.plan_code is None and payload.status is None:
        raise HTTPException(status_code=422, detail="至少提供 plan_code 或 status 之一")
    customer = _customer_or_404(db, customer_id)
    if payload.plan_code is not None:
        try:
            plan = get_plan(db, payload.plan_code)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        customer.plan_id = plan.id
    if payload.status is not None:
        customer.status = payload.status.value
    db.flush()
    return _customer_out(db, customer)


# ---------------------------------------------------------------------------
# 额度与账本（metering_records 只读联查 / billing_ledger_entries 只读）
# ---------------------------------------------------------------------------


@router.get("/customers/{customer_id}/usage", response_model=CustomerUsageOut)
def customer_usage(customer_id: int, db: Session = Depends(get_db)) -> CustomerUsageOut:
    """单客户用量：metering_records 中 credential_track=customer 且
    caller=该客户身份（v1 由 billing_customers.sub2api_user_id 承载）的
    只读聚合，按周期（YYYY-MM）分解。

    身份映射未建立（sub2api_user_id 为空）时如实返回空聚合。
    """
    customer = _customer_or_404(db, customer_id)
    caller = customer.sub2api_user_id

    periods: list[UsagePeriodRow] = []
    if caller:
        period_expr = func.strftime("%Y-%m", MeteringRecord.event_timestamp)
        rows = db.execute(
            select(
                period_expr.label("period"),
                func.count(MeteringRecord.id).label("calls"),
                func.sum(MeteringRecord.rows_returned).label("rows"),
            )
            .where(
                MeteringRecord.credential_track == "customer",
                MeteringRecord.caller == caller,
            )
            .group_by(period_expr)
            .order_by(period_expr)
        ).all()
        periods = [
            UsagePeriodRow(period=p, calls=int(calls), rows=int(rows or 0))
            for p, calls, rows in rows
        ]
    totals = UsagePeriodRow(
        period="all",
        calls=sum(p.calls for p in periods),
        rows=sum(p.rows for p in periods),
    )
    return CustomerUsageOut(
        customer_id=customer.id,
        customer_name=customer.name,
        caller=caller,
        credential_track="customer",
        totals=totals,
        periods=periods,
    )


@router.get("/ledger", response_model=list[LedgerEntryOut])
def list_ledger(
    customer_id: int | None = Query(default=None),
    period: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[LedgerEntryOut]:
    """账本流水（billing_ledger_entries 只读；可按客户与周期过滤）。"""
    if period is not None:
        try:
            validate_period(period)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    if customer_id is not None:
        _customer_or_404(db, customer_id)
    stmt = select(LedgerEntry).order_by(LedgerEntry.id)
    if customer_id is not None:
        stmt = stmt.where(LedgerEntry.customer_id == customer_id)
    if period is not None:
        stmt = stmt.where(LedgerEntry.period == period)
    entries = db.execute(stmt).scalars().all()
    return [LedgerEntryOut.from_entry(e) for e in entries]


# ---------------------------------------------------------------------------
# 需求单派发台（demands：全客户列表 + 状态机迁移转发）
# ---------------------------------------------------------------------------


@router.get("/demands", response_model=list[DemandInternalOut])
def list_demands(
    status_filter: DemandStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_demands_db),
) -> list[DemandInternalOut]:
    """全客户需求单列表（新→旧，可按状态过滤；内部完整视图）。"""
    stmt = select(Demand).order_by(Demand.id.desc())
    if status_filter is not None:
        stmt = stmt.where(Demand.status == status_filter.value)
    demands = db.execute(stmt).scalars().all()
    return [DemandInternalOut.model_validate(d) for d in demands]


@router.post("/demands/{demand_id}/transition", response_model=DemandInternalOut)
def transition_demand(
    demand_id: int,
    payload: TransitionIn,
    db: Session = Depends(get_demands_db),
) -> DemandInternalOut:
    """派发操作：转发既有内部 transition 端点语义（直调 service 层）。

    - 非法迁移/前置不满足 → 409（状态机白名单裁决，与内部端点一致）；
    - 迁移到 evaluating 成功后同样自动跑一次 AI 预评估（maybe_auto_evaluate，
      LLM 不可用时如实落 doubtful，绝不打断迁移）。
    """
    try:
        demand = demands_service.get_demand(db, demand_id)
    except demands_service.DemandNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    try:
        demand = demands_service.apply_transition(
            db,
            demand,
            target=payload.target_status,
            by=payload.by or "admin-console",
            note=payload.note,
            reason=payload.reason,
            confirmed_by_operator=payload.confirmed_by_operator,
        )
    except TransitionError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    demand = evaluation.maybe_auto_evaluate(db, demand)
    return DemandInternalOut.model_validate(demand)


# ---------------------------------------------------------------------------
# 目录治理（镜像只读 + 审核意见 append-only）
# ---------------------------------------------------------------------------


@router.get("/catalog/pending", response_model=CatalogPendingOut)
def catalog_pending(
    mirror_status: str = Query(default="registered", alias="status"),
) -> CatalogPendingOut:
    """镜像目录列表（默认 registered=待治理；verified 可复查）。

    只读：镜像仅同步管道可写（spec wire-indicator-catalog），
    状态修改在权威库侧完成，本台只看不改。
    """
    if mirror_status not in _MIRROR_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"status must be one of {list(_MIRROR_STATUSES)}",
        )
    with readonly_session() as session:
        rows = (
            session.execute(
                select(IndicatorSnapshot)
                .where(IndicatorSnapshot.status == mirror_status)
                .order_by(IndicatorSnapshot.indicator_id)
            )
            .scalars()
            .all()
        )
        items = [
            IndicatorPendingItem(
                indicator_id=r.indicator_id,
                code=r.code,
                name_zh=r.name_zh,
                name_en=r.name_en,
                domain=r.domain,
                frequency=r.frequency,
                status=r.status,
                synced_at=r.synced_at,
            )
            for r in rows
        ]
    return CatalogPendingOut(status=mirror_status, items=items, total=len(items))


@router.post(
    "/catalog/{indicator_id}/verify-note",
    response_model=ReviewNoteOut,
    status_code=status.HTTP_201_CREATED,
)
def add_verify_note(
    indicator_id: str, payload: ReviewNoteIn, db: Session = Depends(get_db)
) -> ReviewNoteOut:
    """记录一条审核意见（append-only 到 admin 自己的 catalog_review_notes）。

    不改镜像数据：镜像行状态只能在权威库侧修改，本端点仅留档人工意见。
    指标不在镜像中 → 404（如实拒绝，不凭空留档）。
    """
    if not payload.note.strip():
        raise HTTPException(status_code=422, detail="审核意见不能为空白")
    with readonly_session() as session:
        exists = session.execute(
            select(IndicatorSnapshot.id).where(
                IndicatorSnapshot.indicator_id == indicator_id
            )
        ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(
            status_code=404, detail=f"indicator {indicator_id!r} 不在目录镜像中"
        )
    note = CatalogReviewNote(
        indicator_id=indicator_id,
        note=payload.note,
        author=payload.author or "admin-console",
    )
    db.add(note)
    db.flush()
    return ReviewNoteOut(
        id=note.id,
        indicator_id=note.indicator_id,
        note=note.note,
        author=note.author,
        created_at=note.created_at.isoformat() if note.created_at else "",
    )


@router.get("/catalog/{indicator_id}/notes", response_model=list[ReviewNoteOut])
def list_verify_notes(
    indicator_id: str, db: Session = Depends(get_db)
) -> list[ReviewNoteOut]:
    """某指标的审核意见留档（时间正序，只追加不可改）。"""
    notes = (
        db.execute(
            select(CatalogReviewNote)
            .where(CatalogReviewNote.indicator_id == indicator_id)
            .order_by(CatalogReviewNote.id)
        )
        .scalars()
        .all()
    )
    return [
        ReviewNoteOut(
            id=n.id,
            indicator_id=n.indicator_id,
            note=n.note,
            author=n.author,
            created_at=n.created_at.isoformat() if n.created_at else "",
        )
        for n in notes
    ]


# ---------------------------------------------------------------------------
# 用量视图（分轨概览：credential_track × source）
# ---------------------------------------------------------------------------


def _parse_window(name: str, value: str | None) -> datetime | None:
    if value is None:
        return None
    try:
        return to_utc(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{name} must be ISO-8601 datetime") from exc


@router.get("/usage/overview", response_model=UsageOverviewOut)
def usage_overview(
    credential_track: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> UsageOverviewOut:
    """分轨用量概览：按 credential_track（customer/platform）与 source
    （yizuo/wanxing/platform-internal/customer）聚合 metering_records，
    可按轨道与时间窗过滤——客户轨/平台轨数字卡与来源分布的数据源。
    """
    if credential_track is not None and credential_track not in ALLOWED_TRACKS:
        raise HTTPException(
            status_code=422,
            detail=f"credential_track must be one of {list(ALLOWED_TRACKS)}",
        )
    start_dt = _parse_window("start", start)
    end_dt = _parse_window("end", end)

    conditions = []
    if credential_track:
        conditions.append(MeteringRecord.credential_track == credential_track)
    if start_dt:
        conditions.append(MeteringRecord.event_timestamp >= start_dt)
    if end_dt:
        conditions.append(MeteringRecord.event_timestamp <= end_dt)

    def _grouped(dimension):
        stmt = select(
            dimension.label("key"),
            func.count(MeteringRecord.id).label("calls"),
            func.sum(MeteringRecord.rows_returned).label("rows"),
        ).group_by(dimension)
        for condition in conditions:
            stmt = stmt.where(condition)
        stmt = stmt.order_by(dimension)
        return [
            TrackRow(key=key, calls=int(calls), rows=int(rows or 0))
            for key, calls, rows in db.execute(stmt).all()
        ]

    tracks = _grouped(MeteringRecord.credential_track)
    by_source = _grouped(MeteringRecord.source)
    totals = TrackRow(
        key="all",
        calls=sum(t.calls for t in tracks),
        rows=sum(t.rows for t in tracks),
    )
    return UsageOverviewOut(
        credential_track=credential_track,
        start=start,
        end=end,
        tracks=tracks,
        by_source=by_source,
        totals=totals,
    )
