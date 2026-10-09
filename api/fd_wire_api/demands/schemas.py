"""demands API 的请求/响应模型（pydantic v2）。"""

from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .statemachine import DemandStatus

#: 联系邮箱的最小形态校验（非空 + 单 @ + 两侧各有非空白字符；不追求 RFC 全集）。
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class DemandCreate(BaseModel):
    """客户提交意向单（wire-ux-consolidation 任务 3.2：轻量四入参）。

    - 需求描述（自由文本，必填——按将来对话第一条消息的形态设计）；
    - 联系邮箱（必填，最小形态校验）；
    - 公司名（选填）；
    - 目录锚点（indicator code，选填；服务端原样存储，用于预填语义）。

    旧表单字段（title/entities_hint/frequency_expect）不再收；旧调用
    携带它们会被忽略（缺必填项按 422 逐字段回显）。
    """

    description: str = Field(min_length=1)
    contact_email: str = Field(min_length=1, max_length=320)
    company: str | None = Field(default=None, max_length=200)
    indicator_code: str | None = Field(default=None, max_length=128)

    @field_validator("description")
    @classmethod
    def _description_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("需求描述不能为空（或全为空白字符）")
        return stripped

    @field_validator("contact_email")
    @classmethod
    def _email_well_formed(cls, value: str) -> str:
        stripped = value.strip()
        if not _EMAIL_RE.match(stripped):
            raise ValueError("联系邮箱格式不合法（应为 name@domain.tld 形态）")
        return stripped

    @field_validator("company", "indicator_code")
    @classmethod
    def _strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


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
    """需求单客户视图（含客户可见时间线/联系方式/拒绝理由/交付视图）。

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
    contact_email: str | None = None
    company: str | None = None
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
    """内部迁移请求：目标状态 + 说明；rejected 必带 reason（状态机裁决）。

    wire-ux-consolidation 任务 3.1 起 ``confirmed_by_operator`` 前置随
    evaluating→quoted 工作流废除（旧调用多带的字段被忽略，不影响兼容）。
    目标为废除态（evaluating 等）由状态机以 409 如实回绝，而非 422。
    """

    target_status: DemandStatus
    note: str | None = None
    by: str = "system"
    reason: str | None = None


class EvaluationIn(BaseModel):
    """AI 预评估结论概要（写入 evaluation_summary）。

    wire-ux-consolidation 任务 3.1 起：评估挂接的 evaluating 态已废除，
    本端点对现行状态一律 409（自动接单迁移 evaluating 不再放行）；
    既有 evaluation_summary/detail 字段随旧单保留可查。
    """

    summary: str = Field(min_length=1)
    by: str = "ai"
    detail: dict[str, Any] | None = None


class QuoteIn(BaseModel):
    """报价写入（旧八态工作流遗留端点）：confirmed_by_operator + operator 硬前置。

    wire-ux-consolidation 任务 3.1 起：报价不进三态状态机（走定价页自助或
    线下沟通），本端点对现行状态一律 409（须先处于 evaluating 的前置永不
    满足）；既有 quote 字段随旧单保留可查。金额约定（微元为准、兼容元参）
    维持原样。
    """

    amount_micro: int | None = Field(default=None, ge=0)
    amount: Decimal | None = Field(default=None, ge=0)
    note: str | None = None
    valid_until: datetime | None = None
    confirmed_by_operator: bool = False
    operator: str | None = Field(default=None, max_length=64)
    by: str = "operator"


class PipelineRunIn(BaseModel):
    """流水线事实记录（任务 6.5）：in_progress 期 append-only 落 pipeline_events。"""

    pipeline_run_id: str = Field(min_length=1, max_length=128)
    repo: str | None = Field(default=None, max_length=256)
    branch: str | None = Field(default=None, max_length=128)
    note: str | None = None
    by: str = "pipeline"


class GateResultIn(BaseModel):
    """conformance gate 结果（任务 6.5）：append-only 观测留档。

    wire-ux-consolidation 任务 3.1 起 gate 不再门禁状态迁移
    （building→delivery_acceptance 前置随废除态移除），仅作构建质量留痕。
    """

    passed: bool
    report_path: str | None = Field(default=None, max_length=512)
    note: str | None = None
    by: str = "pipeline"


class DeliverIn(BaseModel):
    """交付动作（任务 6.6）：in_progress→delivered + 自动建私有 scope。

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
