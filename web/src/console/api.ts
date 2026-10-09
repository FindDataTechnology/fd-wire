// 控制台 AI 对话构建 / 产物草稿 API 客户端（wire-platform-v1 任务 5.5 web 面）。
// - 基址与 catalog/api.ts 同约定：VITE_API_BASE 覆盖，默认 /api 同源
//   （dev 由 vite proxy 转发到 127.0.0.1:8000，生产同源由网关承接）。
// - 客户身份：Authorization: Bearer <ID token>（Logto 登录会话，见 auth.ts）；
//   开发占位 X-Customer-Id 已彻底弃用（wire-self-serve-launch 任务 4.4），
//   服务端以校验后的 Logto sub 经映射解析客户，跨客户一律 404。
// - 错误如实：非 2xx 一律抛 ConsoleApiError（携带 status 与后端 detail
//   文案，如 429 的每日限额说明），由 UI 原样呈现、绝不静默吞掉。
import { API_BASE } from "../catalog/api";
import { loadSession } from "./auth";

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
  body?: unknown;
}

/** 登录会话 Bearer 头（无会话即 401 如实上抛，绝不携带占位身份）。 */
function bearerHeaders(): Record<string, string> {
  const session = loadSession();
  if (!session?.idToken) {
    throw new ConsoleApiError("no console session (sign in required)", 401);
  }
  return { Authorization: `Bearer ${session.idToken}` };
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
  const { method, body } = options;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...bearerHeaders(),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    if (err instanceof ConsoleApiError) throw err;
    throw new ConsoleApiError(
      `network error fetching ${url}: ${(err as Error).message}`,
    );
  }
  return readResponse(response, url);
}

/** multipart 上传（浏览器自定 Content-Type boundary，绝不手写头）。 */
async function requestMultipart(
  url: string,
  form: FormData,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", ...bearerHeaders() },
      body: form,
    });
  } catch (err) {
    if (err instanceof ConsoleApiError) throw err;
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
  payload: ConversationCreateInput,
): Promise<ConversationDetail> {
  return requestJson(`${API_BASE}/v1/ai/conversations`, {
    method: "POST",
    body: payload,
  }) as Promise<ConversationDetail>;
}

/** 本企业对话列表（按创建时间倒序）。 */
export function fetchConversations(): Promise<Conversation[]> {
  return requestJson(`${API_BASE}/v1/ai/conversations`, {
    method: "GET",
  }) as Promise<Conversation[]>;
}

/** 会话全部消息（user / assistant / tool_trace 三角色）。 */
export function fetchMessages(
  conversationId: number,
): Promise<ChatMessage[]> {
  return requestJson(
    `${API_BASE}/v1/ai/conversations/${conversationId}/messages`,
    { method: "GET" },
  ) as Promise<ChatMessage[]>;
}

/** 追加用户消息并驱动一轮构建循环（返回本轮落库的消息序列）。 */
export function postMessage(
  conversationId: number,
  content: string,
): Promise<ChatMessage[]> {
  return requestJson(
    `${API_BASE}/v1/ai/conversations/${conversationId}/messages`,
    { method: "POST", body: { content } },
  ) as Promise<ChatMessage[]>;
}

/** 单个会话的产物草稿列表。 */
export function fetchArtifacts(
  conversationId: number,
): Promise<DraftArtifact[]> {
  return requestJson(
    `${API_BASE}/v1/ai/conversations/${conversationId}/artifacts`,
    { method: "GET" },
  ) as Promise<DraftArtifact[]>;
}

/** 聚合本企业全部会话的产物草稿（任一会话失败即如实上抛）。 */
export async function fetchAllArtifacts(
  conversations: Conversation[],
): Promise<DraftArtifact[]> {
  const grouped = await Promise.all(
    conversations.map((c) => fetchArtifacts(c.id)),
  );
  return grouped
    .flat()
    .sort((a, b) => b.id - a.id);
}

// ── 我的数据：客户数据集与连接器（wire-customer-local-data 任务组 3）────────
// 路径/载荷严格对齐冻结契约 reports/interfaces.md §3.3 客户面（Bearer 登录身份）。

