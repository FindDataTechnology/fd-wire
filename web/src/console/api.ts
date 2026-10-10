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

// ── 需求单客户面（wire-ux-consolidation 任务 3.2/4.1/4.3）──────────────
// 契约：POST/GET /api/v1/demands（Bearer 登录身份，服务端按映射客户隔离，
// 他企数据不可见）。提交四入参：description（必填）/ contact_email（必填）/
// company（选填）/ indicator_code（选填目录锚点）；状态三态 + rejected。

/** 需求单提交入参（后端 DemandCreate：旧表单字段一律不再收）。 */
export interface DemandCreateInput {
  description: string;
  contact_email: string;
  company?: string;
  indicator_code?: string;
}

/** 需求单时间线条目（客户可见投影）。 */
export interface DemandHistoryEvent {
  status: string;
  at: string;
  by: string;
  note: string | null;
}

/** 需求单客户视图（后端 DemandOut 截面：不含任何内部字段）。 */
export interface CustomerDemand {
  id: number;
  code: string;
  customer_id: string;
  /** 列表摘要（后端由描述截断生成）。 */
  title: string;
  /** 描述全文。 */
  intent: string;
  contact_email: string | null;
  company: string | null;
  status: string;
  status_history: DemandHistoryEvent[];
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** 提交需求单（四入参；成功返回 submitted 态新单）。 */
export function submitDemand(
  payload: DemandCreateInput,
): Promise<CustomerDemand> {
  return requestJson(`${API_BASE}/v1/demands`, {
    method: "POST",
    body: payload,
  }) as Promise<CustomerDemand>;
}

/** 本企业需求单列表（按创建时间倒序；跨客户隔离由服务端保证）。 */
export function fetchMyDemands(): Promise<CustomerDemand[]> {
  return requestJson(`${API_BASE}/v1/demands`, {
    method: "GET",
  }) as Promise<CustomerDemand[]>;
}

// ── 连接器下载清单（wire-connector-distribution 任务 3.1/3.2）──────────
// 契约：GET /api/v1/downloads/connector/manifest.json（公开端点，无鉴权；
// 未配置下载目录时 404）。二进制取件同命名空间
// GET /api/v1/downloads/connector/{platform}（Content-Length + X-Checksum-Sha256）。

/** manifest 单平台条目：available=false 即该平台文件缺失（如实呈现，不可链）。 */
export interface ConnectorDownloadPlatform {
  platform: string;
  filename: string;
  sha256: string;
  size: number;
  available: boolean;
}

/** 连接器发布清单（CI/手动晋升生成；版本号即心跳上报口径 sha-<7>）。 */
export interface ConnectorManifest {
  version: string;
  released_at: string;
  platforms: ConnectorDownloadPlatform[];
}

/** 取连接器下载清单（配对向导下载链接与「最新版本」对照的数据源）。 */
export function fetchConnectorManifest(): Promise<ConnectorManifest> {
  return requestJson(`${API_BASE}/v1/downloads/connector/manifest.json`, {
    method: "GET",
  }) as Promise<ConnectorManifest>;
}

/** 平台二进制下载地址（同源公开端点；与 manifest.platform 一一对应）。 */
export function connectorDownloadUrl(
  apiBase: string,
  platform: string,
): string {
  return `${apiBase}${API_BASE}/v1/downloads/connector/${encodeURIComponent(platform)}`;
}

// ── 免费档数据集配额（wire-free-tier-data-gate 任务 4.1）────────────────────
// 契约：GET /api/v1/datasets/quota → { plan_code, used_datasets,
// max_datasets, max_rows_per_dataset }。端点未就绪/失败时调用方应静默降级
// （配额条隐藏），绝不阻塞「我的数据」页面。
export interface DatasetQuota {
  plan_code: string;
  used_datasets: number;
  max_datasets: number;
  max_rows_per_dataset: number;
}

/** 免费档配额余量（已用集数 / 上限集数、单集行数上限）。 */
export function fetchDatasetQuota(): Promise<DatasetQuota> {
  return requestJson(`${API_BASE}/v1/datasets/quota`, {
    method: "GET",
  }) as Promise<DatasetQuota>;
}

// ── 产物生命周期（wire-artifacts-persistence）：持久化 + 版本化 + 状态机 ──
// 契约：/api/v1/artifacts*（Bearer 登录身份，服务端按映射客户隔离，
// 他企一律 404）；spec 每次保存追加新版本（append-only），状态机
// draft → published → archived 单向、archived → draft 恢复。

export type ArtifactStatus = "draft" | "published" | "archived";

export const ARTIFACT_STATUSES = ["draft", "published", "archived"] as const;

/** 产物概要（列表用；spec 在详情响应里）。 */
export interface Artifact {
  id: number;
  customer_id: string;
  kind: string;
  title: string;
  status: ArtifactStatus;
  version: number;
  /** 来源会话指针（会话草稿导入时保留；直接创建为 null）。 */
  origin_conversation_id: number | null;
  created_at: string;
  updated_at: string;
}

/** 产物详情：当前 spec + 状态迁移操作记录（append-only）。 */
export interface ArtifactDetail extends Artifact {
  spec: Record<string, unknown>;
  status_history: Array<{
    status: string;
    at: string;
    by: string;
    note: string | null;
  }>;
}

/** 版本历史条目（列表用；spec 在单查响应里）。 */
export interface ArtifactVersionSummary {
  version: number;
  operator: string | null;
  created_at: string;
}

/** 单个历史版本（含该版本 spec 快照，只读）。 */
export interface ArtifactVersionDetail extends ArtifactVersionSummary {
  spec: Record<string, unknown>;
}

interface PutRequestOptions {
  body?: unknown;
}

/** 带任意 method 的 JSON 请求（上方 RequestOptions 联合不含 PUT，
 * 本节追加的产物端点专用；鉴权与错误语义与 requestJson 完全一致）。 */
async function requestJsonAnyMethod(
  url: string,
  method: "PUT" | "POST",
  options: PutRequestOptions = {},
): Promise<unknown> {
  const { body } = options;
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

/** 本企业产物列表（按更新时间倒序；kind/status 可选过滤）。 */
export function fetchLifecycleArtifacts(
  kind?: string,
  status?: string,
): Promise<Artifact[]> {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (status) params.set("status", status);
  const query = params.size > 0 ? `?${params}` : "";
  return requestJson(`${API_BASE}/v1/artifacts${query}`, {
    method: "GET",
  }) as Promise<Artifact[]>;
}

/** 产物详情（当前 spec + 状态操作记录；跨客户 404）。 */
export function fetchLifecycleArtifact(id: number): Promise<ArtifactDetail> {
  return requestJson(`${API_BASE}/v1/artifacts/${id}`, {
    method: "GET",
  }) as Promise<ArtifactDetail>;
}

/** spec 保存（PUT）：成功返回新版本号所在详情；archived 拒改 409。 */
export function saveArtifactSpec(
  id: number,
  spec: Record<string, unknown>,
): Promise<ArtifactDetail> {
  return requestJsonAnyMethod(`${API_BASE}/v1/artifacts/${id}`, "PUT", {
    body: { spec },
  }) as Promise<ArtifactDetail>;
}

/** 版本历史（新版本在前；append-only）。 */
export function fetchArtifactVersions(
  id: number,
): Promise<ArtifactVersionSummary[]> {
  return requestJson(`${API_BASE}/v1/artifacts/${id}/versions`, {
    method: "GET",
  }) as Promise<ArtifactVersionSummary[]>;
}

/** 查看任一历史版本（含 spec 快照）。 */
export function fetchArtifactVersion(
  id: number,
  version: number,
): Promise<ArtifactVersionDetail> {
  return requestJson(
    `${API_BASE}/v1/artifacts/${id}/versions/${version}`,
    { method: "GET" },
  ) as Promise<ArtifactVersionDetail>;
}

/** 发布（draft → published；非法迁移 409 说明合法路径）。 */
export function publishArtifact(id: number): Promise<ArtifactDetail> {
  return requestJsonAnyMethod(
    `${API_BASE}/v1/artifacts/${id}/publish`,
    "POST",
  ) as Promise<ArtifactDetail>;
}

/** 归档（draft/published → archived；不删除，可恢复）。 */
export function archiveArtifact(id: number): Promise<ArtifactDetail> {
  return requestJsonAnyMethod(
    `${API_BASE}/v1/artifacts/${id}/archive`,
    "POST",
  ) as Promise<ArtifactDetail>;
}

/** 恢复（archived → draft；恢复后方可再编辑/发布）。 */
export function restoreArtifact(id: number): Promise<ArtifactDetail> {
  return requestJsonAnyMethod(
    `${API_BASE}/v1/artifacts/${id}/restore`,
    "POST",
  ) as Promise<ArtifactDetail>;
}

/** 会话草稿导入：固化为 draft 产物（保留来源会话指针）。 */
export function importArtifactFromDraft(
  conversationId: number,
  draftId: number,
): Promise<ArtifactDetail> {
  return requestJsonAnyMethod(`${API_BASE}/v1/artifacts/from-draft`, "POST", {
    body: { conversation_id: conversationId, draft_id: draftId },
  }) as Promise<ArtifactDetail>;
}

// ── 源包（wire-source-packs 任务 3.3）──────────────────────────────────
// 契约（tasks.md 2.1/2.2）：GET /api/v1/packs 与 GET /api/v1/packs/{id} 为
// 公开端点（匿名可读——目录公开通道，不过计量轨道）；详情响应为平铺分页
// {id,name_zh,name_en,desc,items,page,page_size,total}。订阅三端点
// （GET subscriptions / POST subscribe / DELETE unsubscribe）走 Bearer 登录
// 身份；重复订阅/退订幂等 200。

/** 源包概要（列表卡片用；指标数由服务端按 filter 实时算）。 */
export interface PackSummary {
  id: string;
  name_zh: string;
  name_en: string;
  desc: string;
  indicator_count: number;
}

/** 包内指标条目（详情清单行；code 即目录详情页锚点 #/catalog/{code}）。 */
export interface PackIndicator {
  code: string;
  name_zh: string;
  domain: string | null;
}

/** 包详情：平铺分页（items/total 与包元信息同层）。 */
export interface PackDetail extends PackSummary {
  items: PackIndicator[];
  page: number;
  page_size: number;
  total: number;
}

/** 订阅/退订响应（幂等：重复操作仍 200 返回终态）。 */
export interface PackSubscriptionResult {
  pack_id: string;
  subscribed: boolean;
}

/** 公开 GET（源包目录读）：有会话则附 Bearer，无会话不抛——匿名可浏览；
 * 非 2xx 错误语义与 requestJson 完全一致（ConsoleApiError 带 detail）。 */
async function requestJsonPublic(url: string): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const session = loadSession();
  if (session?.idToken) headers.Authorization = `Bearer ${session.idToken}`;
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers });
  } catch (err) {
    if (err instanceof ConsoleApiError) throw err;
    throw new ConsoleApiError(
      `network error fetching ${url}: ${(err as Error).message}`,
    );
  }
  return readResponse(response, url);
}

