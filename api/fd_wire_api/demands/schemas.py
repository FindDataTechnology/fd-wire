"""demands API 的请求/响应模型（pydantic v2）。"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .statemachine import DemandStatus


class DemandCreate(BaseModel):
    """客户提交需求单（可带目录导流的 linked_indicators）。"""

    title: str = Field(min_length=1, max_length=200)
    intent: str = Field(min_length=1)
    entities_hint: Any = None
    frequency_expect: str | None = Field(default=None, max_length=64)
    linked_indicators: list[str] = Field(default_factory=list)


class HistoryEvent(BaseModel):
    """时间线条目：{status, at, by, note}。"""

    status: str
    at: str
    by: str
    note: str | None = None


class DeliveryOut(BaseModel):
    """客户可见交付视图：不含 delivery_events 全文与失败错误串等内部细节。"""

    model_config = ConfigDict(from_attributes=True)

    scope_name: str | None = None
    #: None=未发起 / "ok"=私有 scope 已就绪 / "pending"=交付挂起重试中
    scope_status: str | None = None
    #: 授权转公开状态：None=未授权 / True=已授权 / False=已撤回
    publish_authorized: bool | None = None


class DemandOut(BaseModel):
    """需求单客户视图（含客户可见时间线/评估概要/拒绝理由/报价摘要）。

    绝不携带内部字段：evaluation_detail（评估全文）、quote_operator、
    quote_history、quote_amount_micro（微元整数仅内部账用）、
    pipeline_events / delivery_events 全文（内部留档）。
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    customer_id: str
    title: str
    intent: str
    entities_hint: Any = None
    frequency_expect: str | None = None
    linked_indicators: list[str] = []
    status: str
    status_history: list[HistoryEvent] = []
    evaluation_summary: str | None = None
    rejection_reason: str | None = None
    quote_amount: Decimal | None = None
    quote_note: str | None = None
    quote_valid_until: datetime | None = None
    #: 交付视图（任务 6.6，客户可见）：私有 scope 交付状态 + 授权转公开状态
    delivery: DeliveryOut | None = None
    created_at: datetime
    updated_at: datetime


class DemandInternalOut(DemandOut):
    """需求单内部完整视图（人工报价确认台用）：叠加评估全文与报价留档。"""

    evaluation_detail: dict | None = None
    quote_amount_micro: int | None = None
    quote_operator: str | None = None
    quote_history: list[dict[str, Any]] = []
    #: 流水线事件全文（任务 6.5，内部视图透出）
    pipeline_events: list[dict[str, Any]] = []
    #: 交付事件全文（任务 6.6，内部视图透出）
    delivery_events: list[dict[str, Any]] = []
    #: gate 门禁摘要：{passed, attempts, pipeline_runs, latest}
    gate: dict[str, Any] | None = None
    #: 私有 scope 交付状态（内部直读，不必进客户 delivery 视图）
    scope_status: str | None = None
    scope_name: str | None = None


class TransitionIn(BaseModel):
    """内部迁移请求：目标状态 + 说明；quoted/rejected 有额外前置。"""

    target_status: DemandStatus
    note: str | None = None
    by: str = "system"
    reason: str | None = None
    confirmed_by_operator: bool = False


class EvaluationIn(BaseModel):
    """AI 预评估结论概要（写入 evaluation_summary）。

    detail 可选：携带时落内部全文 evaluation_detail（不携带则保留既有值）。
    """

    summary: str = Field(min_length=1)
    by: str = "ai"
    detail: dict[str, Any] | None = None


class QuoteIn(BaseModel):
    """人工确认后的报价写入；confirmed_by_operator + operator 为硬前置。

    金额以微元整数为准（amount_micro，与 billing.money 约定一致）；
    兼容参 amount（元，自动换算）。confirmed_by_operator 缺省 False、
    operator 缺省 None——两者任一缺失都由业务层判 409（缺一 409，而非 422）。
    """

    amount_micro: int | None = Field(default=None, ge=0)
    amount: Decimal | None = Field(default=None, ge=0)
    note: str | None = None
    valid_until: datetime | None = None
    confirmed_by_operator: bool = False
    operator: str | None = Field(default=None, max_length=64)
    by: str = "operator"


class PipelineRunIn(BaseModel):
    """流水线事实记录（任务 6.5）：building 期 append-only 落 pipeline_events。"""

    pipeline_run_id: str = Field(min_length=1, max_length=128)
    repo: str | None = Field(default=None, max_length=256)
    branch: str | None = Field(default=None, max_length=128)
    note: str | None = None
    by: str = "pipeline"


class GateResultIn(BaseModel):
    """conformance gate 结果（任务 6.5）：passed=true 才放行交付验收迁移。"""

    passed: bool
    report_path: str | None = Field(default=None, max_length=512)
    note: str | None = None
    by: str = "pipeline"


class DeliverIn(BaseModel):
    """交付动作（任务 6.6）：delivery_acceptance→delivered + 自动建私有 scope。

    indicators 缺省用需求单的 linked_indicators；source_dbs 可选
    （scope 的 source 维 allow-list）。
    """

    by: str = "customer"
    note: str | None = None
    indicators: list[str] | None = None
    source_dbs: list[str] = Field(default_factory=list)


class PublishAuthorizationIn(BaseModel):
    """客户授权转公开 / 撤回（任务 6.6）：append-only 留档，可反复撤回再授权。"""

    granted: bool
    conditions: str | None = None
    by: str | None = Field(default=None, max_length=128)
    indicators: list[str] | None = None
