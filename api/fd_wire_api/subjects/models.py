"""追踪主体的 ORM 模型（wire-subject-tracking）。

两张表，同属 datasets 库（与快照数据集同库，保证物化事务一致）：

- ``subjects``：一个客户想持续追踪的对象。``kind`` 是闭集词表，``ref`` 是
  解析来源（来源+标识），``title``/``description`` 为客户可见文案。
- ``subject_channels``：主体绑定的信号通道。每个通道是 ``channels[]`` 的一项，
  ``type`` 闭集词表，``spec`` 是通道参数（指标标识、来源限定等）。

客户隔离按 ``customer_id``；他企主体在 service 层 404（不泄露存在性）。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import SubjectsBase

#: 主体类型闭集（wire-subject-tracking：声明与 kind 词表）。
SUBJECT_KINDS: frozenset[str] = frozenset(
    {"company", "industry", "chain", "country", "region"}
)

#: 通道类型闭集（统一形状五类）。
CHANNEL_TYPES: frozenset[str] = frozenset(
    {"indicators", "announcements", "registry", "graph", "context"}
)

#: ref 来源闭集。
REF_SOURCES: frozenset[str] = frozenset(
    {"stock_code", "industry_code", "country_code", "region_code", "chain_spec", "custom_label"}
)


def utc_now_naive() -> datetime:
    """naive-UTC 当前时间（列形态与 datasets/packs 切片同口径）。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Subject(SubjectsBase):
    """一条追踪主体（客户维度隔离）。"""

    __tablename__ = "subjects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    #: 主体类型（SUBJECT_KINDS 之一；service 校验）
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    #: ref：{"source": <REF_SOURCES 之一>, "code": ..., 可选附加字段}
    ref: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    #: 客户可见标题
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: 最近一次快照落成的数据集 id（datasets 库跨表弱引用；未快照为 None）
    snapshot_dataset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(), nullable=False, default=utc_now_naive, onupdate=utc_now_naive
    )

    channels: Mapped[list["SubjectChannel"]] = relationship(
        back_populates="subject", cascade="all, delete-orphan", order_by="SubjectChannel.id"
    )


class SubjectChannel(SubjectsBase):
    """主体绑定的一个信号通道。"""

    __tablename__ = "subject_channels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject_id: Mapped[int] = mapped_column(
        ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: 通道类型（CHANNEL_TYPES 之一；service 校验）
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    #: 通道参数（指标标识 / 来源限定 / graph 方向等；形状随 type 而变，service 校验）
    spec: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    subject: Mapped[Subject] = relationship(back_populates="channels")