export type DatasetSourceKind = "upload" | "connector" | "declared" | "derived";

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
  /** 写入通道归属（wire-customer-data-engine）：console 成员 / data-key 应用 / agent。 */
  channel?: "console" | "data-key" | "agent";
  actor_id?: string | null;
  actor_label?: string | null;
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
export function fetchDatasets(): Promise<Dataset[]> {
  return requestJson(`${API_BASE}/v1/datasets`, {
    method: "GET",
  }) as Promise<Dataset[]>;
}

/** 上传文件解析预览（multipart 字段名 `file`；超限由后端 400 如实拒收）。 */
export async function uploadDataset(
  file: File,
): Promise<UploadPreview> {
  const form = new FormData();
  form.append("file", file);
  return (await requestMultipart(
    `${API_BASE}/v1/datasets/uploads`,
    form,
  )) as UploadPreview;
}

/** 建档：upload 类立即 ingest 引擎；connector 类下发白名单与调度。 */
export function createDataset(
  payload: CreateDatasetInput,
): Promise<Dataset> {
  return requestJson(`${API_BASE}/v1/datasets`, {
    method: "POST",
    body: payload,
  }) as Promise<Dataset>;
}

export function fetchDataset(
  datasetId: string,
): Promise<Dataset> {
  return requestJson(`${API_BASE}/v1/datasets/${datasetId}`, {
    method: "GET",
  }) as Promise<Dataset>;
}

/** 删除数据集（引擎删表 + 元数据；连接器白名单移除≠删除）。 */
export function deleteDataset(
  datasetId: string,
): Promise<{ deleted: boolean }> {
  return requestJson(`${API_BASE}/v1/datasets/${datasetId}`, {
    method: "DELETE",
  }) as Promise<{ deleted: boolean }>;
}

/** 预览分页（透传引擎 preview；每行带行锚 `__row_id`）。 */
export function fetchDatasetRows(
  datasetId: string,
  page = 1,
  pageSize = 50,
): Promise<DatasetRows> {
  return requestJson(
    `${API_BASE}/v1/datasets/${datasetId}/rows?page=${page}&page_size=${pageSize}`,
    { method: "GET" },
  ) as Promise<DatasetRows>;
}

/** 写修正层（改值/删行/加行）；不回写客户源。 */
export function addCorrection(
  datasetId: string,
  payload: CorrectionInput,
): Promise<{ correction_id: number }> {
  return requestJson(`${API_BASE}/v1/datasets/${datasetId}/corrections`, {
    method: "POST",
    body: payload,
  }) as Promise<{ correction_id: number }>;
}

/** 修正历史（含悬空与已回滚）。 */
export function fetchCorrections(
  datasetId: string,
): Promise<Correction[]> {
  return requestJson(`${API_BASE}/v1/datasets/${datasetId}/corrections`, {
    method: "GET",
  }) as Promise<Correction[]>;
}

/** 单条回滚（标记失效 + 重建有效表在 api/引擎侧完成）。 */
export function revertCorrection(
  datasetId: string,
  correctionId: number,
): Promise<{ reverted: boolean }> {
  return requestJson(
    `${API_BASE}/v1/datasets/${datasetId}/corrections/${correctionId}/revert`,
    { method: "POST" },
  ) as Promise<{ reverted: boolean }>;
}

export function fetchSyncs(
  datasetId: string,
): Promise<SyncRecord[]> {
  return requestJson(`${API_BASE}/v1/datasets/${datasetId}/syncs`, {
    method: "GET",
  }) as Promise<SyncRecord[]>;
}

/** 漂移人工确认恢复：accept_columns = 客户确认接受的新结构列。 */
export function resumeDataset(
  datasetId: string,
  acceptColumns: string[],
): Promise<Dataset> {
  return requestJson(`${API_BASE}/v1/datasets/${datasetId}/resume`, {
    method: "POST",
    body: { accept_columns: acceptColumns },
  }) as Promise<Dataset>;
}

// ── 数据面 key（wire-customer-data-engine 5.2）────────────────────

