// AI 助手会话主体（wire-assistant-panel）：三态交互的全部逻辑与渲染。
//
// 与外壳分离：`AssistantPanel`（右下角浮动壳）与 `ChatPage`（整页形态）都
// 复用它——同一个协作文本、同一套分轨与失败纪律，避免两处各写一套交互后
// 逐渐漂移。
//
// 三态（design D2/D4）：
// - 问：走问答轨（POST /api/v1/ai/answer）——不碰 cell、不写产物，免费档可用。
// - 做：走既有构建轨（POST .../messages）——仅付费档（有 cell）展示。
// - 去壹座：深链新标签页，绝不内嵌（D4）。
//
// 会话（D7）：只维持**一个活会话**，多轮追加到同一 conversation_id，直到
// 客户主动「新对话」——一次使用只消耗一个日限额。
//
// 构建可见性（D1）：构建请求同步、可能数十秒，期间按 after_id 轮询增量消息，
// 把已落库的中间步骤真实展示出来，避免长时间静默。
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  askAssistant,
  createConversation,
  fetchMessagesAfter,
  postMessage,
  type AssistantContext,
  type ChatMessage,
} from "../api";
import { YIZUO_PLATFORM_URL } from "../../components/footerConstants";

/** 轮询间隔（ms）：有新增即尽快再看，连续无新增则退避。 */
const POLL_FAST_MS = 900;
const POLL_SLOW_MS = 2500;
/** 连续多少次无新增后转慢速。 */
const POLL_BACKOFF_AFTER = 3;

export type AssistantMode = "ask" | "build";

export interface AssistantConversationProps {
  /** 当前页签（作为上下文注入，让指路答案落在客户所在页）。 */
  tab: string;
  /** 当前档位 code（`free` 时隐藏构建入口——见 design D3）。 */
  planCode: string;
  /** 当前正在查看的产物/数据集标识（可选，由宿主页面提供）。 */
  context?: AssistantContext;
  /** 整页形态下页面自己承载壹座入口，壳内不再重复。 */
  hideBaseLink?: boolean;
  /** 事务区高度类（浮层给固定高度，整页给更大空间）。 */
  transcriptClassName?: string;
}

function isFreeTier(planCode: string): boolean {
  return planCode === "free";
}

/** tool_trace 留痕 → 一行人类可读的进展文案（不展示原始 JSON）。 */
function progressLabel(raw: string, t: (key: string) => string): string {
  try {
    const payload = JSON.parse(raw) as { tool_name?: unknown };
    const name = payload.tool_name;
    if (typeof name === "string" && name.trim()) {
      return t("console.assistant.progressTool").replace("{{tool}}", name);
    }
  } catch {
    /* 非 JSON：按通用进展文案兜底 */
  }
  return t("console.assistant.progressGeneric");
}

interface TranscriptEntry {
  id: number;
  role: "user" | "assistant" | "progress";
  content: string;
}

function toEntries(
  messages: ChatMessage[],
  t: (key: string) => string,
): TranscriptEntry[] {
  return messages.map((message) => ({
    id: message.id,
    role:
      message.role === "tool_trace"
        ? "progress"
        : message.role === "assistant"
          ? "assistant"
          : "user",
    content:
      message.role === "tool_trace"
        ? progressLabel(message.content, t)
        : message.content,
  }));
}

/** 按 id 去重合并（轮询与主响应会覆盖同一批消息）。 */
function mergeEntries(
  current: TranscriptEntry[],
  incoming: TranscriptEntry[],
): TranscriptEntry[] {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map((entry) => entry.id));
  const merged = [...current];
  for (const entry of incoming) {
    if (!seen.has(entry.id)) {
      merged.push(entry);
      seen.add(entry.id);
    }
  }
  return merged.sort((a, b) => a.id - b.id);
}