/** 源包列表（公开；含各包指标数）。 */
export function fetchPacks(): Promise<PackSummary[]> {
  return requestJsonPublic(`${API_BASE}/v1/packs`) as Promise<PackSummary[]>;
}

/** 包详情 + 分页指标清单（公开；page 从 1 起）。 */
export function fetchPackDetail(
  packId: string,
  page = 1,
  pageSize = 20,
): Promise<PackDetail> {
  return requestJsonPublic(
    `${API_BASE}/v1/packs/${encodeURIComponent(packId)}?page=${page}&page_size=${pageSize}`,
  ) as Promise<PackDetail>;
}

/** 我的订阅（登录；返回已订阅包 id 列表）。 */
export function fetchPackSubscriptions(): Promise<string[]> {
  return requestJson(`${API_BASE}/v1/packs/subscriptions`, {
    method: "GET",
  }) as Promise<string[]>;
}

/** 订阅源包（登录；幂等）。 */
export function subscribePack(packId: string): Promise<PackSubscriptionResult> {
  return requestJson(
    `${API_BASE}/v1/packs/${encodeURIComponent(packId)}/subscribe`,
    { method: "POST" },
  ) as Promise<PackSubscriptionResult>;
}

/** 退订源包（登录；幂等）。 */
export function unsubscribePack(
  packId: string,
): Promise<PackSubscriptionResult> {
  return requestJson(
    `${API_BASE}/v1/packs/${encodeURIComponent(packId)}/unsubscribe`,
    { method: "DELETE" },
  ) as Promise<PackSubscriptionResult>;
}

