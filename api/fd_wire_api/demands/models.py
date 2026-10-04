"""Demand ORM 模型（表 ``demands``）。"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import JSON, DateTime, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base
from .statemachine import DemandStatus, utc_now_iso


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Demand(Base):
    """数据需求单：客户提交 → AI 预评估 → 人工报价 → 构建 → 交付。"""

    __tablename__ = "demands"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    #: 业务编码 DE-YYYYMMDD-XX（按日递增两位序号）
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    #: 归属企业（客户侧按此隔离列表与详情）
    customer_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(200))
    #: 自然语言意图描述
    intent: Mapped[str] = mapped_column(Text)
    #: 实体线索（自由 JSON：地域/行业/关键词等）
    entities_hint: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    #: 期望更新频率（如 daily/weekly）
    frequency_expect: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: 目录预填的 indicator code 列表（提交时可带）
    linked_indicators: Mapped[list] = mapped_column(JSON, default=list)
    #: 当前状态（DemandStatus 值）
    status: Mapped[str] = mapped_column(
        String(32), default=DemandStatus.submitted.value, index=True
    )
    #: 状态时间线（append-only）：[{status, at, by, note}]
    status_history: Mapped[list] = mapped_column(JSON, default=list)
    #: AI 预评估结论概要（客户可见）
    evaluation_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: 拒绝理由（必留档，客户可见）
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: 报价金额（进入 quoted 后写入）
    quote_amount: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    #: 报价说明
    quote_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow_naive
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow_naive, onupdate=_utcnow_naive
    )

    def append_history(self, *, status: DemandStatus, by: str, note: str | None) -> None:
        """只追加一条时间线记录——绝不改写既有条目（审计要求）。"""
        entry = {"status": status.value, "at": utc_now_iso(), "by": by, "note": note}
        history = list(self.status_history or [])
        history.append(entry)
        self.status_history = history

    def __repr__(self) -> str:  # pragma: no cover - 调试用途
        return f"<Demand {self.code} customer={self.customer_id} status={self.status}>"