export interface DataPlaneKey {
  id: string;
  label: string;
  fingerprint: string;
  dataset_ids: string[];
  status: "active" | "revoked";
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

export interface DataPlaneKeyCreated extends DataPlaneKey {
  /** 明文仅铸造响应一次；落库只有 sha256。 */
  key: string;
}

export function fetchDataPlaneKeys(): Promise<DataPlaneKey[]> {
  return requestJson(`${API_BASE}/v1/data-plane-keys`, {
    method: "GET",
  }) as Promise<DataPlaneKey[]>;
}

/** 铸造：dataset_ids 空 = 本企业全部数据集。 */
export function createDataPlaneKey(payload: {
  label: string;
  dataset_ids?: string[];
}): Promise<DataPlaneKeyCreated> {
  return requestJson(`${API_BASE}/v1/data-plane-keys`, {
    method: "POST",
    body: payload,
  }) as Promise<DataPlaneKeyCreated>;
}

/** 吊销即时生效（验证路径无缓存层）。 */
export function revokeDataPlaneKey(keyId: string): Promise<DataPlaneKey> {
  return requestJson(`${API_BASE}/v1/data-plane-keys/${keyId}`, {
    method: "DELETE",
  }) as Promise<DataPlaneKey>;
}

// ── 结构化查询（wire-customer-data-engine 5.3；与 MCP 工具零漂移）──

export type QueryFilterOp =
  | "eq" | "ne" | "gt" | "gte" | "lt" | "lte"
  | "in" | "notin" | "like" | "isnull" | "notnull";

export interface QueryFilter {
  column: string;
  op: QueryFilterOp;
  value?: unknown;
  values?: unknown[];
}

export interface QuerySort {
  column: string;
  dir: "asc" | "desc";
}

export interface DatasetQueryInput {
  filters?: QueryFilter[];
  sort?: QuerySort[];
  limit?: number;
  offset?: number;
  count_only?: boolean;
  raw?: boolean;
}

export interface DatasetQueryResult {
  columns: DatasetColumn[];
  rows: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
  truncated: boolean;
}

/** 结构化查询（服务端执行：过滤/排序/精确 total；行含 __row_id 锚）。 */
export function queryDataset(
  datasetId: string,
  input: DatasetQueryInput,
): Promise<DatasetQueryResult> {
  return requestJson(`${API_BASE}/v1/datasets/${datasetId}/query`, {
    method: "POST",
    body: input,
  }) as Promise<DatasetQueryResult>;
}

/** 生成一次性配对令牌（15 分钟、单次；明文仅此一次）。 */
export function createPairingToken(): Promise<PairingToken> {
  return requestJson(`${API_BASE}/v1/connectors/pairing-tokens`, {
    method: "POST",
  }) as Promise<PairingToken>;
}

/** 连接器列表（在线/离线由心跳推导）。 */
export function fetchConnectors(): Promise<Connector[]> {
  return requestJson(`${API_BASE}/v1/connectors`, {
    method: "GET",
  }) as Promise<Connector[]>;
}

/** 吊销连接器（连 key 一起即时失效）。 */
export function revokeConnector(
  connectorId: string,
): Promise<Connector> {
  return requestJson(`${API_BASE}/v1/connectors/${connectorId}`, {
    method: "DELETE",
  }) as Promise<Connector>;
}

// ── 溯源账本客户面（wire-provenance-ledger 任务组 8）────────────────────
// 路径/载荷严格对齐冻结契约：/api/v1/provenance/*（Bearer 登录身份隔离）。

/** 溯源档位四档（off 不入账；已入账事件不因调档被清除）。 */
export const PROVENANCE_TIERS = [
  "off",
  "chain_only",
  "anchored_batch",
  "anchored_realtime",
] as const;

export type ProvenanceTier = (typeof PROVENANCE_TIERS)[number];

/** 事件操作者（v1 无签名，签名位为信封预留字段）。 */
export interface ProvenanceActor {
  kind: string;
  id: string;
}

/** 事件主体（kind 如 dataset / cell，key 即主体键）。 */
export interface ProvenanceSubject {
  kind: string;
  key: string;
}

/** 账本事件信封（面向控制台的呈现字段；哈希链字段不在此响应中）。 */
export interface ProvenanceEvent {
  /** 账本内单调序号（倒序分页游标 before_seq 用）。 */
  seq: number;
  event_id: string;
  /** 命名空间化类型，如 dataset.correction.added / cell.registered。 */
  type: string;
  ts_platform: string;
  actor: ProvenanceActor;
  subject: ProvenanceSubject;
  payload: Record<string, unknown>;
}

export interface ProvenanceEventsPage {
  /** 按 seq 倒序。 */
  events: ProvenanceEvent[];
  has_more: boolean;
}

export interface ProvenanceStatus {
  tier: ProvenanceTier;
  integrity: { ok: boolean; checked: number };
  anchored_through: { epoch: number | null; backend: string | null };
  /** 该数据集首条入账事件时间（溯源起点）。 */
  first_event_ts: string | null;
  /** 非空时如实展示（如启用前无历史事件——不伪造起点）。 */
  note: string | null;
}

export interface ProvenanceOverview {
  ledger: string;
  last_seq: number;
  integrity: { ok: boolean; checked: number };
  anchoring: {
    backend: string | null;
    last_sealed_epoch: number | null;
    lag_events: number;
  };
}

/** 数据集事件时间线（倒序；before_seq 为上一页最小 seq，向更早翻页）。 */
export function fetchProvenanceEvents(
  datasetKey: string,
  beforeSeq?: number,
  limit = 50,
): Promise<ProvenanceEventsPage> {
  const params = new URLSearchParams();
  if (beforeSeq != null) params.set("before_seq", String(beforeSeq));
  params.set("limit", String(limit));
  return requestJson(
    `${API_BASE}/v1/provenance/datasets/${encodeURIComponent(datasetKey)}/events?${params}`,
    { method: "GET" },
  ) as Promise<ProvenanceEventsPage>;
}

/** 数据集溯源状态（档位/链完整性/锚定进度/起点标注）。 */
export function fetchProvenanceStatus(
  datasetKey: string,
): Promise<ProvenanceStatus> {
  return requestJson(
    `${API_BASE}/v1/provenance/datasets/${encodeURIComponent(datasetKey)}/status`,
    { method: "GET" },
  ) as Promise<ProvenanceStatus>;
}

/** 调整数据集溯源档位（存活期内可调；已入账事件不受影响）。 */
export function updateProvenanceTier(
  datasetKey: string,
  tier: ProvenanceTier,
): Promise<{ tier: ProvenanceTier }> {
  return requestJson(
    `${API_BASE}/v1/provenance/datasets/${encodeURIComponent(datasetKey)}/tier`,
    { method: "POST", body: { tier } },
  ) as Promise<{ tier: ProvenanceTier }>;
}

/** 企业级账本总览（全局 last_seq/完整性/锚定滞后）。 */
export function fetchProvenanceOverview(
): Promise<ProvenanceOverview> {
  return requestJson(`${API_BASE}/v1/provenance/overview`, {
    method: "GET",
  }) as Promise<ProvenanceOverview>;
}

/** 证据包二进制内容 + 下载文件名（无 Content-Disposition 时按约定命名）。 */
export interface EvidencePackage {
  blob: Blob;
  filename: string;
}

/**
 * 导出企业级证据包（机器可读账本导出 + 全部锚定回执 + 离线核验工具，
 * 二进制流）。带鉴权头用 fetch 拉取后转 blob 交给调用方触发下载；
 * 文件名优先取响应 Content-Disposition，缺省按
 * evidence-package-<日期>.jsonl.bin 约定命名。
 */
export async function fetchEvidencePackage(
): Promise<EvidencePackage> {
  const url = `${API_BASE}/v1/provenance/evidence-package`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/octet-stream",
        ...bearerHeaders(),
      },
    });
  } catch (err) {
    if (err instanceof ConsoleApiError) throw err;
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
  const disposition = response.headers?.get?.("content-disposition") ?? "";
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const date = new Date().toISOString().slice(0, 10);
  const filename = match?.[1] ?? `evidence-package-${date}.jsonl.bin`;
  try {
    return { blob: await response.blob(), filename };
  } catch (err) {
    throw new ConsoleApiError(`invalid body from ${url}: ${(err as Error).message}`);
  }
}

// ── 客户侧用量（usage-transparency 任务 6.2；口径与行数门/结算同源）──────
// 契约：GET /api/console/usage → { period, plan_code, included_lines,
// used_lines, remaining_lines }（登录映射客户自己且仅自己的当月聚合）。

export interface ConsoleUsage {
  /** 账期（自然月，如 2026-10）。 */
  period: string;
  plan_code: string;
  included_lines: number;
  used_lines: number;
  remaining_lines: number;
}

/** 登录客户当月用量（已用/含额/余量，rows_returned 口径）。 */
export function fetchConsoleUsage(): Promise<ConsoleUsage> {
  return requestJson(`${API_BASE}/console/usage`, {
    method: "GET",
  }) as Promise<ConsoleUsage>;
}
