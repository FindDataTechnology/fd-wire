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


class DemandOut(BaseModel):
    """需求单完整视图（含客户可见时间线/评估概要/拒绝理由/报价）。"""

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
    created_at: datetime
    updated_at: datetime


class TransitionIn(BaseModel):
    """内部迁移请求：目标状态 + 说明；quoted/rejected 有额外前置。"""

    target_status: DemandStatus
    note: str | None = None
    by: str = "system"
    reason: str | None = None
    confirmed_by_operator: bool = False


class EvaluationIn(BaseModel):
    """AI 预评估结论概要（写入 evaluation_summary）。"""

    summary: str = Field(min_length=1)
    by: str = "ai"


class QuoteIn(BaseModel):
    """人工确认后的报价写入；confirmed_by_operator 为硬前置。"""

    amount: Decimal = Field(ge=0)
    note: str | None = None
    confirmed_by_operator: bool
    by: str = "operator"