// ── 仪表盘签名分享（wire-dashboard-share 任务 2 web 面）────────────────────
// 契约（api 仓 share 模块，proposal 冻结形状）：
// - POST /api/v1/artifacts/{id}/share（Bearer 登录身份）：仅 published 且
//   kind=dashboard 的产物可生成（其他 403/404 明确）；未配置
//   FD_WIRE_SHARE_SECRET 时 503 带原因。返回 {url, expires_at, version}——
//   注意 url 是**数据端点**相对路径（/api/v1/share/dashboard/{id}?t=…&v=…），
//   前端展示链接须另行构造（origin + #/share/dashboard/{id}?t=…&v={version}，
//   t 从响应 url 的 query 里解出）。
//   wire-share-ttl-options：body 可选 ttl_days（枚举 7|30|90，缺省 30；
//   非法值 422 列合法值）；expires_at 按所选有效期计算。

/** 分享链接生成响应（POST /artifacts/{id}/share）。 */
export interface DashboardShareLink {
  /** 数据端点相对路径（含 t/v 查询参数）——不是给用户看的公开页链接。 */
  url: string;
  /** 到期时间（naive UTC ISO；默认 30 天）。 */
  expires_at: string;
  /** 钉死的产物版本（生成时刻版本；改版后需重新生成链接）。 */
  version: number;
}

