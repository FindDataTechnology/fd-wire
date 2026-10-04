// 控制台 AI 对话构建 / 产物草稿 API 客户端（wire-platform-v1 任务 5.5 web 面）。
// - 基址与 catalog/api.ts 同约定：VITE_API_BASE 覆盖，默认 /api 同源
//   （dev 由 vite proxy 转发到 127.0.0.1:8000，生产同源由网关承接）。
// - 客户身份：X-Customer-Id 头（开发占位，鉴权上线后由登录态替换）。
// - 错误如实：非 2xx 一律抛 ConsoleApiError（携带 status 与后端 detail
//   文案，如 429 的每日限额说明），由 UI 原样呈现、绝不静默吞掉。
import { API_BASE } from "../catalog/api";

export type MessageRole = "user" | "assistant" | "tool_trace";

export const ARTIFACT_KINDS = [
  "dashboard",
  "composite_indicator",
  "research_report",
  "alert_rule",
  "refresh_schedule",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface Conversation {
  id: number;
  customer_id: string;
  title: string;
  created_at: string;
}

export interface ChatMessage {
  id: number;
  conversation_id: number;
  role: MessageRole;
  content: string;
  created_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: ChatMessage[];
}

export interface DraftArtifact {
  id: number;
  conversation_id: number;
  customer_id: string;
  kind: string;
  spec: Record<string, unknown>;
  status: string;
  created_at: string;
}

export interface ConversationCreateInput {
  title?: string;
  message?: string;
}

export class ConsoleApiError extends Error {
  readonly status: number | undefined;
  /** 后端 error body 的 detail 文案（如 429 限额说明），无则 undefined。 */
  readonly detail: string | undefined;

  constructor(message: string, status?: number, detail?: string) {
    super(message);
    this.name = "ConsoleApiError";
    this.status = status;
    this.detail = detail;
  }
}

interface RequestOptions {
  method: "GET" | "POST";
  customerId: string;
  body?: unknown;
}

async function requestJson(url: string, options: RequestOptions): Promise<unknown> {
  const { method, customerId, body } = options;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "X-Customer-Id": customerId,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    throw new ConsoleApiError(
      `network error fetching ${url}: ${(err as Error).message}`,
    );
  }
  if (!response.ok) {
    let detail: string | undefined;
    try {
      const data: unknown = await response.json();
      if (
        data &&
        typeof data === "object" &&
        typeof (data as { detail?: unknown }).detail === "string"
      ) {
        detail = (data as { detail: string }).detail;
      }
    } catch {
      /* 无 JSON body：保留 undefined */
    }
    throw new ConsoleApiError(
      `console api ${response.status} for ${url}`,
      response.status,
      detail,
    );
  }
  try {
    return await response.json();
  } catch (err) {
    throw new ConsoleApiError(`invalid json from ${url}: ${(err as Error).message}`);
  }
}

/** 新开对话（带 message 即当场跑一轮构建循环）。 */
export function createConversation(
  customerId: string,
  payload: ConversationCreateInput,
): Promise<ConversationDetail> {
  return requestJson(`${API_BASE}/v1/ai/conversations`, {
    method: "POST",
    customerId,
    body: payload,
  }) as Promise<ConversationDetail>;
}

/** 本企业对话列表（按创建时间倒序）。 */
export function fetchConversations(customerId: string): Promise<Conversation[]> {
  return requestJson(`${API_BASE}/v1/ai/conversations`, {
    method: "GET",
    customerId,
  }) as Promise<Conversation[]>;
}

/** 会话全部消息（user / assistant / tool_trace 三角色）。 */
export function fetchMessages(
  customerId: string,
  conversationId: number,
): Promise<ChatMessage[]> {
  return requestJson(
    `${API_BASE}/v1/ai/conversations/${conversationId}/messages`,
    { method: "GET", customerId },
  ) as Promise<ChatMessage[]>;
}

/** 追加用户消息并驱动一轮构建循环（返回本轮落库的消息序列）。 */
export function postMessage(
  customerId: string,
  conversationId: number,
  content: string,
): Promise<ChatMessage[]> {
  return requestJson(
    `${API_BASE}/v1/ai/conversations/${conversationId}/messages`,
    { method: "POST", customerId, body: { content } },
  ) as Promise<ChatMessage[]>;
}

/** 单个会话的产物草稿列表。 */
export function fetchArtifacts(
  customerId: string,
  conversationId: number,
): Promise<DraftArtifact[]> {
  return requestJson(
    `${API_BASE}/v1/ai/conversations/${conversationId}/artifacts`,
    { method: "GET", customerId },
  ) as Promise<DraftArtifact[]>;
}

/** 聚合本企业全部会话的产物草稿（任一会话失败即如实上抛）。 */
export async function fetchAllArtifacts(
  customerId: string,
  conversations: Conversation[],
): Promise<DraftArtifact[]> {
  const grouped = await Promise.all(
    conversations.map((c) => fetchArtifacts(customerId, c.id)),
  );
  return grouped
    .flat()
    .sort((a, b) => b.id - a.id);
}
