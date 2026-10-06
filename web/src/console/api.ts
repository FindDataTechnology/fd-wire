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
  method: "GET" | "POST" | "DELETE";
  customerId: string;
  body?: unknown;
}

/** 统一响应处理：非 2xx 抛 ConsoleApiError（带后端 detail），204 返回 null。 */
async function readResponse(response: Response, url: string): Promise<unknown> {
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
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch (err) {
    throw new ConsoleApiError(`invalid json from ${url}: ${(err as Error).message}`);
  }
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
  return readResponse(response, url);
}

/** multipart 上传（浏览器自定 Content-Type boundary，绝不手写头）。 */
async function requestMultipart(
  url: string,
  customerId: string,
  form: FormData,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "X-Customer-Id": customerId },
      body: form,
    });
  } catch (err) {
    throw new ConsoleApiError(
      `network error fetching ${url}: ${(err as Error).message}`,
    );
  }
  return readResponse(response, url);
}

/** 呈现用错误文案：ConsoleApiError 有后端 detail 用 detail，否则用兜底文案。 */
export function apiErrorText(err: unknown, fallback: string): string {
  return err instanceof ConsoleApiError && err.detail ? err.detail : fallback;
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

// ── 我的数据：客户数据集与连接器（wire-customer-local-data 任务组 3）────────
// 路径/载荷/头严格对齐冻结契约 reports/interfaces.md §3.3 客户面（X-Customer-Id）。

export type DatasetSourceKind = "upload" | "connector";

export const SYNC_STATUSES = [
  "idle",
  "syncing",
  "ok",
  "failed",
  "paused_drift",
  "paused_quota",
] as const;

export type SyncStatus = (typeof SYNC_STATUSES)[number];

export interface DatasetColumn {
  name: string;
  type: string;
}

export interface Dataset {
  id: string;
  key: string;
  name: string;
  source_kind: DatasetSourceKind;
  connector_id: string | null;
  /** 连接器本地源名（本地配置 sources[].name 的映射键）。 */
  source_name?: string;
  /** 源内的表/文件名（如 public.orders 或 sales.csv）。 */
  source_ref: string | null;
  columns: DatasetColumn[];
  row_count: number;
  size_bytes: number;
  sync_cron: string | null;
  sync_status: SyncStatus;
  paused_reason: string | null;
  created_at: string;
  updated_at: string;
  /** 假后端归属过滤用（客户面响应可省略）。 */
  customer_id?: string;
}

export interface DatasetRows {
  columns: DatasetColumn[];
  /** 每行含引擎注入的行锚 `__row_id`（`pk:…` / `hash:…` / `ins:…`）。 */
  rows: Array<Record<string, unknown>>;
  total: number;
}

export type CorrectionOp = "update" | "delete" | "insert";

export interface Correction {
  id: number;
  dataset_id: string;
  op: CorrectionOp;
  row_id: string | null;
  column: string | null;
  value: unknown;
  values: Record<string, unknown> | null;
  actor: string;
  created_at: string;
  reverted_at: string | null;
  dangling_at: string | null;
  dangling_reason: string | null;
}

export type CorrectionInput =
  | { op: "update"; row_id: string; column: string; value: unknown }
  | { op: "delete"; row_id: string }
  | { op: "insert"; values: Record<string, unknown> };

export type SyncRecordStatus = "ok" | "failed" | "drift" | "quota";

export interface SyncRecord {
  id: string;
  dataset_id: string;
  started_at: string;
  finished_at: string | null;
  status: SyncRecordStatus;
  rows: number;
  error: string | null;
}

export type ConnectorStatus = "online" | "offline";

export interface Connector {
  id: string;
  name: string;
  version: string | null;
  status: ConnectorStatus;
  last_heartbeat_at: string | null;
  revoked_at: string | null;
  created_at: string;
  /** 假后端归属过滤用（客户面响应可省略）。 */
  customer_id?: string;
}

export interface PairingToken {
  token: string;
  expires_at: string;
}

export interface UploadPreview {
  upload_id: string;
  filename?: string;
  columns: DatasetColumn[];
  row_count: number;
  within_limit: boolean;
  sample_rows: Array<Record<string, unknown>>;
}

export type CreateDatasetSource =
  | { kind: "upload"; upload_id: string }
  | {
      kind: "connector";
      connector_id: string;
      /** 连接器本地源名（本地配置 sources[].name 的映射键），前端必填校验。 */
      source_name?: string;
      /** 源内的表/文件名（表名可带 schema 前缀；文件源为文件名）。 */
      source_ref: string;
      schedule_cron: string | null;
    };

export interface CreateDatasetInput {
  name: string;
  source: CreateDatasetSource;
}

/** 列表卡片（来源/行数/大小/同步状态/最近更新）。 */
export function fetchDatasets(customerId: string): Promise<Dataset[]> {
  return requestJson(`${API_BASE}/v1/datasets`, {
    method: "GET",
    customerId,
  }) as Promise<Dataset[]>;
}

/** 上传文件解析预览（multipart 字段名 `file`；超限由后端 400 如实拒收）。 */
export async function uploadDataset(
  customerId: string,
  file: File,
): Promise<UploadPreview> {
  const form = new FormData();
  form.append("file", file);
  return (await requestMultipart(
    `${API_BASE}/v1/datasets/uploads`,
    customerId,
    form,
  )) as UploadPreview;
}

/** 建档：upload 类立即 ingest 引擎；connector 类下发白名单与调度。 */
export function createDataset(
  customerId: string,
  payload: CreateDatasetInput,
): Promise<Dataset> {
  return requestJson(`${API_BASE}/v1/datasets`, {
    method: "POST",
    customerId,
    body: payload,
  }) as Promise<Dataset>;
}

export function fetchDataset(
  customerId: string,
  datasetId: string,
): Promise<Dataset> {
  return requestJson(`${API_BASE}/v1/datasets/${datasetId}`, {
    method: "GET",
    customerId,
  }) as Promise<Dataset>;
}

/** 删除数据集（引擎删表 + 元数据；连接器白名单移除≠删除）。 */
export function deleteDataset(
  customerId: string,
  datasetId: string,
): Promise<{ deleted: boolean }> {
  return requestJson(`${API_BASE}/v1/datasets/${datasetId}`, {
    method: "DELETE",
    customerId,
  }) as Promise<{ deleted: boolean }>;
}

/** 预览分页（透传引擎 preview；每行带行锚 `__row_id`）。 */
export function fetchDatasetRows(
  customerId: string,
  datasetId: string,
  page = 1,
  pageSize = 50,
): Promise<DatasetRows> {
  return requestJson(
    `${API_BASE}/v1/datasets/${datasetId}/rows?page=${page}&page_size=${pageSize}`,
    { method: "GET", customerId },
  ) as Promise<DatasetRows>;
}

/** 写修正层（改值/删行/加行）；不回写客户源。 */
export function addCorrection(
  customerId: string,
  datasetId: string,
  payload: CorrectionInput,
): Promise<{ correction_id: number }> {
  return requestJson(`${API_BASE}/v1/datasets/${datasetId}/corrections`, {
    method: "POST",
    customerId,
    body: payload,
  }) as Promise<{ correction_id: number }>;
}

/** 修正历史（含悬空与已回滚）。 */
export function fetchCorrections(
  customerId: string,
  datasetId: string,
): Promise<Correction[]> {
  return requestJson(`${API_BASE}/v1/datasets/${datasetId}/corrections`, {
    method: "GET",
    customerId,
  }) as Promise<Correction[]>;
}

/** 单条回滚（标记失效 + 重建有效表在 api/引擎侧完成）。 */
export function revertCorrection(
  customerId: string,
  datasetId: string,
  correctionId: number,
): Promise<{ reverted: boolean }> {
  return requestJson(
    `${API_BASE}/v1/datasets/${datasetId}/corrections/${correctionId}/revert`,
    { method: "POST", customerId },
  ) as Promise<{ reverted: boolean }>;
}

export function fetchSyncs(
  customerId: string,
  datasetId: string,
): Promise<SyncRecord[]> {
  return requestJson(`${API_BASE}/v1/datasets/${datasetId}/syncs`, {
    method: "GET",
    customerId,
  }) as Promise<SyncRecord[]>;
}

/** 漂移人工确认恢复：accept_columns = 客户确认接受的新结构列。 */
export function resumeDataset(
  customerId: string,
  datasetId: string,
  acceptColumns: string[],
): Promise<Dataset> {
  return requestJson(`${API_BASE}/v1/datasets/${datasetId}/resume`, {
    method: "POST",
    customerId,
    body: { accept_columns: acceptColumns },
  }) as Promise<Dataset>;
}

/** 生成一次性配对令牌（15 分钟、单次；明文仅此一次）。 */
export function createPairingToken(customerId: string): Promise<PairingToken> {
  return requestJson(`${API_BASE}/v1/connectors/pairing-tokens`, {
    method: "POST",
    customerId,
  }) as Promise<PairingToken>;
}

/** 连接器列表（在线/离线由心跳推导）。 */
export function fetchConnectors(customerId: string): Promise<Connector[]> {
  return requestJson(`${API_BASE}/v1/connectors`, {
    method: "GET",
    customerId,
  }) as Promise<Connector[]>;
}

/** 吊销连接器（连 key 一起即时失效）。 */
export function revokeConnector(
  customerId: string,
  connectorId: string,
): Promise<Connector> {
  return requestJson(`${API_BASE}/v1/connectors/${connectorId}`, {
    method: "DELETE",
    customerId,
  }) as Promise<Connector>;
}