/** 公开分享端点返回的只读看板载荷。 */
export interface SharedDashboard {
  title: string;
  spec: Record<string, unknown>;
  version: number;
  shared_at: string;
}

/** 分享链接有效期三档（wire-share-ttl-options）：枚举对齐 api 契约。 */
export const SHARE_TTL_DAYS = [7, 30, 90] as const;

export type ShareTtlDays = (typeof SHARE_TTL_DAYS)[number];

/** 生成仪表盘分享链接（仅 published dashboard；draft/archived/非 dashboard
 *  由服务端 403/404 拒绝，未配置 secret 503——UI 如实呈现后端 detail）。
 *  ttlDays：有效期三选一（wire-share-ttl-options），缺省 30 天。 */
export function createDashboardShareLink(
  id: number,
  ttlDays: ShareTtlDays = 30,
): Promise<DashboardShareLink> {
  return requestJsonAnyMethod(
    `${API_BASE}/v1/artifacts/${id}/share`,
    "POST",
    { body: { ttl_days: ttlDays } },
  ) as Promise<DashboardShareLink>;
}

/** 公开取分享看板（无鉴权端点——绝不携带登录头，未登录接收者直接打开）。
 *  404 = 链接无效/过期/产物下线（服务端统一口径，不区分原因）；
 *  503 = 分享功能未配置（FD_WIRE_SHARE_SECRET 缺失）。 */
