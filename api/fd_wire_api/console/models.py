"""控制台域 ORM 模型（首登开户簿记）。

``console_onboardings``：Logto sub → 开户 ceremony 的断点簿记（幂等可重试、
不留半开户态的状态机载体）。状态机（wire-self-serve-launch 4.3）：

    pending --铸 key 成功--> minted --映射落库--> done

- ``pending``：ceremony 已受理，key 尚未铸出（ensure_customer / registry
  授权束任一步失败停在此态；重试从断点续作，幂等步骤不重复产生副作用）。
- ``minted``：wgk- key 已铸成（key_id 落簿，明文不落库）但登录映射尚未
  写入；重试**不再重复铸 key**，直接续作映射落步。
- ``done``：``billing_customers.logto_sub`` 映射已生效（终态；之后以客户
  映射为第一查询口径，本行留作审计）。

明文 key 纪律与 cell-manager 一致：簿记/审计只落 key_id，明文仅在铸出
当次响应中一次性交付。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from ..billing.models import utcnow


class ConsoleBase(DeclarativeBase):
    """控制台域声明基类（console_* 表；与平台库同库）。"""


class ConsoleOnboarding(ConsoleBase):
    """首登开户 ceremony 的断点簿记（每 Logto sub 一行）。

    ``customer_id`` 指向 ``billing_customers.id``：ORM 层刻意不声明
    ForeignKey（跨 Base 的 metadata 解析不到对方表，create_all 兜底会炸）；
    DB 级 FK 由 alembic 0015 落（生产），索引在此保留以支撑联查。
    """

    __tablename__ = "console_onboardings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    logto_sub: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    customer_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    key_id: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
