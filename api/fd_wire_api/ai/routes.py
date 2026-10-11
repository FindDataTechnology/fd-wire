"""AI 对话构建 API 路由（wire-platform-v1 任务 5.4）。

客户侧（Bearer ID token → logto_sub → Customer，wire-self-serve-launch 4.5
身份切换，同 demands 切片；X-Customer-Id 占位头退位不再接受）：
- ``POST /api/v1/ai/conversations``               新开对话（可带首条消息即跑循环）
- ``GET  /api/v1/ai/conversations``               本企业对话列表
- ``GET  /api/v1/ai/conversations/{id}/messages`` 会话消息（他企一律 404）
- ``POST /api/v1/ai/conversations/{id}/messages`` 追加用户消息并驱动构建循环
- ``GET  /api/v1/ai/conversations/{id}/artifacts``会话暂存的产物草稿（draft）

预算护栏：新开对话受每客户每日限额（429）；单轮循环受 AI_MAX_TURNS 截断。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from . import service
from .db import get_db
from ..console.auth import require_console_customer_id
from ..datasets.db import get_db as get_datasets_db
from ..entities.db import get_db as get_entities_db
from ..entities.service import entity_graph_prompt_block
from .executor import CellMcpExecutor
from .llm import TokenGatewayLlmClient
from .protocols import LlmClient, ToolExecutor
from .schemas import (
    ChatIn,
    ConversationCreate,
    ConversationDetailOut,
    ConversationOut,
    DraftArtifactOut,
    MessageOut,
    artifact_out,
    conversation_detail,
)
from .settings import get_settings

router = APIRouter(tags=["ai"])


def get_llm_client() -> LlmClient:
    """LLM 出口依赖：token 网关 OpenAI 兼容面（测试覆写注入 mock）。"""
    return TokenGatewayLlmClient()


def get_tool_executor(customer_id: str = Depends(require_console_customer_id)) -> ToolExecutor:
    """工具执行出口依赖：该企业 cell 的 MCP 端点（测试覆写注入 mock）。

    计量归属：平台服务凭据轨道——AI 探索不计费。
    """
    return CellMcpExecutor(customer_id)


def _release(client: object) -> None:
    if hasattr(client, "close"):
        client.close()


def _conversation_or_404(db: Session, conversation_id: int, customer_id: str):
    try:
        return service.get_customer_conversation(
            db, conversation_id=conversation_id, customer_id=customer_id
        )
    except service.ConversationNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post(
    "/api/v1/ai/conversations",
    status_code=status.HTTP_201_CREATED,
    response_model=ConversationDetailOut,
)
def create_conversation(
    payload: ConversationCreate,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
    entities_db: Session = Depends(get_entities_db),
    datasets_db: Session = Depends(get_datasets_db),
    llm: LlmClient = Depends(get_llm_client),
    tool_executor: ToolExecutor = Depends(get_tool_executor),
) -> ConversationDetailOut:
    """新开对话（先过每日限额护栏）；带 message 即当场跑一轮构建循环。

    实体图谱注入（wire-entity-layer）：跑循环前经 entities（元数据库）+
    datasets 双库会话组装图谱紧凑块——空图谱得 None，system prompt 与
    固定文案逐字一致（零漂移）。"""
    settings = get_settings()
    try:
        service.ensure_daily_limit(db, customer_id, settings)
    except service.DailyConversationLimitExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    conversation = service.create_conversation(db, customer_id=customer_id, payload=payload)
    if payload.message:
        service.chat(
            db,
            conversation,
            content=payload.message,
            llm=llm,
            tool_executor=tool_executor,
            settings=settings,
            system_extra=entity_graph_prompt_block(
                entities_db, datasets_db, customer_id
            ),
        )
    _release(llm)
    _release(tool_executor)
    messages = service.list_messages(db, conversation_id=conversation.id)
    return conversation_detail(conversation, messages)


@router.get("/api/v1/ai/conversations", response_model=list[ConversationOut])
def list_conversations(
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> list[ConversationOut]:
    """本企业对话列表（按创建时间倒序）。"""
    conversations = service.list_conversations(db, customer_id=customer_id)
    return [ConversationOut.model_validate(c) for c in conversations]


@router.get(
    "/api/v1/ai/conversations/{conversation_id}/messages",
    response_model=list[MessageOut],
)
def list_messages(
    conversation_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> list[MessageOut]:
    """会话全部消息（仅本企业可见；他企或不存在一律 404）。"""
    _conversation_or_404(db, conversation_id, customer_id)
    messages = service.list_messages(db, conversation_id=conversation_id)
    return [MessageOut.model_validate(m) for m in messages]


@router.post(
    "/api/v1/ai/conversations/{conversation_id}/messages",
    response_model=list[MessageOut],
)
def append_and_run(
    conversation_id: int,
    payload: ChatIn,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
    entities_db: Session = Depends(get_entities_db),
    datasets_db: Session = Depends(get_datasets_db),
    llm: LlmClient = Depends(get_llm_client),
    tool_executor: ToolExecutor = Depends(get_tool_executor),
) -> list[MessageOut]:
    """追加用户消息并驱动一轮构建循环（返回本轮落库的消息序列）。

    实体图谱注入同 create_conversation（空图谱 None = 零漂移）。
    """
    conversation = _conversation_or_404(db, conversation_id, customer_id)
    settings = get_settings()
    appended = service.chat(
        db,
        conversation,
        content=payload.content,
        llm=llm,
        tool_executor=tool_executor,
        settings=settings,
        system_extra=entity_graph_prompt_block(
            entities_db, datasets_db, customer_id
        ),
    )
    _release(llm)
    _release(tool_executor)
    return [MessageOut.model_validate(m) for m in appended]


@router.get(
    "/api/v1/ai/conversations/{conversation_id}/artifacts",
    response_model=list[DraftArtifactOut],
)
def list_artifacts(
    conversation_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> list[DraftArtifactOut]:
    """会话暂存的产物草稿（draft；物化到 cell 是后续任务的事）。"""
    _conversation_or_404(db, conversation_id, customer_id)
    artifacts = service.list_artifacts(db, conversation_id=conversation_id)
    return [artifact_out(a) for a in artifacts]