export async function fetchSharedDashboard(
  id: number,
  token: string,
  version?: number | null,
): Promise<SharedDashboard> {
  const params = new URLSearchParams({ t: token });
  if (version != null) params.set("v", String(version));
  const url = `${API_BASE}/v1/share/dashboard/${id}?${params}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    if (err instanceof ConsoleApiError) throw err;
    throw new ConsoleApiError(
      `network error fetching ${url}: ${(err as Error).message}`,
    );
  }
  return readResponse(response, url) as Promise<SharedDashboard>;
}

// ── 仪表盘手动刷新（wire-dashboard-refresh 任务 2.1 web 面；
//    wire-dashboard-query-contract 任务 2.3 响应扩展）──────────────────────
// 契约（api 仓 refresh 端点，proposal 冻结形状）：
// - POST /api/v1/artifacts/{id}/refresh（Bearer 登录身份）：仅 kind=dashboard、
//   archived 不可刷；服务端按契约决策路径——≥1 面板带合法 query → 契约路径
//   （零 LLM 确定性执行，响应 mode="contract" + 逐面板结果 panels）；0 个 →
//   无头 AI 刷新轮（按各面板 source 重取数，响应 mode="ai"）。结构布局不动、
//   以 PUT 语义落新版本。成功返回 {version, refreshed_at, mode?, panels?}。
// - 409 = 同产物刷新进行中（单飞锁，两路共用）；403 = 档位未开通（无 cell，
//   detail 带升档引导——仅 AI 路径）；502/503 = LLM/引擎失败或契约全失败
//   （detail 带原因，零半写）——UI 如实呈现后端 detail。

/** 契约刷新逐面板结果（mode="contract" 响应的 panels 项）。 */
export interface DashboardRefreshPanelResult {
  /** 面板 id（spec 内 id；标题由前端按 spec 解析呈现）。 */
  panel_id: string;
  /** refreshed=快照已更新；kept=无契约原样保留；failed=保留原快照并记录原因。 */
  status: "refreshed" | "kept" | "failed";
  /** failed 面板的失败原因（服务端口径，如实呈现）。 */
  error?: string;
}

/** 手动刷新响应（POST /artifacts/{id}/refresh）。 */
export interface DashboardRefreshResult {
  /** 刷新落盘的新版本号（客户端据此提示并重拉详情）。 */
  version: number;
  /** 刷新完成时间（服务端 ISO 时间戳）。 */
  refreshed_at: string;
  /** 刷新路径：contract=确定性契约执行（零 LLM）；ai=无头 AI 轮（旧看板）。
   *  可选字段——旧后端/测试种子不带 mode 时按 ai 呈现（向后兼容）。 */
  mode?: "contract" | "ai";
  /** 逐面板结果（仅契约路径携带；AI 路径缺省或 null）。 */
  panels?: Array<DashboardRefreshPanelResult> | null;
}

/** 手动刷新仪表盘快照（draft/published 可刷；成功返回新版本号与时间）。 */
export function refreshDashboard(id: number): Promise<DashboardRefreshResult> {
  return requestJsonAnyMethod(
    `${API_BASE}/v1/artifacts/${id}/refresh`,
    "POST",
  ) as Promise<DashboardRefreshResult>;
}

// ── 定时刷新调度（wire-refresh-scheduler 任务 4.1 web 面）──────────────────
// 契约（api 仓 schedules 路由，proposal 冻结形状；Bearer 登录身份，跨客户 404）：
// - GET /api/v1/refresh-schedules：本人（本客户）调度行数组；
// - POST /api/v1/refresh-schedules：body
//   {target_type: "dataset"|"artifact", target_id, interval_minutes}
//   → 新建行（服务端校验属主 / 类型——dataset 须 derived 来源、artifact 须
//   kind=dashboard / 间隔地板 dataset ≥60、artifact ≥360 / 每客户配额，
//   非法 4xx 带 detail 如实呈现）；
// - DELETE /api/v1/refresh-schedules/{id} 与 POST /{id}/pause|resume
//   → 返回操作后的调度行。

/** 调度目标类型：派生数据集（复用 dataset_refresh，零 LLM 成本）与
 *  dashboard 产物（无头 AI 刷新轮）。 */
export type RefreshScheduleTargetType = "dataset" | "artifact";

/** 调度行（refresh_schedules 表的客户面投影）。 */
export interface RefreshSchedule {
  id: number;
  target_type: RefreshScheduleTargetType;
  /** dataset 目标 = 数据集 id；artifact 目标 = 产物 id（字符串化）。 */
  target_id: string;
  interval_minutes: number;
  /** 下次运行时间（naive UTC ISO；暂停期间不推进）。 */
  next_run_at: string;
  paused: boolean;
  /** 首轮前为 null；取值 pending | running | ok | failed。 */
  last_status: "pending" | "running" | "ok" | "failed" | null;
  last_run_at: string | null;
  /** 上次失败原因（last_status=failed 时非空；如实呈现）。 */
  last_error: string | null;
  created_at: string;
}

/** 本客户调度列表（含 dataset 与 artifact 两类目标）。 */
export function listRefreshSchedules(): Promise<RefreshSchedule[]> {
  return requestJson(`${API_BASE}/v1/refresh-schedules`, {
    method: "GET",
  }) as Promise<RefreshSchedule[]>;
}

/** 创建调度（间隔地板与配额由服务端校验，4xx detail 如实呈现）。 */
export function createRefreshSchedule(payload: {
  target_type: RefreshScheduleTargetType;
  target_id: string;
  interval_minutes: number;
}): Promise<RefreshSchedule> {
  return requestJson(`${API_BASE}/v1/refresh-schedules`, {
    method: "POST",
    body: payload,
  }) as Promise<RefreshSchedule>;
}

/** 删除调度（返回被删除的行；目标失存时调度器也会自动清理）。 */
export function deleteRefreshSchedule(id: number): Promise<RefreshSchedule> {
  return requestJson(`${API_BASE}/v1/refresh-schedules/${id}`, {
    method: "DELETE",
  }) as Promise<RefreshSchedule>;
}

/** 暂停调度（保留行与 next_run_at，不再到点执行）。 */
export function pauseRefreshSchedule(id: number): Promise<RefreshSchedule> {
  return requestJson(`${API_BASE}/v1/refresh-schedules/${id}/pause`, {
    method: "POST",
  }) as Promise<RefreshSchedule>;
}

/** 恢复已暂停的调度。 */
export function resumeRefreshSchedule(id: number): Promise<RefreshSchedule> {
  return requestJson(`${API_BASE}/v1/refresh-schedules/${id}/resume`, {
    method: "POST",
  }) as Promise<RefreshSchedule>;
}

// ── 变换管线图（wire-transform-pipeline-view 任务 2.2 web 面）────────────────
// 契约：GET /api/v1/pipeline/graph（Bearer 登录身份，require_console_customer_id
// 按映射客户隔离，他企节点/边不出现）——纯本地元数据组装、零引擎调用：
// nodes 为本企业全部数据集（含拓扑深度 depth：源=0，派生按链深）；
// edges 为父→子派生边（derived 的 source_ref 解析父 key，op v0 统一
// derived）；环/孤儿边跳过并计入 anomalies；节点上限 500、超出 truncated。

/** 管线图节点（数据集投影 + 拓扑深度标注）。 */
export interface PipelineGraphNode {
  dataset_id: string;
  key: string;
  name: string;
  source_kind: DatasetSourceKind;
  /** api（免费档轻量存储）/ cell（引擎物化）；未下发给 null。 */
  storage_tier: string | null;
  row_count: number;
  updated_at: string;
  /** 拓扑深度：源=0，派生逐级 +1（分层布局用）。 */
  depth: number;
  /** 定时重派生登记 cron；无登记为 null。 */
  schedule_cron: string | null;
}

/** 派生边：from（父）→ to（子）；op v0 统一 derived。 */
export interface PipelineGraphEdge {
  from_dataset_id: string;
  to_dataset_id: string;
  op: string;
}

/** 企业级数据集派生图。 */
export interface PipelineGraph {
  nodes: PipelineGraphNode[];
  edges: PipelineGraphEdge[];
  /** 被跳过的环/孤儿边计数（异常数据态，如实呈现）。 */
  anomalies: number;
  /** 节点超 500 上限被截断。 */
  truncated: boolean;
}

/** 本企业数据集派生图（管线视图数据源）。 */
export function getPipelineGraph(): Promise<PipelineGraph> {
  return requestJson(`${API_BASE}/v1/pipeline/graph`, {
    method: "GET",
  }) as Promise<PipelineGraph>;
}
