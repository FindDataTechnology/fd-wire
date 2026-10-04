"""AI 对话构建 ORM 模型（三表，Alembic 0005）。

- ``ai_conversations``：对话会话（每客户每日新建数受限额护栏约束）。
- ``ai_messages``：对话消息（user / assistant / tool_trace 三角色，
  append-only——tool_trace 记录每次工具调用的名字、入参与结果）。
- ``ai_draft_artifacts``：产物暂存（五类产物 spec 的 draft 落点；
  真正物化到企业 cell 是任务 5.3/5.5 的活）。
"""

from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import AiBase


def utc_now_naive() -> datetime:
    """统一存 naive UTC（与 demands/metering 切片同口径）。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class MessageRole(str, enum.Enum):
    """消息角色：用户输入 / AI 回复 / 工具调用留痕。"""

    user = "user"
    assistant = "assistant"
    tool_trace = "tool_trace"


#: 产物暂存的合法状态（v1 只有 draft；物化流转在 5.3/5.5）
ARTIFACT_STATUS_DRAFT = "draft"


class AIConversation(AiBase):
    """一次 AI 对话会话（归属企业，按 customer_id 隔离）。"""

    __tablename__ = "ai_conversations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    #: 归属企业（客户侧按此隔离列表与消息）
    customer_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(200), default="新对话")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)

    def __repr__(self) -> str:  # pragma: no cover - 调试用途
        return f"<AIConversation {self.id} customer={self.customer_id}>"


class AIMessage(AiBase):
    """对话消息：user / assistant / tool_trace 三角色，只追加不改写。"""

    __tablename__ = "ai_messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("ai_conversations.id"), index=True
    )
    #: MessageRole 值
    role: Mapped[str] = mapped_column(String(16))
    #: user/assistant 为自然语言文本；tool_trace 为 JSON 留痕
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)

    def __repr__(self) -> str:  # pragma: no cover - 调试用途
        return f"<AIMessage {self.id} role={self.role}>"


class AIDraftArtifact(AiBase):
    """产物暂存：构建循环里五类产物工具的产出落这里（draft）。

    spec 为工具入参原样 JSON（含 title）；kind 取五类产物短名
    （dashboard / composite_indicator / research_report / alert_rule /
    refresh_schedule）。真正落 cell 由任务 5.3/5.5 物化。
    """

    __tablename__ = "ai_draft_artifacts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("ai_conversations.id"), index=True
    )
    #: 归属企业（冗余存储：会话删除后仍可按企业审计暂存产物）
    customer_id: Mapped[str] = mapped_column(String(64), index=True)
    #: 五类产物短名（见 tools.ARTIFACT_TOOL_KINDS）
    kind: Mapped[str] = mapped_column(String(64), index=True)
    #: 产物规格 JSON（v1 假语义：工具入参原样暂存）
    spec: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(
        String(16), default=ARTIFACT_STATUS_DRAFT, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)

    def __repr__(self) -> str:  # pragma: no cover - 调试用途
        return f"<AIDraftArtifact {self.id} kind={self.kind} status={self.status}>"
