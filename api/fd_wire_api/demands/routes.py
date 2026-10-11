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
- ``POST /api/v1/demands/{id}/workorder``     生成 health-loop 工单入拉取队列
                                      （操作员/内部身份；仅 in_progress、出单
                                      不迁移状态；响应带全文供人工推送降级）
- ``GET  /internal/demands/workorders/pending`` 舰队拉取器取待投递工单
                                      （每单至多一条最新未 ack 导出、仅
                                      in_progress 单；design D1 舰队拉取通道）
- ``POST /internal/demands/workorders/ack``   拉取器落仓自推成功后回 ack
                                      （幂等：同工单重复 ack 不重复记事件）

另见 admin_routes.py：``GET /internal/demands/{id}``（确认台内部完整视图）；
pipeline_routes.py：流水线事实 / gate 结果 / 交付 / 授权转公开端点。
"""

from __future__ import annotations

import hashlib
import os
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from . import delivery as delivery_service
from . import notifications, orchestration, service
from .db import get_db
from .orchestration import WorkorderAckIn, WorkorderIn, WorkorderNotFound
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


# ------------------------------------------- 生成工单与舰队拉取投递（编排任务 2.2+2.3）


@router.post(
    "/api/v1/demands/{demand_id}/workorder",
    dependencies=[Depends(_require_internal)],
)
def export_workorder(
    demand_id: int,
    payload: WorkorderIn | None = None,
    db: Session = Depends(get_db),
) -> dict:
    """生成 health-loop 工单入拉取队列（操作员/内部身份；出单不迁移状态）。

    映射与脱敏红线见 ``demands/orchestration.py``（工单全文不含
    contact_email、公司名只以客户代号留档）。流程：
    - 仅 ``in_progress`` 可出单（409 如实回绝，文案照状态机风格）；
    - 无 source_urls 的存量单 422（生成流只承接带合法源地址的新单）；
    - slug 仓内已占用 → 409 转人工（非 greenfield 不走生成流）；
    - 出单 → ``workorder_exported`` 全文+哈希 append-only 留档即入队，
      由 fd-industry-data 侧拉取工作流拉取-落仓-自推-回 ack（wire 零
      外部 git 凭据，design D1 舰队拉取通道）；
    - 响应恒带工单全文供人工推送降级——出单时刻未投递（``delivered``
      =false），绝不展示自动化投递成功假象。
    """
    demand = _demand_or_404(db, demand_id)
    current = DemandStatus(demand.status)
    if current is not DemandStatus.in_progress:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"生成工单只能在 in_progress 状态导出（当前 {current.value}）"
                "——工单属于处理期（出单不迁移状态）"
            ),
        )
    source_urls = orchestration.demand_source_urls(demand)
    if not source_urls:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"需求单 {demand.code} 没有 source_urls（存量单无源地址）——"
                "生成工单必须来自带合法源地址的新单；存量单请人工补源地址"
                "或线下处理"
            ),
        )
    override = payload.slug if payload is not None else None
    try:
        slug = orchestration.derive_slug(source_urls[0], override=override)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    if not orchestration.check_slug_free(slug):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"slug {slug} 在 fd-industry-data 仓内已占用——"
                "非 greenfield 不走生成流，请转人工处理"
            ),
        )
    try:
        ticket_yaml, ticket_path = orchestration.build_workorder(
            demand, slug=slug
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    sha256 = hashlib.sha256(ticket_yaml.encode("utf-8")).hexdigest()
    demand.append_pipeline_event(
        {
            "type": "workorder_exported",
            "ticket_path": ticket_path,
            "ticket_yaml": ticket_yaml,
            "sha256": sha256,
        }
    )
    db.commit()  # 工单不丢：exported 事件落库即入拉取队列
    db.refresh(demand)
    return {
        "ticket_yaml": ticket_yaml,  # 全文恒随响应返回：人工推送降级始终可用
        "ticket_path": ticket_path,
        "delivered": False,  # 投递由舰队拉取器 ack 确认——出单时刻未投递
        "queued_for_pull": True,  # 已入队：等待拉取器（~30min）或人工推送
    }


@router.get(
    "/internal/demands/workorders/pending",
    dependencies=[Depends(_require_internal)],
)
def list_pending_workorders(db: Session = Depends(get_db)) -> dict:
    """舰队拉取器取待投递工单（fd-industry-data 侧工作流消费）。

    每单至多一条最新未 ack 导出、仅 in_progress 单（tasks 2.3）；载荷带
    工单全文与 sha256，拉取器按 ticket_path 落仓自推后回 ack。
    """
    return {"pending": orchestration.pending_workorders(db)}


@router.post(
    "/internal/demands/workorders/ack",
    dependencies=[Depends(_require_internal)],
)
def ack_workorder(payload: WorkorderAckIn, db: Session = Depends(get_db)) -> dict:
    """拉取器回 ack：工单已落仓自推——wire 记 ``pipeline_run`` 事件。

    幂等（spec 场景「ack 幂等」）：同工单重复 ack 不重复追加事件，
    返回既有已 ack 状态（``already_acked=true``）。未知工单路径 404
    如实回绝。
    """
    try:
        return orchestration.ack_workorder(db, payload.ticket_path)
    except WorkorderNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
