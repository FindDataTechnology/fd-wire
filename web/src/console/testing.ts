// 测试专用：控制台 AI API 的内存假后端（语义对齐 api 仓 fd_wire_api.ai 路由：
// X-Customer-Id 隔离、创建即跑一轮循环、消息 append-only、产物草稿列表）。
import type {
  ChatMessage,
  Conversation,
  ConversationDetail,
  DraftArtifact,
  MessageRole,
} from "./api";

export type FakeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export type FetchCall = {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: unknown;
};

interface StoredConversation {
  meta: Conversation;
  messages: ChatMessage[];
  artifacts: DraftArtifact[];
}

function jsonResponse(body: unknown, status = 200): FakeResponse {
  return { ok: status < 400, status, json: () => Promise.resolve(body) };
}

function headersOf(init?: RequestInit): Record<string, string> {
  if (!init?.headers) return {};
  const record: Record<string, string> = {};
  new Headers(init.headers as HeadersInit).forEach((v, k) => {
    record[k.toLowerCase()] = v;
  });
  return record;
}

export interface ConsoleBackendOptions {
  /** 创建对话（带首条消息）时，除 user 外追加的回复消息序列。 */
  createReply?: Array<{ role: MessageRole; content: string }>;
  /** 续聊 POST 的回复消息序列（默认一条 assistant 回声）。 */
  chatReply?: Array<{ role: MessageRole; content: string }>;
  /** 强制 POST /ai/conversations 返回该状态（如 429 每日限额）。 */
  failCreateStatus?: number;
  failCreateDetail?: string;
}

/** 安装假后端为 global fetch；返回调用记录与状态注入接口。 */
export function installConsoleBackend(
  conversations: Conversation[],
  options: ConsoleBackendOptions = {},
): {
  calls: FetchCall[];
  fetchImpl: typeof fetch;
  addMessage: (
    conversationId: number,
    role: MessageRole,
    content: string,
  ) => ChatMessage;
  addArtifact: (artifact: Omit<DraftArtifact, "customer_id" | "status">) => void;
} {
  const store = new Map<number, StoredConversation>();
  let nextConversationId = 1;
  let nextMessageId = 1;
  let nextArtifactId = 1;
  for (const meta of conversations) {
    nextConversationId = Math.max(nextConversationId, meta.id + 1);
    store.set(meta.id, { meta, messages: [], artifacts: [] });
  }

  const chatReply =
    options.chatReply ?? [{ role: "assistant", content: "收到，已按你的意图处理。" }];

  function addMessage(
    conversationId: number,
    role: MessageRole,
    content: string,
  ): ChatMessage {
    const stored = store.get(conversationId)!;
    const message: ChatMessage = {
      id: nextMessageId++,
      conversation_id: conversationId,
      role,
      content,
      created_at: "2026-10-04T09:00:00",
    };
    stored.messages.push(message);
    return message;
  }

  function addArtifact(artifact: Omit<DraftArtifact, "customer_id" | "status">): void {
    const stored = store.get(artifact.conversation_id)!;
    stored.artifacts.push({
      ...artifact,
      id: artifact.id || nextArtifactId++,
      customer_id: stored.meta.customer_id,
      status: "draft",
    });
    nextArtifactId = Math.max(nextArtifactId, artifact.id + 1);
  }

  const calls: FetchCall[] = [];

  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit): Promise<FakeResponse> => {
    const url = new URL(String(input), "http://console.test");
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = headersOf(init);
    calls.push({
      method,
      url,
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    const customerId = headers["x-customer-id"];
    if (!customerId) {
      return Promise.resolve(
        jsonResponse({ detail: "缺少 X-Customer-Id（客户身份头）" }, 401),
      );
    }

    const path = url.pathname;
    if (path === "/api/v1/ai/conversations" && method === "POST") {
      if (options.failCreateStatus) {
        return Promise.resolve(
          jsonResponse(
            {
              detail:
                options.failCreateDetail ??
                `console api ${options.failCreateStatus}`,
            },
            options.failCreateStatus,
          ),
        );
      }
      const payload = (calls[calls.length - 1]!.body ?? {}) as {
        title?: string;
        message?: string;
      };
      const id = nextConversationId++;
      const meta: Conversation = {
        id,
        customer_id: customerId,
        title: payload.title ?? "新对话",
        created_at: "2026-10-04T10:00:00",
      };
      store.set(id, { meta, messages: [], artifacts: [] });
      if (payload.message) addMessage(id, "user", payload.message);
      for (const reply of options.createReply ?? chatReply) {
        addMessage(id, reply.role, reply.content);
      }
      const stored = store.get(id)!;
      const detail: ConversationDetail = { ...meta, messages: stored.messages };
      return Promise.resolve(jsonResponse(detail, 201));
    }

    if (path === "/api/v1/ai/conversations" && method === "GET") {
      const mine = [...store.values()]
        .filter((s) => s.meta.customer_id === customerId)
        .map((s) => s.meta)
        .sort((a, b) => b.id - a.id);
      return Promise.resolve(jsonResponse(mine));
    }

    let match = path.match(/^\/api\/v1\/ai\/conversations\/(\d+)\/messages$/);
    if (match) {
      const id = Number(match[1]);
      const stored = store.get(id);
      if (!stored || stored.meta.customer_id !== customerId) {
        return Promise.resolve(jsonResponse({ detail: "conversation not found" }, 404));
      }
      if (method === "GET") {
        return Promise.resolve(jsonResponse(stored.messages));
      }
      if (method === "POST") {
        const payload = calls[calls.length - 1]!.body as { content: string };
        const appended: ChatMessage[] = [addMessage(id, "user", payload.content)];
        for (const reply of chatReply) {
          appended.push(addMessage(id, reply.role, reply.content));
        }
        return Promise.resolve(jsonResponse(appended));
      }
    }

    match = path.match(/^\/api\/v1\/ai\/conversations\/(\d+)\/artifacts$/);
    if (match && method === "GET") {
      const id = Number(match[1]);
      const stored = store.get(id);
      if (!stored || stored.meta.customer_id !== customerId) {
        return Promise.resolve(jsonResponse({ detail: "conversation not found" }, 404));
      }
      return Promise.resolve(jsonResponse(stored.artifacts));
    }

    return Promise.resolve(jsonResponse({ detail: "not found" }, 404));
  }) as unknown as typeof fetch;

  return { calls, fetchImpl, addMessage, addArtifact };
}

/** 任意请求一律失败的后端（错误态测试）。 */
export function consoleFailingBackend(
  status = 500,
  detail = "boom",
): typeof fetch {
  return (() =>
    Promise.resolve(jsonResponse({ detail }, status))) as unknown as typeof fetch;
}
