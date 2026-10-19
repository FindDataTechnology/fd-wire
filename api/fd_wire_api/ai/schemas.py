"""AI 对话 API 的请求/响应模型（pydantic v2）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .models import AIDraftArtifact, AIMessage, AIConversation


class ConversationCreate(BaseModel):
    """新开对话（可携带首条用户消息——给即当场驱动一轮构建循环）。"""

    title: str | None = Field(default=None, max_length=200)
    message: str | None = Field(default=None, min_length=1)


class ChatIn(BaseModel):
    """追加一条用户消息并驱动构建循环。"""

    content: str = Field(min_length=1)


class AssistantAskIn(BaseModel):
    """问答轨一轮提问（wire-assistant-panel）。

    - ``content``：客户问题。
    - ``conversation_id``：可选——给则追加到该会话（浮层的单活会话），
      缺省则新开一个会话；新开会计入每日限额。
    - ``context``：当前页面上下文（``tab`` / ``artifact_id`` / ``dataset_id``）；
      服务端按白名单净化，未知键丢弃。
    """

    content: str = Field(min_length=1, max_length=4000)
    conversation_id: int | None = None
    context: dict[str, Any] | None = None


class AssistantAnswerOut(BaseModel):
    """问答轨一轮结果：``conversation_id`` 供浮层记住单活会话。"""

    conversation_id: int
    messages: list["MessageOut"]


class MessageOut(BaseModel):
    """对话消息（tool_trace 的 content 为 JSON 留痕串）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    role: str
    content: str
    created_at: datetime


class ConversationOut(BaseModel):
    """对话概要（列表用）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    customer_id: str
    title: str
    created_at: datetime


class ConversationDetailOut(ConversationOut):
    """对话详情（创建后带全部消息返回）。"""

    messages: list[MessageOut] = []


class DraftArtifactOut(BaseModel):
    """产物暂存草稿（spec 为工具入参原样 JSON）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    customer_id: str
    kind: str
    spec: Any
    status: str
    created_at: datetime


def conversation_detail(
    conversation: AIConversation, messages: list[AIMessage]
) -> ConversationDetailOut:
    """ORM → 详情视图。"""
    return ConversationDetailOut(
        id=conversation.id,
        customer_id=conversation.customer_id,
        title=conversation.title,
        created_at=conversation.created_at,
        messages=[MessageOut.model_validate(m) for m in messages],
    )


def artifact_out(artifact: AIDraftArtifact) -> DraftArtifactOut:
    return DraftArtifactOut.model_validate(artifact)
