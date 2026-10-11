"""AI 构建循环（任务 5.4 的核心抽象）。

``用户消息 → LLM（带五类产物工具 schema）→ 工具调用执行 → 结果回灌
→ …… → LLM 终答或轮次上限``。

- 工具分两路：五类产物工具走「spec 写入暂存表」假语义（tools.py，
  真正落 cell 是 5.3/5.5 的活）；其余工具经 ``ToolExecutor`` 协议打到
  企业 cell MCP 端点（executor.py，平台服务凭据）。
- 失败如实：LLM 异常 → assistant 消息如实报错并安全中止；工具异常 →
  错误结果回灌 LLM、tool_trace 留痕，绝不留下半成品产物。
- 预算护栏：cell 未开通 → 常量报错不调 LLM；轮次达上限 → 如实告知截断。
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .executor import (
    CELL_NOT_PROVISIONED_MESSAGE,
    CellNotProvisionedError,
    resolve_cell_endpoint,
)
from .models import AIMessage, AIConversation, MessageRole
from .protocols import LlmAssistantMessage, LlmClient, ToolCall, ToolExecutor
from .tools import ARTIFACT_TOOL_KINDS, TOOL_SCHEMAS, stage_artifact

SYSTEM_PROMPT = (
    "你是柏讯控制台的分析构建助手。客户用自然语言描述分析意图，你经工具完成"
    "探索与产物生成。可用工具有五类产物 spec 写入：dashboard_spec_create、"
    "composite_indicator_create、research_report_create、alert_rule_create、"
    "refresh_schedule_create——spec 写入只是暂存草稿（draft），待客户确认后"
    "才物化到企业 cell。要求：意图不清先追问；数据不可得或生成失败时如实"
    "说明原因，绝不编造、绝不产出半成品 spec；产物齐备后用中文给客户一个"
    "简短的完成总结。"
)

#: 轮次上限截断的如实文案
def _truncation_message(max_turns: int) -> str:
    return (
        f"本轮构建已达到最大轮次上限（AI_MAX_TURNS={max_turns}），"
        "对话被安全截断。已生成的产物草稿保留在暂存区；"
        "请开新对话或简化意图后继续。"
    )


def _llm_failure_message(exc: Exception) -> str:
    return f"AI 服务调用失败，本轮构建已安全中止，未产生半成品产物。原因：{exc}"


def append_message(
    db: Session, *, conversation_id: int, role: MessageRole, content: str
) -> AIMessage:
    """追加一条消息（append-only，绝不改写既有消息）。"""
    message = AIMessage(
        conversation_id=conversation_id, role=role.value, content=content
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


def _assistant_wire(assistant: LlmAssistantMessage) -> dict:
    """归一化 assistant 消息 → OpenAI wire 形态（含 tool_calls）。"""
    entry: dict[str, Any] = {"role": "assistant", "content": assistant.text() or None}
    if assistant.has_tool_calls:
        entry["tool_calls"] = [
            {
                "id": call.id,
                "type": "function",
                "function": {
                    "name": call.name,
                    "arguments": json.dumps(call.arguments, ensure_ascii=False),
                },
            }
            for call in assistant.tool_calls
        ]
    return entry


def _wire_history(
    db: Session, conversation_id: int, system_extra: str | None = None
) -> list[dict]:
    """历史消息 → OpenAI wire 形态：tool_trace 还原为 assistant.tool_calls +
    tool 结果对（满足兼容面对「tool 消息须紧跟带 tool_calls 的 assistant」
    的次序要求）。

    ``system_extra``（wire-entity-layer）：实体图谱紧凑块，非空时在固定
    文案后追加（换行分隔）；None/空 → system 文本与固定文案**逐字节一致**
    （零漂移，有测试断言）。组装方为 ai/routes（经
    ``entities.service.entity_graph_prompt_block`` 取块）。
    """
    rows = list(
        db.scalars(
            select(AIMessage)
            .where(AIMessage.conversation_id == conversation_id)
            .order_by(AIMessage.id)
        ).all()
    )
    system_content = SYSTEM_PROMPT
    if system_extra:
        system_content = f"{SYSTEM_PROMPT}\n{system_extra}"
    wire: list[dict] = [{"role": "system", "content": system_content}]
    i = 0
    while i < len(rows):
        row = rows[i]
        if row.role == MessageRole.user.value:
            wire.append({"role": "user", "content": row.content})
            i += 1
            continue
        if row.role == MessageRole.assistant.value:
            # 紧随其后的 tool_trace 归属该 assistant 轮（还原 tool_calls）。
            traces: list[AIMessage] = []
            j = i + 1
            while j < len(rows) and rows[j].role == MessageRole.tool_trace.value:
                traces.append(rows[j])
                j += 1
            entry: dict[str, Any] = {"role": "assistant", "content": row.content or None}
            if traces:
                calls = []
                for trace in traces:
                    payload = json.loads(trace.content)
                    calls.append(
                        {
                            "id": payload.get("tool_call_id") or f"call-{trace.id}",
                            "type": "function",
                            "function": {
                                "name": payload["tool_name"],
                                "arguments": json.dumps(
                                    payload.get("arguments") or {}, ensure_ascii=False
                                ),
                            },
                        }
                    )
                entry["tool_calls"] = calls
            wire.append(entry)
            for trace in traces:
                payload = json.loads(trace.content)
                wire.append(
                    {
                        "role": "tool",
                        "tool_call_id": payload.get("tool_call_id") or f"call-{trace.id}",
                        "content": json.dumps(
                            payload.get("result"), ensure_ascii=False
                        ),
                    }
                )
            i = j
            continue
        # 游离 tool_trace（不该出现）：按 tool 消息原样回放，不丢弃。
        payload = json.loads(row.content)
        wire.append(
            {
                "role": "tool",
                "tool_call_id": payload.get("tool_call_id") or f"call-{row.id}",
                "content": json.dumps(payload.get("result"), ensure_ascii=False),
            }
        )
        i += 1
    return wire


def execute_tool_call(
    db: Session,
    conversation: AIConversation,
    call: ToolCall,
    tool_executor: ToolExecutor,
) -> dict:
    """执行一次工具调用并返回回灌结果（异常即错误结果；未开通例外穿透）。

    产物工具 → spec 暂存；其余 → ToolExecutor（cell MCP，平台服务凭据
    轨道：AI 探索不计费，计量在 registry audit 侧按平台身份归集）。
    ``CellNotProvisionedError`` 不在此吞——上抛给循环以常量回复收场
    （约定派生口径下「未开通」在首个探索调用的握手期才被发现）。
    """
    if call.name in ARTIFACT_TOOL_KINDS:
        try:
            return stage_artifact(
                db,
                conversation_id=conversation.id,
                customer_id=conversation.customer_id,
                tool_name=call.name,
                args=call.arguments,
            )
        except Exception as exc:  # 暂存落库异常：回滚，不留半成品
            db.rollback()
            return {
                "ok": False,
                "error": f"产物暂存失败: {exc}",
                "error_type": type(exc).__name__,
            }
    try:
        return tool_executor.execute(call.name, call.arguments)
    except CellNotProvisionedError:
        raise  # 未开通：穿透到循环层走常量回复
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "error_type": type(exc).__name__,
        }


def run_build_loop(
    db: Session,
    conversation: AIConversation,
    *,
    llm: LlmClient,
    tool_executor: ToolExecutor,
    max_turns: int,
    system_extra: str | None = None,
) -> list[AIMessage]:
    """跑一轮构建循环，返回本次追加的全部消息（含首条 user）。

    调用方须已把用户消息落库（``chat`` 一并处理）。``system_extra`` 见
    ``_wire_history``（图谱块注入；缺省 None = 固定文案零漂移）。
    """
    appended: list[AIMessage] = []

    def emit(role: MessageRole, content: str) -> AIMessage:
        message = append_message(
            db, conversation_id=conversation.id, role=role, content=content
        )
        appended.append(message)
        return message

    # 护栏一：cell 未开通——常量如实报错，不调 LLM、零工具执行。
    # （显式部署口径：map 已配且未命中时 resolve 为 None；约定派生口径
    # 下派生端点恒有值，未开通在首次工具执行的握手期 404/405 处发现，
    # CellNotProvisionedError 在循环体内同样触发本常量回复。）
    if resolve_cell_endpoint(conversation.customer_id) is None:
        emit(MessageRole.assistant, CELL_NOT_PROVISIONED_MESSAGE)
        return appended

    wire = _wire_history(db, conversation.id, system_extra)
    for _ in range(max_turns):
        try:
            assistant = llm.complete(wire, TOOL_SCHEMAS)
        except Exception as exc:
            # 失败如实：assistant 消息报错并安全中止（无终答、无半成品）。
            emit(MessageRole.assistant, _llm_failure_message(exc))
            return appended

        emit(MessageRole.assistant, assistant.text())
        if not assistant.has_tool_calls:
            return appended  # 终答

        wire.append(_assistant_wire(assistant))
        try:
            for call in assistant.tool_calls:
                result = execute_tool_call(db, conversation, call, tool_executor)
                emit(
                    MessageRole.tool_trace,
                    json.dumps(
                        {
                            "tool_call_id": call.id,
                            "tool_name": call.name,
                            "arguments": call.arguments,
                            "result": result,
                        },
                        ensure_ascii=False,
                    ),
                )
                wire.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": json.dumps(result, ensure_ascii=False),
                    }
                )
        except CellNotProvisionedError:
            # 约定派生口径的「未开通」：首个探索调用握手期 404/405——
            # 常量回复、安全中止（不把未开通当作可继续探索的普通错误回灌）。
            emit(MessageRole.assistant, CELL_NOT_PROVISIONED_MESSAGE)
            return appended

    # 护栏二：轮次上限——如实告知截断（draft 留存，不静默丢弃）。
    emit(MessageRole.assistant, _truncation_message(max_turns))
    return appended
