"""产物生命周期 ORM 模型（wire-artifacts-persistence，Alembic 0021）。

- ``artifacts``：产物一等实体——跨会话持久化（kind 五类、title、spec
  当前指针经版本表间接持有、状态机 draft/published/archived、版本计数、
  来源会话指针）。
- ``artifact_versions``：spec 版本链（append-only——每次保存追加一行，
  历史版本不可改写；当前 spec = 最大 version 那行）。

表落在 ai 切片引擎（``AiBase``）：产物由会话草稿转正而来，
``origin_conversation_id`` 逻辑引用 ``ai_conversations``（不设跨模块
外键，与 materialization 切片对 ai 表的引用纪律一致）。
"""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..ai.db import AiBase
from ..ai.models import utc_now_naive

#: 五类产物短名（与 ai.tools.ARTIFACT_TOOL_KINDS 的值域对表维护）。
ARTIFACT_KINDS: tuple[str, ...] = (
    "dashboard",
    "composite_indicator",
    "research_report",
    "alert_rule",
    "refresh_schedule",
)


class ArtifactStatus(str, enum.Enum):
    """产物状态机：draft → published → archived 单向；archived → draft 恢复。"""

    draft = "draft"
    published = "published"
    archived = "archived"


class Artifact(AiBase):
    """产物一等实体：跨会话持久化、版本化、带状态机。"""

    __tablename__ = "artifacts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    #: 归属企业（客户面按此隔离列表与详情）
    customer_id: Mapped[str] = mapped_column(String(64), index=True)
    #: 五类产物短名（ARTIFACT_KINDS）
    kind: Mapped[str] = mapped_column(String(64), index=True)
    #: 产物名称（spec.title 的投影，列表展示用）
    title: Mapped[str] = mapped_column(String(200))
    #: 状态机当前位（ArtifactStatus 值）
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    #: 版本计数（当前 spec = artifact_versions 中 version=该值 的行）
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    #: 来源会话指针（会话草稿导入时保留；直接创建为 NULL）
    origin_conversation_id: Mapped[int | None] = mapped_column(
        Integer, nullable=True, index=True
    )
    #: 状态迁移操作记录（append-only：{status, at, by, note} 列表，
    #: 与 demands.status_history 同款留痕口径）
    status_history: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)

    def __repr__(self) -> str:  # pragma: no cover - 调试用途
        return f"<Artifact {self.id} kind={self.kind} status={self.status} v={self.version}>"


class ArtifactVersion(AiBase):
    """产物版本链：一行 = 一个版本的 spec 快照（append-only 不可改写）。"""

    __tablename__ = "artifact_versions"
    __table_args__ = (
        UniqueConstraint("artifact_id", "version", name="uq_artifact_versions_version"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    artifact_id: Mapped[int] = mapped_column(
        ForeignKey("artifacts.id"), index=True
    )
    #: 版本号（从 1 起，逐次保存 +1）
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    #: 该版本的 spec 快照（工具入参原样 JSON：{"title":..., "spec":{...}}）
    spec: Mapped[dict] = mapped_column(JSON, nullable=False)
    #: 写入者留痕（console:<customer_id> / migration:<id>）
    operator: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)

    def __repr__(self) -> str:  # pragma: no cover - 调试用途
        return f"<ArtifactVersion artifact={self.artifact_id} v={self.version}>"
