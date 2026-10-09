// AI 对话构建页（#/console/chat，控制台默认页；wire-platform-v1 任务 5.5）。
// - 左列会话列表 + 新建；右列消息流（user/assistant 气泡、tool_trace 折叠行）。
// - 输入发送：未选会话=新建并跑首轮循环（POST /conversations），已选=续聊
//   （POST .../messages）。错误如实呈现：网络错/429 每日限额/cell 未开通的
//   常量回复（后者以 assistant 消息原样落流，天然如实）。
// - 身份：请求自动附 Authorization: Bearer（登录会话，见 auth.ts）——
//   本组件不再持有任何客户标识 prop。
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ConsoleApiError,
  createConversation,
  fetchConversations,
  fetchMessages,
  postMessage,
  type ChatMessage,
  type Conversation,
} from "./api";
import { formatServerDate, parseToolTrace, sortMessages, summarizeArgs } from "./util";

interface SendError {
  status?: number;
  detail?: string;
}

function toSendError(err: unknown): SendError {
  if (err instanceof ConsoleApiError) {
    return { status: err.status, detail: err.detail };
  }
  return { detail: (err as Error).message };
}

export function ChatPage({ conversationId }: { conversationId: number | null }) {
  const { t } = useTranslation();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<SendError | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadConversations = useCallback(async () => {
    setListError(null);
    try {
      setConversations(await fetchConversations());
    } catch {
      setConversations([]);
      setListError("list");
    }
  }, []);

  useEffect(() => {
    setConversations(null);
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (conversationId == null) {
      setMessages(null);
      setMessagesError(null);
      return;
    }
    let cancelled = false;
    setMessages(null);
    setMessagesError(null);
    fetchMessages(conversationId)
      .then((rows) => {
        if (!cancelled) setMessages(sortMessages(rows));
      })
      .catch(() => {
        if (!cancelled) setMessagesError("messages");
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const send = async () => {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    setSendError(null);
    try {
      if (conversationId == null) {
        // 新建对话：发送首条消息即创建并跑一轮构建循环。
        const detail = await createConversation({ message: content });
        window.location.hash = `#/console/chat?c=${detail.id}`;
        return; // 路由变化触发重挂载，新会话消息随挂载加载
      }
      const appended = await postMessage(conversationId, content);
      setMessages((prev) => [...(prev ?? []), ...sortMessages(appended)]);
      setInput("");
    } catch (err) {
      setSendError(toSendError(err));
      // 发送失败时尽力同步服务端已落库的消息（用户消息可能已持久化）。
      if (conversationId != null) {
        fetchMessages(conversationId)
          .then((rows) => setMessages(sortMessages(rows)))
          .catch(() => undefined);
      }
    } finally {
      setSending(false);
    }
  };

  const isNewConversation = conversationId == null;

  return (
    <div className="flex min-h-[28rem] gap-4">
      <section className="w-60 shrink-0" aria-label={t("console.chat.conversations")}>
        <a
          href="#/console/chat"
          data-testid="conversation-new"
          className="block rounded-md bg-slate-900 px-3 py-2 text-center text-sm text-white hover:bg-slate-700"
        >
          + {t("console.chat.newConversation")}
        </a>
        <div className="mt-3 flex flex-col gap-1" data-testid="conversation-list">
          {conversations == null && !listError && (
            <p className="px-2 py-4 text-xs text-slate-400" data-testid="conversations-loading">
              {t("console.chat.conversationsLoading")}
            </p>
          )}
          {listError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3" data-testid="chat-list-error">
              <p className="text-sm text-red-700">{t("console.chat.listErrorTitle")}</p>
              <button
                type="button"
                onClick={() => void loadConversations()}
                className="mt-2 rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100"
              >
                {t("console.chat.retry")}
              </button>
            </div>
          )}
          {conversations != null && conversations.length === 0 && !listError && (
            <p className="px-2 py-4 text-xs text-slate-400" data-testid="conversations-empty">
              {t("console.chat.conversationsEmpty")}
            </p>
          )}
          {conversations?.map((c) => {
            const active = c.id === conversationId;
            return (
              <a
                key={c.id}
                href={`#/console/chat?c=${c.id}`}
                data-testid="conversation-item"
                className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-slate-100 font-medium text-slate-900"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span className="block truncate" title={c.title}>
                  {c.title}
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  {formatServerDate(c.created_at)}
                </span>
              </a>
            );
          })}
        </div>
      </section>

      <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-slate-200">
        {isNewConversation && (
          <div className="border-b border-slate-200 px-5 py-4" data-testid="chat-start">
            <h1 className="text-base font-semibold">{t("console.chat.startTitle")}</h1>
            <p className="mt-1 text-xs text-slate-500">{t("console.chat.startHint")}</p>
          </div>
        )}

        <div
          className="flex-1 space-y-3 overflow-y-auto px-5 py-4"
          data-testid="message-list"
        >
          {messages == null && messagesError == null && !isNewConversation && (
            <p className="text-xs text-slate-400" data-testid="messages-loading">
              {t("console.chat.messagesLoading")}
            </p>
          )}
          {messagesError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3" data-testid="chat-messages-error">
              <p className="text-sm text-red-700">{t("console.chat.messagesErrorTitle")}</p>
              <button
                type="button"
                data-testid="messages-retry"
                onClick={() => {
                  setMessagesError(null);
                  fetchMessages(conversationId!)
                    .then((rows) => setMessages(sortMessages(rows)))
                    .catch(() => setMessagesError("messages"));
                }}
                className="mt-2 rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100"
              >
                {t("console.chat.retry")}
              </button>
            </div>
          )}
          {messages != null && messages.length === 0 && (
            <p className="text-xs text-slate-400" data-testid="messages-empty">
              {t("console.chat.messagesEmpty")}
            </p>
          )}
          {messages?.map((m) => (
            <MessageRow key={m.id} message={m} />
          ))}
          <div ref={bottomRef} />
        </div>

        {sendError && (
          <div
            className="mx-5 mb-3 rounded-md border border-red-200 bg-red-50 p-3"
            data-testid="chat-error"
            role="alert"
          >
            <p className="text-sm font-medium text-red-700">
              {sendError.status === 429
                ? t("console.chat.error429")
                : t("console.chat.errorTitle")}
              {sendError.status != null && ` (${sendError.status})`}
            </p>
            {sendError.status === 429 && (
              <p className="mt-1 text-xs text-red-600">{t("console.chat.error429Hint")}</p>
            )}
            {sendError.status == null && (
              <p className="mt-1 text-xs text-red-600">{t("console.chat.errorNetwork")}</p>
            )}
            {sendError.detail && (
              <p className="mt-1 break-all font-mono text-[11px] text-red-500">
                {sendError.detail}
              </p>
            )}
          </div>
        )}

        <div className="flex items-end gap-3 border-t border-slate-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <label htmlFor="chat-input" className="sr-only">
              {t("console.chat.inputLabel")}
            </label>
            <textarea
              id="chat-input"
              data-testid="chat-input"
              rows={2}
              value={input}
              disabled={sending}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={
                isNewConversation
                  ? t("console.chat.inputPlaceholderNew")
                  : t("console.chat.inputPlaceholder")
              }
              className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>
          <button
            type="button"
            data-testid="chat-send"
            disabled={sending || !input.trim()}
            onClick={() => void send()}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {sending ? t("console.chat.sending") : t("console.chat.send")}
          </button>
        </div>
      </section>
    </div>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === "tool_trace") {
    return <ToolTraceRow message={message} />;
  }
  const isUser = message.role === "user";
  return (
    <div
      data-testid="message-item"
      data-role={message.role}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
          isUser
            ? "rounded-br-sm bg-slate-800 text-white"
            : "rounded-bl-sm border border-slate-200 bg-slate-50 text-slate-800"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}

function ToolTraceRow({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const payload = parseToolTrace(message.content);
  if (!payload) {
    // 留痕不合契约：按原文如实呈现（绝不静默丢弃）。
    return (
      <div data-testid="tool-trace" className="rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-[11px] text-slate-500">
        {message.content}
      </div>
    );
  }
  const ok = payload.result && typeof payload.result === "object"
    ? (payload.result as { ok?: unknown }).ok === true
    : undefined;
  return (
    <div data-testid="tool-trace" className="rounded-md border border-slate-200 bg-white">
      <button
        type="button"
        data-testid="tool-trace-toggle"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="font-mono text-[10px] uppercase tracking-wide text-slate-400">
          {t("console.chat.toolTrace")}
        </span>
        <span className="font-mono text-xs text-slate-700">{payload.tool_name}</span>
        {summarizeArgs(payload.arguments) && (
          <span className="truncate font-mono text-[11px] text-slate-400">
            {summarizeArgs(payload.arguments)}
          </span>
        )}
        {ok === true && (
          <span data-testid="tool-trace-ok" className="ml-auto rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
            {t("console.chat.resultOk")}
          </span>
        )}
        {ok === false && (
          <span data-testid="tool-trace-fail" className="ml-auto rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700">
            {t("console.chat.resultFail")}
          </span>
        )}
        <span className="shrink-0 text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-100 px-3 py-2">
          <div>
            <div className="text-[10px] font-medium uppercase text-slate-400">
              {t("console.chat.toolTraceArgs")}
            </div>
            <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-700" data-testid="tool-trace-args">
              {JSON.stringify(payload.arguments ?? {}, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase text-slate-400">
              {t("console.chat.toolTraceResult")}
            </div>
            <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-700" data-testid="tool-trace-result">
              {JSON.stringify(payload.result ?? {}, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