export function AssistantConversation({
  tab,
  planCode,
  context,
  hideBaseLink = false,
  transcriptClassName = "min-h-[12rem]",
}: AssistantConversationProps) {
  const { t } = useTranslation();
  const free = isFreeTier(planCode);
  const [mode, setMode] = useState<AssistantMode>("ask");
  const [draft, setDraft] = useState("");
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // 已读到的最新消息 id（增量轮询基线）。用 ref 而非 state：轮询回调需要读
  // 最新值，不能吃闭包里的旧快照。
  const latestIdRef = useRef(0);

  // 免费档没有 cell：构建态无意义，强制回到问答（design D3）。
  useEffect(() => {
    if (free && mode === "build") setMode("ask");
  }, [free, mode]);

  const resetConversation = useCallback(() => {
    setConversationId(null);
    setEntries([]);
    setError(null);
    setProgress(null);
    latestIdRef.current = 0;
  }, []);

  /** 问答轨：一次请求拿完整回答（无工具循环，很快）。 */
  const sendAsk = useCallback(
    async (content: string) => {
      setBusy(true);
      setError(null);
      try {
        const answer = await askAssistant(content, {
          conversationId: conversationId ?? undefined,
          context: { tab, ...context },
        });
        setConversationId(answer.conversation_id);
        setEntries((current) =>
          mergeEntries(current, toEntries(answer.messages, t)),
        );
        // 同步增量基线：随后若切到构建态，轮询只取真正的新消息。
        latestIdRef.current = answer.messages.reduce(
          (max, item) => Math.max(max, item.id),
          latestIdRef.current,
        );
      } catch (err) {
        // 失败如实：不伪造回答；草稿由 submit 的 catch 回填。
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [conversationId, context, tab, t],
  );

  /** 构建轨：同步请求 + 期间按 after_id 轮询增量消息（design D1）。 */
  const sendBuild = useCallback(
    async (content: string) => {
      setBusy(true);
      setError(null);
      setProgress(t("console.assistant.progressStarting"));
      let active = true;
      let lastId = latestIdRef.current;

      const poll = async (targetId: number) => {
        let quiet = 0;
        while (active) {
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              quiet >= POLL_BACKOFF_AFTER ? POLL_SLOW_MS : POLL_FAST_MS,
            ),
          );
          if (!active) return;
          try {
            const fresh = await fetchMessagesAfter(targetId, lastId);
            if (fresh.length > 0) {
              quiet = 0;
              lastId = fresh[fresh.length - 1].id;
              latestIdRef.current = lastId;
              setEntries((current) =>
                mergeEntries(current, toEntries(fresh, t)),
              );
            } else {
              quiet += 1;
            }
          } catch {
            /* 轮询失败不该打断主请求：静默跳过这一拍 */
          }
        }
      };

      try {
        let targetId = conversationId;
        if (targetId == null) {
          const detail = await createConversation({});
          targetId = detail.id;
          setConversationId(targetId);
        }
        const polling = poll(targetId);
        const appended = await postMessage(targetId, content);
        active = false;
        await polling;
        setEntries((current) => mergeEntries(current, toEntries(appended, t)));
        // 主响应是权威集合：基线推到最大 id，避免下一轮重复拉取。
        latestIdRef.current = appended.reduce(
          (max, item) => Math.max(max, item.id),
          latestIdRef.current,
        );
        setProgress(null);
      } catch (err) {
        active = false;
        setError(err instanceof Error ? err.message : String(err));
        setProgress(null);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [conversationId, t],
  );

  const submit = useCallback(async () => {
    const content = draft.trim();
    if (!content || busy) return;
    setDraft("");
    try {
      if (mode === "build" && !free) {
        await sendBuild(content);
      } else {
        await sendAsk(content);
      }
    } catch {
      // 失败保留输入（spec 场景「失败如实」要求可编辑重发）。
      setDraft(content);
    }
  }, [draft, busy, mode, free, sendBuild, sendAsk]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="assistant-body">
      <div className="flex items-center gap-2 pb-2">
        <span className="text-sm font-semibold text-slate-900">
          {t("console.assistant.title")}
        </span>
        {free ? (
          <span
            data-testid="assistant-free-badge"
            className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600"
          >
            {t("console.assistant.modeAskOnly")}
          </span>
        ) : (
          <div
            data-testid="assistant-mode-switch"
            className="ml-1 flex rounded-md border border-slate-200 p-0.5"
          >
            {(["ask", "build"] as const).map((value) => (
              <button
                key={value}
                type="button"
                data-testid={`assistant-mode-${value}`}
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                  mode === value
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {value === "ask"
                  ? t("console.assistant.modeAsk")
                  : t("console.assistant.modeBuild")}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          data-testid="assistant-new"
          onClick={resetConversation}
          className="ml-auto text-[11px] text-slate-500 hover:text-slate-800"
        >
          {t("console.assistant.newConversation")}
        </button>
      </div>

      <div
        data-testid="assistant-transcript"
        className={`flex-1 space-y-2 overflow-y-auto ${transcriptClassName}`}
      >
        {entries.length === 0 && !busy && (
          <p className="text-xs leading-relaxed text-slate-500">
            {free ? t("console.assistant.emptyAsk") : t("console.assistant.empty")}
          </p>
        )}
        {entries.map((entry) => (
          <div
            key={entry.id}
            data-testid={`assistant-entry-${entry.role}`}
            className={
              entry.role === "user"
                ? "ml-6 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white"
                : entry.role === "progress"
                  ? "text-[11px] italic text-slate-400"
                  : "mr-6 rounded-lg bg-slate-100 px-3 py-2 text-xs whitespace-pre-wrap text-slate-800"
            }
          >
            {entry.content}
          </div>
        ))}
        {progress != null && (
          <div
            data-testid="assistant-progress"
            className="text-[11px] italic text-slate-400"
          >
            {progress}
          </div>
        )}
        {error != null && (
          <div
            data-testid="assistant-error"
            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
          >
            {error}
          </div>
        )}
      </div>

      <div className="mt-2 border-t border-slate-200 pt-2">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            data-testid="assistant-input"
            rows={2}
            value={draft}
            placeholder={t("console.assistant.placeholder")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
          />
          <button
            type="button"
            data-testid="assistant-send"
            disabled={busy || draft.trim().length === 0}
            onClick={() => void submit()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy ? t("console.assistant.sending") : t("console.assistant.send")}
          </button>
        </div>
        {!hideBaseLink && (
          <div className="mt-1.5 text-right">
            <a
              data-testid="assistant-base-link"
              href={YIZUO_PLATFORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-slate-500 hover:text-slate-800"
            >
              {t("console.assistant.goBase")}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
