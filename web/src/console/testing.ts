// 测试专用：控制台 API 的内存假后端（语义对齐 api 仓 fd_wire_api 路由：
// Authorization: Bearer <ID token> 身份（解码 sub 即客户标识）、创建即跑
// 一轮循环、消息 append-only、产物草稿列表；wire-customer-local-data 任务组 3
// 追加 数据集/上传/修正/同步/连接器 路由；wire-self-serve-launch 追加
// /api/console/{auth/config,session,usage} 路由——纯内存、零网络）。
import type {
  ApiDetailItem,
  ArtifactStatus,
  ChatMessage,
  Connector,
  ConnectorManifest,
  Conversation,
  ConversationDetail,
  Correction,
  CorrectionInput,
  CorrectionOp,
  CustomerDemand,
  Dataset,
  DatasetColumn,
  DatasetQuota,
  DraftArtifact,
  MessageRole,
  PackIndicator,
  PipelineGraph,
  RefreshSchedule,
  SyncRecord,
  UploadPreview,
} from "./api";
import { saveSession, type ConsoleSession } from "./auth";

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
  /** 非 JSON 请求体（multipart 上传的 FormData）原样保留，便于断言文件字段。 */
  formData?: FormData;
};

/** 数据集 + 可选存储层字段（wire-free-tier-data-gate：api 侧免费档响应带
 *  storage_tier，组件容错读取；Dataset 接口本体保持不动避免与并行改动冲突）。 */
type DatasetWithTier = Dataset & { storage_tier?: string };

interface StoredConversation {
  meta: Conversation;
  messages: ChatMessage[];
  artifacts: DraftArtifact[];
}

/** 生命周期产物种子（wire-artifacts-persistence；versions 不给时按 spec 造 v1）。 */
export type LifecycleArtifactSeed = {
  id: number;
  kind: string;
  title: string;
  status?: ArtifactStatus;
  version?: number;
  origin_conversation_id?: number | null;
  customer_id?: string;
  spec?: Record<string, unknown>;
  versions?: Array<{
    spec: Record<string, unknown>;
    operator?: string | null;
    created_at?: string;
  }>;
  created_at?: string;
  updated_at?: string;
};

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
  /** /api/console/auth/config 下发体（缺省 configured=true 的可用配置；false=阻塞态）。 */
  authConfig?: { configured: boolean };
  /** 强制 auth/config 返回该状态（配置端点故障态）。 */
  failAuthConfigStatus?: number;
  /** 会话建立返回的客户 plan_code（免费档门禁测试用，默认 basic）。 */
  planCode?: string;
  /** 会话建立返回的客户名（默认 演示客户）。 */
  customerName?: string;
  /** 会话建立下发的明文密钥（仅开户那次；缺省 null）。 */
  keyOnce?: string | null;
  /** 强制 POST /api/console/session 返回 502 failed（开户链路断言）。 */
  sessionFailReason?: string;
  /** GET /api/console/usage 响应体覆盖（用量页测试）。 */
  usage?: {
    period: string;
    plan_code: string;
    included_lines: number;
    used_lines: number;
    remaining_lines: number;
  };
  /** 强制 /api/console/usage 返回该状态。 */
  failUsageStatus?: number;
  /** 种子数据集（带 customer_id 的仅对同客户可见）。 */
  datasets?: Dataset[];
  /** 种子连接器（带 customer_id 的仅对同客户可见）。 */
  connectors?: Connector[];
  /** 数据集预览行：dataset id → {columns, rows}；缺 __row_id 的行自动补 `hash:seed-<n>`。 */
  datasetRows?: Record<
    string,
    { columns: DatasetColumn[]; rows: Array<Record<string, unknown>> }
  >;
  /** 上传响应注入（默认 2 列 / 120 行 / within_limit=true）。 */
  uploadPreview?: Partial<UploadPreview>;
  /** 强制上传失败（如 400 行数超限）。 */
  failUploadStatus?: number;
  failUploadDetail?: string;
  /** GET /api/v1/datasets/quota 响应体覆盖（免费档配额条测试；缺省按档位与
   *  当前数据集数推导：free=3 集 × 10,000 行）。 */
  datasetQuota?: DatasetQuota;
  /** 强制 /api/v1/datasets/quota 返回该状态（配额端点未就绪态）。 */
  failQuotaStatus?: number;
  /** 强制 POST /api/v1/datasets 返回该状态（如免费档建集触限 400）。 */
  failCreateDatasetStatus?: number;
  failCreateDatasetDetail?: string;
  /** 配对令牌有效期秒数（默认 900 = 15 分钟）。 */
  pairingTokenTtlSeconds?: number;
  /** 种子需求单（带 customer_id 的仅对同客户可见；wire-ux-consolidation 4.3）。 */
  demands?: CustomerDemand[];
  /** 强制 POST /api/v1/demands 返回该状态（如 422 校验回显）；detail 可为
   *  字符串或 FastAPI 校验错误数组形状（wire-demand-generation-orchestration
   *  冻结契约注入）。 */
  failDemandCreateStatus?: number;
  failDemandCreateDetail?: string | ApiDetailItem[];
  /** 连接器下载清单（wire-connector-distribution 3.1）：GET
   *  /api/v1/downloads/connector/manifest.json 的响应体注入（缺省 404——
   *  端点未配置态；含 available=false 条目即「部分 unavailable」态）。 */
  connectorManifest?: ConnectorManifest;
  /** 强制 manifest 端点返回该状态（不可达/网络错态）。 */
  failManifestStatus?: number;
  /** 种子源包（wire-source-packs 3.3）：indicator_count 按 indicators 长度推导。 */
  packs?: FakePackSeed[];
  /** 预置订阅包 id（缺省归属 demo-customer；订阅面 Bearer 身份隔离）。 */
  packSubscriptions?: string[];
  /** 强制源包公开端点（列表/详情）返回该状态。 */
  failPacksStatus?: number;
  /** 强制订阅/退订端点返回该状态（如 401 会话失效态）。 */
  failPackSubscribeStatus?: number;
  /** 种子定时刷新调度（wire-refresh-scheduler 4.1；带 customer_id 的仅同客户可见）。 */
  refreshSchedules?: Array<RefreshSchedule & { customer_id?: string }>;
  /** 强制 POST /api/v1/refresh-schedules 返回该状态（创建失败态）。 */
  failScheduleCreateStatus?: number;
  failScheduleCreateDetail?: string;
  /** 管线图响应体覆盖（wire-transform-pipeline-view 2.2；不传则按种子数据集
   *  组装：derived 的 source_ref 解析父 key 成边、BFS 深度、环/孤儿计 anomalies）。 */
  pipelineGraph?: PipelineGraph;
  /** 强制 GET /api/v1/pipeline/graph 返回该状态（错误态测试）。 */
  failPipelineGraphStatus?: number;
  failPipelineGraphDetail?: string;
  /** 强制 POST /api/v1/artifacts（空白建板，wire-dashboard-blank-create）
   *  返回该状态（如 422 校验回显）。 */
  failArtifactCreateStatus?: number;
  failArtifactCreateDetail?: string;
}

/** 源包种子（wire-source-packs）：假后端按 indicators 分页切片出详情。 */
export type FakePackSeed = {
  id: string;
  name_zh: string;
  name_en: string;
  desc: string;
  indicators: PackIndicator[];
};

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
  addLifecycleArtifact: (seed: LifecycleArtifactSeed) => void;
  addDataset: (dataset: Dataset) => void;
  addConnector: (connector: Connector) => void;
  addRows: (
    datasetId: string,
    columns: DatasetColumn[],
    rows: Array<Record<string, unknown>>,
  ) => void;
  addCorrection: (correction: Correction) => void;
  addSync: (sync: SyncRecord) => void;
  addRefreshSchedule: (seed: RefreshSchedule & { customer_id?: string }) => void;
  getDatasets: () => Dataset[];
  getCorrections: (datasetId: string) => Correction[];
  getPackSubscriptions: (customerId?: string) => string[];
} {
  const store = new Map<number, StoredConversation>();
  let nextConversationId = 1;
  let nextMessageId = 1;
  let nextArtifactId = 1;
  for (const meta of conversations) {
    nextConversationId = Math.max(nextConversationId, meta.id + 1);
    store.set(meta.id, { meta, messages: [], artifacts: [] });
  }

  // ── 数据集假后端状态（我的数据） ──
  const datasets = new Map<string, Dataset>();
  let nextDatasetSeq = 1;
  for (const dataset of options.datasets ?? []) datasets.set(dataset.id, { ...dataset });
  while (datasets.has(`ds-${nextDatasetSeq}`)) nextDatasetSeq += 1;
  const rowsStore = new Map<
    string,
    { columns: DatasetColumn[]; rows: Array<Record<string, unknown>> }
  >();
  const anchorRows = (rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
    rows.map((row, i) => ({ ...row, __row_id: row.__row_id ?? `hash:seed-${i + 1}` }));
  for (const [id, data] of Object.entries(options.datasetRows ?? {})) {
    rowsStore.set(id, { columns: data.columns, rows: anchorRows(data.rows) });
  }
  const uploads = new Map<string, UploadPreview>();
  const connectors = new Map<string, Connector>();
  for (const connector of options.connectors ?? []) {
    connectors.set(connector.id, { ...connector });
  }
  const corrections = new Map<string, Correction[]>();
  const keysStore = new Map<
    string,
    {
      id: string;
      customer_id?: string;
      label: string;
      fingerprint: string;
      dataset_ids: string[];
      status: string;
      created_at: string;
      revoked_at: string | null;
      last_used_at: string | null;
    }
  >();
  const syncs = new Map<string, SyncRecord[]>();
  // ── 需求单假后端状态（我的需求 / 提交表单）──
  const demandsStore = new Map<number, CustomerDemand>();
  let nextDemandId = 1;
  for (const demand of options.demands ?? []) {
    demandsStore.set(demand.id, { ...demand });
    nextDemandId = Math.max(nextDemandId, demand.id + 1);
  }
  let nextUploadSeq = 1;
  let nextCorrectionId = 1;
  let nextTokenSeq = 1;
  // ── 源包假后端状态（wire-source-packs）：订阅按 Bearer 客户隔离 ──
  const packsStore = new Map<string, FakePackSeed>();
  for (const pack of options.packs ?? []) packsStore.set(pack.id, pack);
  const packSubscriptions = new Map<string, string[]>();
  if (options.packSubscriptions?.length) {
    packSubscriptions.set("demo-customer", [...options.packSubscriptions]);
  }

  // ── 定时刷新调度假后端状态（wire-refresh-scheduler 4.1）：带 customer_id
  //    的种子仅同客户可见；创建校验语义对齐 api（类型/地板/配额）。──
  type StoredSchedule = RefreshSchedule & { customer_id?: string };
  const schedulesStore = new Map<number, StoredSchedule>();
  let nextScheduleId = 1;
  for (const seed of options.refreshSchedules ?? []) {
    schedulesStore.set(seed.id, { ...seed });
    nextScheduleId = Math.max(nextScheduleId, seed.id + 1);
  }

  function addRefreshSchedule(seed: StoredSchedule): void {
    schedulesStore.set(seed.id, { ...seed });
    nextScheduleId = Math.max(nextScheduleId, seed.id + 1);
  }

  function addDataset(dataset: Dataset): void {
    datasets.set(dataset.id, dataset);
    while (datasets.has(`ds-${nextDatasetSeq}`)) nextDatasetSeq += 1;
  }

  function addConnector(connector: Connector): void {
    connectors.set(connector.id, connector);
  }

  function addRows(
    datasetId: string,
    columns: DatasetColumn[],
    rows: Array<Record<string, unknown>>,
  ): void {
    rowsStore.set(datasetId, { columns, rows: anchorRows(rows) });
  }

  function addCorrection(correction: Correction): void {
    const list = corrections.get(correction.dataset_id) ?? [];
    list.push(correction);
    corrections.set(correction.dataset_id, list);
    nextCorrectionId = Math.max(nextCorrectionId, correction.id + 1);
  }

  function addSync(sync: SyncRecord): void {
    const list = syncs.get(sync.dataset_id) ?? [];
    list.push(sync);
    syncs.set(sync.dataset_id, list);
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

  // ── 产物生命周期假后端状态（wire-artifacts-persistence）──
  interface StoredArtifactVersion {
    version: number;
    spec: Record<string, unknown>;
    operator: string | null;
    created_at: string;
  }

  interface StoredLifecycleArtifact {
    id: number;
    customer_id?: string;
    kind: string;
    title: string;
    status: ArtifactStatus;
    version: number;
    origin_conversation_id: number | null;
    status_history: Array<{
      status: string;
      at: string;
      by: string;
      note: string | null;
    }>;
    created_at: string;
    updated_at: string;
    versions: StoredArtifactVersion[];
  }

  const lifecycleArtifacts = new Map<number, StoredLifecycleArtifact>();
  let nextLifecycleArtifactId = 1;

  function addLifecycleArtifact(seed: LifecycleArtifactSeed): void {
    const specList = seed.versions ?? [{ spec: seed.spec ?? {} }];
    const versions: StoredArtifactVersion[] = specList.map((entry, i) => ({
      version: i + 1,
      spec: entry.spec,
      operator: entry.operator ?? `console:demo-customer`,
      created_at: entry.created_at ?? `2026-10-04T09:${String(10 + i).padStart(2, "0")}:00`,
    }));
    const status = seed.status ?? "draft";
    lifecycleArtifacts.set(seed.id, {
      id: seed.id,
      customer_id: seed.customer_id,
      kind: seed.kind,
      title: seed.title,
      status,
      version: seed.version ?? versions.length,
      origin_conversation_id: seed.origin_conversation_id ?? null,
      status_history: [
        { status, at: "2026-10-04T09:00:00", by: "console:demo-customer", note: "seed" },
      ],
      created_at: seed.created_at ?? "2026-10-04T09:00:00",
      updated_at: seed.updated_at ?? "2026-10-04T09:30:00",
      versions,
    });
    nextLifecycleArtifactId = Math.max(nextLifecycleArtifactId, seed.id + 1);
  }

  /** 生命周期产物当前 spec（最新版本行）。 */
  function currentLifecycleSpec(artifact: StoredLifecycleArtifact): Record<string, unknown> {
    const row = artifact.versions.find((v) => v.version === artifact.version);
    return row?.spec ?? {};
  }

  function lifecycleDetail(artifact: StoredLifecycleArtifact): unknown {
    return {
      id: artifact.id,
      customer_id: artifact.customer_id ?? "demo-customer",
      kind: artifact.kind,
      title: artifact.title,
      status: artifact.status,
      version: artifact.version,
      origin_conversation_id: artifact.origin_conversation_id,
      created_at: artifact.created_at,
      updated_at: artifact.updated_at,
      spec: currentLifecycleSpec(artifact),
      status_history: artifact.status_history,
    };
  }

  /** 本客户可见的生命周期产物（未钉 customer_id 的种子对任何登录客户可见）。 */
  function ownLifecycleArtifact(
    id: number,
    customerId: string,
  ): StoredLifecycleArtifact | undefined {
    const artifact = lifecycleArtifacts.get(id);
    if (!artifact) return undefined;
    return artifact.customer_id && artifact.customer_id !== customerId
      ? undefined
      : artifact;
  }

  const calls: FetchCall[] = [];

  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit): Promise<FakeResponse> => {
    const url = new URL(String(input), "http://console.test");
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = headersOf(init);
    const rawBody = init?.body;
    const isForm = typeof FormData !== "undefined" && rawBody instanceof FormData;
    calls.push({
      method,
      url,
      headers,
      body: typeof rawBody === "string" ? JSON.parse(rawBody) : undefined,
      formData: isForm ? rawBody : undefined,
    });

    const path = url.pathname;

    // ── 控制台登录/会话/用量（wire-self-serve-launch 4.4 / 6.2 契约）──
    if (path === "/api/console/auth/config" && method === "GET") {
      if (options.failAuthConfigStatus) {
        return Promise.resolve(
          jsonResponse(
            { detail: `auth config ${options.failAuthConfigStatus}` },
            options.failAuthConfigStatus,
          ),
        );
      }
      return Promise.resolve(
        jsonResponse(
          options.authConfig ?? {
            configured: true,
            issuer: "https://auth.test/oidc",
            client_id: "test-client",
            scopes: ["openid", "profile", "email", "roles", "offline_access"],
            organization_required: false,
          },
        ),
      );
    }
    if (path === "/api/console/session" && method === "POST") {
      if (options.sessionFailReason) {
        return Promise.resolve(
          jsonResponse(
            { status: "failed", reason: options.sessionFailReason },
            502,
          ),
        );
      }
      return Promise.resolve(
        jsonResponse({
          status: "ready",
          customer: {
            id: 1,
            name: options.customerName ?? "演示客户",
            plan_code: options.planCode ?? "basic",
          },
          key_once: options.keyOnce ?? null,
        }),
      );
    }

    // ── 连接器下载清单（wire-connector-distribution 3.1：公开端点，置于
    //    Bearer 校验之前——语义对齐 api 侧 downloads 路由；缺省 404 即
    //    「FD_WIRE_DOWNLOADS_DIR 未配置」诚实降级态）──
    if (path === "/api/v1/downloads/connector/manifest.json" && method === "GET") {
      if (options.failManifestStatus) {
        return Promise.resolve(
          jsonResponse(
            { detail: `downloads ${options.failManifestStatus}` },
            options.failManifestStatus,
          ),
        );
      }
      if (!options.connectorManifest) {
        return Promise.resolve(
          jsonResponse(
            { detail: "连接器下载目录未配置（FD_WIRE_DOWNLOADS_DIR 为空）" },
            404,
          ),
        );
      }
      return Promise.resolve(jsonResponse(options.connectorManifest));
    }

    // ── 源包公开面（wire-source-packs 2.1：列表/详情匿名可读，置于 Bearer
    //    校验之前；subscriptions 需登录，先于 /{id} 详情正则匹配以免撞名）──
    if (path === "/api/v1/packs" && method === "GET") {
      if (options.failPacksStatus) {
        return Promise.resolve(
          jsonResponse({ detail: `packs ${options.failPacksStatus}` }, options.failPacksStatus),
        );
      }
      return Promise.resolve(
        jsonResponse(
          [...packsStore.values()].map((pack) => ({
            id: pack.id,
            name_zh: pack.name_zh,
            name_en: pack.name_en,
            desc: pack.desc,
            indicator_count: pack.indicators.length,
          })),
        ),
      );
    }
    if (path === "/api/v1/packs/subscriptions" && method === "GET") {
      const bearerSub = subOfBearer(headers);
      if (!bearerSub) {
        return Promise.resolve(
          jsonResponse({ detail: "缺少 Authorization: Bearer <ID token>（登录会话）" }, 401),
        );
      }
      return Promise.resolve(jsonResponse([...(packSubscriptions.get(bearerSub) ?? [])]));
    }
    const packDetailMatch = path.match(/^\/api\/v1\/packs\/([^/]+)$/);
    if (packDetailMatch && method === "GET") {
      if (options.failPacksStatus) {
        return Promise.resolve(
          jsonResponse({ detail: `packs ${options.failPacksStatus}` }, options.failPacksStatus),
        );
      }
      const pack = packsStore.get(decodeURIComponent(packDetailMatch[1]!));
      if (!pack) {
        return Promise.resolve(jsonResponse({ detail: "pack not found" }, 404));
      }
      const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
      const pageSize = Math.max(
        1,
        Number(url.searchParams.get("page_size") ?? "20") || 20,
      );
      const start = (page - 1) * pageSize;
      return Promise.resolve(
        jsonResponse({
          id: pack.id,
          name_zh: pack.name_zh,
          name_en: pack.name_en,
          desc: pack.desc,
          items: pack.indicators.slice(start, start + pageSize),
          page,
          page_size: pageSize,
          total: pack.indicators.length,
        }),
      );
    }

    const customerId = subOfBearer(headers);
    if (!customerId) {
      return Promise.resolve(
        jsonResponse(
          { detail: "缺少 Authorization: Bearer <ID token>（登录会话）" },
          401,
        ),
      );
    }

    // ── 源包订阅面（wire-source-packs 2.2：登录；重复订阅/退订幂等 200；
    //    未知包 404；按 Bearer 客户隔离）──
    const packSubMatch = path.match(/^\/api\/v1\/packs\/([^/]+)\/(subscribe|unsubscribe)$/);
    if (packSubMatch) {
      if (options.failPackSubscribeStatus) {
        return Promise.resolve(
          jsonResponse(
            { detail: `pack subscribe ${options.failPackSubscribeStatus}` },
            options.failPackSubscribeStatus,
          ),
        );
      }
      const packId = decodeURIComponent(packSubMatch[1]!);
      if (!packsStore.has(packId)) {
        return Promise.resolve(jsonResponse({ detail: "pack not found" }, 404));
      }
      const subscribing = packSubMatch[2] === "subscribe";
      const mine = [...(packSubscriptions.get(customerId) ?? [])];
      const at = mine.indexOf(packId);
      if (subscribing && at < 0) mine.push(packId);
      if (!subscribing && at >= 0) mine.splice(at, 1);
      packSubscriptions.set(customerId, mine);
      return Promise.resolve(
        jsonResponse({ pack_id: packId, subscribed: subscribing }),
      );
    }


    if (path === "/api/console/usage" && method === "GET") {
      if (options.failUsageStatus) {
        return Promise.resolve(
          jsonResponse(
            { detail: `usage ${options.failUsageStatus}` },
            options.failUsageStatus,
          ),
        );
      }
      const planCode = options.planCode ?? "basic";
      return Promise.resolve(
        jsonResponse(
          options.usage ?? {
            period: "2026-10",
            plan_code: planCode,
            included_lines: 100_000,
            used_lines: 123,
            remaining_lines: 99_877,
          },
        ),
      );
    }

    // ── 需求单客户面（wire-ux-consolidation 3.2/4.1/4.3：POST/GET
    //    /api/v1/demands，Bearer 身份隔离——种子带 customer_id 的仅同客户可见）──
    if (path === "/api/v1/demands" && method === "GET") {
      const mine = [...demandsStore.values()]
        .filter((d) => d.customer_id === customerId)
        .sort((a, b) => b.id - a.id);
      return Promise.resolve(jsonResponse(mine));
    }
    if (path === "/api/v1/demands" && method === "POST") {
      if (options.failDemandCreateStatus) {
        return Promise.resolve(
          jsonResponse(
            {
              detail:
                options.failDemandCreateDetail ??
                `demand create ${options.failDemandCreateStatus}`,
            },
            options.failDemandCreateStatus,
          ),
        );
      }
      const payload = (calls[calls.length - 1]!.body ?? {}) as {
        description?: string;
        contact_email?: string;
        company?: string;
        indicator_code?: string;
        source_urls?: unknown;
        public_data_asserted?: unknown;
      };
      if (!payload.description || !payload.description.trim()) {
        return Promise.resolve(
          jsonResponse({ detail: "需求描述不能为空（或全为空白字符）" }, 422),
        );
      }
      if (!payload.contact_email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.contact_email)) {
        return Promise.resolve(
          jsonResponse({ detail: "联系邮箱格式不合法（应为 name@domain.tld 形态）" }, 422),
        );
      }
      // wire-demand-generation-orchestration 冻结契约镜像：source_urls ≥1 条
      // http(s) 公开地址（拒内嵌账密）、public_data_asserted 必须 true——
      // 422 detail 为 FastAPI 标准错误数组（非法条目按索引定位 loc）。
      const sourceUrls = Array.isArray(payload.source_urls)
        ? payload.source_urls.filter((u): u is string => typeof u === "string")
        : [];
      const detailItems: ApiDetailItem[] = [];
      if (sourceUrls.length === 0) {
        detailItems.push({
          type: "too_short",
          loc: ["body", "source_urls"],
          msg: "List should have at least 1 item after validation, not 0",
        });
      }
      sourceUrls.forEach((url, index) => {
        let parsed: URL | null = null;
        try {
          parsed = new URL(url);
        } catch {
          parsed = null;
        }
        const embeddedCredentials =
          /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+:[^/@\s]+@/i.test(url);
        if (
          !parsed ||
          (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
          embeddedCredentials
        ) {
          detailItems.push({
            type: "url_scheme",
            loc: ["body", "source_urls", index],
            msg: "Input should be a valid http(s) URL without embedded credentials",
          });
        }
      });
      if (payload.public_data_asserted !== true) {
        detailItems.push({
          type: "greater_than",
          loc: ["body", "public_data_asserted"],
          msg: "Input should be true",
        });
      }
      if (detailItems.length > 0) {
        return Promise.resolve(jsonResponse({ detail: detailItems }, 422));
      }
      const id = nextDemandId++;
      const nowIso = "2026-10-10T08:00:00";
      const oneLine = payload.description.replace(/\s+/g, " ").trim();
      const created: CustomerDemand = {
        id,
        code: `DE-20261010-${String(id).padStart(2, "0")}`,
        customer_id: customerId,
        title: oneLine.slice(0, 200),
        intent: payload.description,
        contact_email: payload.contact_email,
        company: payload.company ?? null,
        status: "submitted",
        status_history: [
          {
            status: "submitted",
            at: "2026-10-10T08:00:00+00:00",
            by: `customer:${customerId}`,
            note: "需求单提交" + (payload.indicator_code ? `（目录锚点：${payload.indicator_code}）` : ""),
          },
        ],
        rejection_reason: null,
        created_at: nowIso,
        updated_at: nowIso,
      };
      demandsStore.set(id, created);
      return Promise.resolve(jsonResponse(created, 201));
    }

    /** 本客户可见性：带 customer_id 的种子仅同客户可见（跨企业 404）。 */
    const ownDataset = (id: string): Dataset | undefined => {
      const dataset = datasets.get(id);
      if (!dataset) return undefined;
      return dataset.customer_id && dataset.customer_id !== customerId
        ? undefined
        : dataset;
    };

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

    // ── 产物生命周期（wire-artifacts-persistence）：列表/详情/PUT 版本化/
    //    版本历史/发布/归档/恢复/草稿导入——语义对齐 api 仓 artifacts 路由 ──
    let lifecycleTick = 0;
    const lifecycleNow = () => `2026-10-11T0${8 + (lifecycleTick++ % 4)}:00:00`;

    if (path === "/api/v1/artifacts/from-draft" && method === "POST") {
      const payload = (calls[calls.length - 1]!.body ?? {}) as {
        conversation_id?: number;
        draft_id?: number;
      };
      const stored = store.get(payload.conversation_id ?? -1);
      const draft = stored?.artifacts.find((d) => d.id === payload.draft_id);
      if (!stored || stored.meta.customer_id !== customerId || !draft) {
        return Promise.resolve(
          jsonResponse(
            { detail: `conversation ${payload.conversation_id} 无草稿 ${payload.draft_id}` },
            404,
          ),
        );
      }
      const id = nextLifecycleArtifactId++;
      const created: StoredLifecycleArtifact = {
        id,
        customer_id: customerId,
        kind: draft.kind,
        title: String(draft.spec.title ?? draft.kind),
        status: "draft",
        version: 1,
        origin_conversation_id: stored.meta.id,
        status_history: [
          {
            status: "draft",
            at: lifecycleNow(),
            by: `console:${customerId}`,
            note: `从会话 ${stored.meta.id} 草稿导入`,
          },
        ],
        created_at: lifecycleNow(),
        updated_at: lifecycleNow(),
        versions: [
          { version: 1, spec: draft.spec, operator: `console:${customerId}`, created_at: lifecycleNow() },
        ],
      };
      lifecycleArtifacts.set(id, created);
      return Promise.resolve(jsonResponse(lifecycleDetail(created), 201));
    }

    // ── 空白建板（wire-dashboard-blank-create 1.2）：POST /api/v1/artifacts
    //    {kind:"dashboard", title} → 201 ArtifactDetail（draft v1，spec = 最小
    //    空板 {title, spec:{title, panels:[]}}）——kind 白名单 v0 仅 dashboard、
    //    title 非空，非法 422 带 detail，语义对齐 api 仓建板路由。 ──
    if (path === "/api/v1/artifacts" && method === "POST") {
      if (options.failArtifactCreateStatus) {
        return Promise.resolve(
          jsonResponse(
            {
              detail:
                options.failArtifactCreateDetail ??
                `artifact create ${options.failArtifactCreateStatus}`,
            },
            options.failArtifactCreateStatus,
          ),
        );
      }
      const payload = (calls[calls.length - 1]!.body ?? {}) as {
        kind?: string;
        title?: string;
      };
      if (payload.kind !== "dashboard") {
        return Promise.resolve(
          jsonResponse(
            {
              detail:
                `kind 白名单仅支持 dashboard（当前 ${String(payload.kind)}）` +
                "——其他类型仍由 AI 草稿转正产生",
            },
            422,
          ),
        );
      }
      const title = typeof payload.title === "string" ? payload.title.trim() : "";
      if (!title) {
        return Promise.resolve(
          jsonResponse({ detail: "title 不能为空（或全为空白字符）" }, 422),
        );
      }
      const id = nextLifecycleArtifactId++;
      const blankSpec = { title, spec: { title, panels: [] } };
      const created: StoredLifecycleArtifact = {
        id,
        customer_id: customerId,
        kind: "dashboard",
        title,
        status: "draft",
        version: 1,
        origin_conversation_id: null,
        status_history: [
          {
            status: "draft",
            at: lifecycleNow(),
            by: `console:${customerId}`,
            note: "空白新建",
          },
        ],
        created_at: lifecycleNow(),
        updated_at: lifecycleNow(),
        versions: [
          { version: 1, spec: blankSpec, operator: `console:${customerId}`, created_at: lifecycleNow() },
        ],
      };
      lifecycleArtifacts.set(id, created);
      return Promise.resolve(jsonResponse(lifecycleDetail(created), 201));
    }

    if (path === "/api/v1/artifacts" && method === "GET") {
      const kind = url.searchParams.get("kind");
      const status = url.searchParams.get("status");
      const mine = [...lifecycleArtifacts.values()]
        .filter((a) => !a.customer_id || a.customer_id === customerId)
        .filter((a) => !kind || a.kind === kind)
        .filter((a) => !status || a.status === status)
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : b.id - a.id));
      return Promise.resolve(
        jsonResponse(
          mine.map(({ versions: _v, status_history: _h, ...summary }) => summary),
        ),
      );
    }

    match = path.match(/^\/api\/v1\/artifacts\/(\d+)$/);
    if (match) {
      const artifact = ownLifecycleArtifact(Number(match[1]), customerId);
      if (!artifact) {
        return Promise.resolve(jsonResponse({ detail: "artifact not found" }, 404));
      }
      if (method === "GET") {
        return Promise.resolve(jsonResponse(lifecycleDetail(artifact)));
      }
      if (method === "PUT") {
        if (artifact.status === "archived") {
          return Promise.resolve(
            jsonResponse(
              {
                detail:
                  `产物 ${artifact.id} 已归档（archived），不可编辑——请先恢复（restore）为草稿再修改。`,
              },
              409,
            ),
          );
        }
        const payload = (calls[calls.length - 1]!.body ?? {}) as { spec?: unknown };
        const spec = payload.spec as Record<string, unknown> | undefined;
        const title = spec?.title;
        const inner = spec?.spec;
        if (!spec || typeof title !== "string" || !title.trim()) {
          return Promise.resolve(
            jsonResponse({ detail: "spec 缺少非空 title" }, 422),
          );
        }
        if (typeof inner !== "object" || inner === null || Object.keys(inner).length === 0) {
          return Promise.resolve(
            jsonResponse({ detail: "spec.spec 必须是非空 JSON 对象" }, 422),
          );
        }
        artifact.version += 1;
        artifact.versions.push({
          version: artifact.version,
          spec,
          operator: `console:${customerId}`,
          created_at: lifecycleNow(),
        });
        artifact.title = title.trim();
        artifact.updated_at = lifecycleNow();
        return Promise.resolve(jsonResponse(lifecycleDetail(artifact)));
      }
    }

    match = path.match(/^\/api\/v1\/artifacts\/(\d+)\/versions$/);
    if (match && method === "GET") {
      const artifact = ownLifecycleArtifact(Number(match[1]), customerId);
      if (!artifact) {
        return Promise.resolve(jsonResponse({ detail: "artifact not found" }, 404));
      }
      const rows = [...artifact.versions]
        .sort((a, b) => b.version - a.version)
        .map(({ spec: _s, ...summary }) => summary);
      return Promise.resolve(jsonResponse(rows));
    }

    match = path.match(/^\/api\/v1\/artifacts\/(\d+)\/versions\/(\d+)$/);
    if (match && method === "GET") {
      const artifact = ownLifecycleArtifact(Number(match[1]), customerId);
      const row = artifact?.versions.find((v) => v.version === Number(match![2]));
      if (!artifact || !row) {
        return Promise.resolve(jsonResponse({ detail: "version not found" }, 404));
      }
      return Promise.resolve(jsonResponse(row));
    }

    match = path.match(/^\/api\/v1\/artifacts\/(\d+)\/(publish|archive|restore)$/);
    if (match && method === "POST") {
      const artifact = ownLifecycleArtifact(Number(match[1]), customerId);
      if (!artifact) {
        return Promise.resolve(jsonResponse({ detail: "artifact not found" }, 404));
      }
      const action = match[2] as "publish" | "archive" | "restore";
      const transitions: Record<string, Partial<Record<typeof action, ArtifactStatus>>> = {
        draft: { publish: "published", archive: "archived" },
        published: { archive: "archived" },
        archived: { restore: "draft" },
      };
      const target = transitions[artifact.status]?.[action];
      if (!target) {
        const hints: Record<string, string> = {
          publish:
            "合法路径：draft --publish--> published（已发布或已归档的产物请先恢复为草稿）",
          archive: "合法路径：draft/published --archive--> archived",
          restore: "合法路径：archived --restore--> draft（仅归档产物可恢复）",
        };
        return Promise.resolve(
          jsonResponse(
            {
              detail:
                `产物 ${artifact.id} 当前状态 ${artifact.status} 不允许 ${action}——` +
                hints[action],
            },
            409,
          ),
        );
      }
      artifact.status = target;
      artifact.updated_at = lifecycleNow();
      artifact.status_history.push({
        status: target,
        at: lifecycleNow(),
        by: `console:${customerId}`,
        note: `${action} → ${target}`,
      });
      return Promise.resolve(jsonResponse(lifecycleDetail(artifact)));
    }

    // ── 我的数据：数据集列表 / 建档 / 详情 / 预览 ──
    if (path === "/api/v1/datasets" && method === "GET") {
      const mine = [...datasets.values()].filter(
        (d) => !d.customer_id || d.customer_id === customerId,
      );
      return Promise.resolve(jsonResponse(mine));
    }

    if (path === "/api/v1/datasets" && method === "POST") {
      if (options.failCreateDatasetStatus) {
        return Promise.resolve(
          jsonResponse(
            {
              detail:
                options.failCreateDatasetDetail ??
                `create dataset ${options.failCreateDatasetStatus}`,
            },
            options.failCreateDatasetStatus,
          ),
        );
      }
      const payload = (calls[calls.length - 1]!.body ?? {}) as {
        name?: string;
        source?: {
          kind?: string;
          upload_id?: string;
          connector_id?: string;
          source_name?: string;
          source_ref?: string;
          schedule_cron?: string | null;
        };
      };
      const source = payload.source ?? {};
      const upload = source.upload_id ? uploads.get(source.upload_id) : undefined;
      const nowIso = "2026-10-05T12:00:00";
      const id = `ds-${nextDatasetSeq++}`;
      const free = (options.planCode ?? "basic") === "free";
      const dataset: Dataset = {
        id,
        key: `ds_${id.replace(/-/g, "_")}`,
        name: payload.name ?? "未命名",
        source_kind: source.kind === "connector" ? "connector" : "upload",
        connector_id: source.connector_id ?? null,
        source_name: source.source_name,
        source_ref: source.source_ref ?? null,
        columns: upload?.columns ?? [],
        row_count: upload?.row_count ?? 0,
        size_bytes: upload ? upload.row_count * 24 : 0,
        sync_cron: source.schedule_cron ?? null,
        sync_status: "ok",
        paused_reason: null,
        created_at: nowIso,
        updated_at: nowIso,
        customer_id: customerId,
      };
      // 免费档建集落 api 层（wire-free-tier-data-gate D1），响应带 storage_tier
      // 供列表徽标（组件容错读取）；付费档不带——现状响应零变化。
      if (free) (dataset as DatasetWithTier).storage_tier = "api";
      datasets.set(id, dataset);
      return Promise.resolve(jsonResponse(dataset, 201));
    }

    // 免费档配额端点（wire-free-tier-data-gate 4.1）：注意必须先于下方
    // /api/v1/datasets/:id 正则命中（否则 "quota" 会被当成数据集 id）。
    if (path === "/api/v1/datasets/quota" && method === "GET") {
      if (options.failQuotaStatus) {
        return Promise.resolve(
          jsonResponse(
            { detail: `dataset quota ${options.failQuotaStatus}` },
            options.failQuotaStatus,
          ),
        );
      }
      const used = [...datasets.values()].filter(
        (d) => !d.customer_id || d.customer_id === customerId,
      ).length;
      return Promise.resolve(
        jsonResponse(
          options.datasetQuota ?? {
            plan_code: options.planCode ?? "basic",
            used_datasets: used,
            max_datasets: 3,
            max_rows_per_dataset: 10_000,
          },
        ),
      );
    }

    if (path === "/api/v1/datasets/uploads" && method === "POST") {
      if (options.failUploadStatus) {
        return Promise.resolve(
          jsonResponse(
            { detail: options.failUploadDetail ?? `upload failed ${options.failUploadStatus}` },
            options.failUploadStatus,
          ),
        );
      }
      const call = calls[calls.length - 1]!;
      const file = call.formData?.get("file");
      const filename =
        typeof file === "string" ? file : file?.name ?? "upload.csv";
      const preview: UploadPreview = {
        upload_id: `up-${nextUploadSeq++}`,
        filename,
        columns:
          options.uploadPreview?.columns ?? [
            { name: "id", type: "INTEGER" },
            { name: "amount", type: "REAL" },
          ],
        row_count: options.uploadPreview?.row_count ?? 120,
        within_limit: options.uploadPreview?.within_limit ?? true,
        sample_rows:
          options.uploadPreview?.sample_rows ?? [{ id: 1, amount: 12.5 }],
      };
      uploads.set(preview.upload_id, preview);
      return Promise.resolve(jsonResponse(preview, 201));
    }

    match = path.match(/^\/api\/v1\/datasets\/([^/]+)$/);
    if (match) {
      const dataset = ownDataset(match[1]);
      if (!dataset) {
        return Promise.resolve(jsonResponse({ detail: "dataset not found" }, 404));
      }
      if (method === "GET") return Promise.resolve(jsonResponse(dataset));
      if (method === "DELETE") {
        datasets.delete(dataset.id);
        return Promise.resolve(jsonResponse({ deleted: true }));
      }
    }

    match = path.match(/^\/api\/v1\/datasets\/([^/]+)\/rows$/);
    if (match && method === "GET") {
      const dataset = ownDataset(match[1]);
      if (!dataset) {
        return Promise.resolve(jsonResponse({ detail: "dataset not found" }, 404));
      }
      const data = rowsStore.get(dataset.id) ?? { columns: dataset.columns, rows: [] };
      const rawPage = Number(url.searchParams.get("page") ?? "1");
      const rawSize = Number(url.searchParams.get("page_size") ?? "50");
      const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
      const pageSize = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 50;
      const start = (page - 1) * pageSize;
      return Promise.resolve(
        jsonResponse({
          columns: data.columns,
          rows: data.rows.slice(start, start + pageSize),
          total: data.rows.length,
        }),
      );
    }

    // ── 数据面（wire-customer-data-engine）：结构化查询 + key 三端点 ──
    match = path.match(/^\/api\/v1\/datasets\/([^/]+)\/query$/);
    if (match && method === "POST") {
      const dataset = ownDataset(match[1]);
      if (!dataset) {
        return Promise.resolve(jsonResponse({ detail: "dataset not found" }, 404));
      }
      const body = (calls[calls.length - 1]!.body ?? {}) as {
        filters?: Array<{ column: string; op: string; value?: unknown }>;
        sort?: Array<{ column: string; dir: string }>;
        limit?: number;
        offset?: number;
      };
      const data = rowsStore.get(dataset.id) ?? { columns: dataset.columns, rows: [] };
      let out = [...data.rows];
      for (const f of body.filters ?? []) {
        out = out.filter((row) => {
          const cell = row[f.column];
          const value = f.value;
          switch (f.op) {
            case "eq": return cell === value;
            case "ne": return cell !== value;
            case "gt": return Number(cell) > Number(value);
            case "lt": return Number(cell) < Number(value);
            case "like": return String(cell ?? "").includes(String(value ?? ""));
            case "isnull": return cell == null;
            case "notnull": return cell != null;
            default: return true;
          }
        });
      }
      for (const s of [...(body.sort ?? [])].reverse()) {
        out.sort((a, b) => {
          const av = a[s.column];
          const bv = b[s.column];
          const cmp = av === bv ? 0 : av == null ? -1 : bv == null ? 1 : String(av) < String(bv) ? -1 : 1;
          return s.dir === "desc" ? -cmp : cmp;
        });
      }
      const limit = body.limit ?? 50;
      const offset = body.offset ?? 0;
      return Promise.resolve(
        jsonResponse({
          columns: data.columns,
          rows: out.slice(offset, offset + limit),
          total: out.length,
          limit,
          offset,
          truncated: out.length > offset + Math.min(out.length - offset, limit),
        }),
      );
    }

    if (path === "/api/v1/data-plane-keys" && method === "GET") {
      return Promise.resolve(
        jsonResponse(
          [...keysStore.values()].filter((k) => !k.customer_id || k.customer_id === customerId),
        ),
      );
    }
    if (path === "/api/v1/data-plane-keys" && method === "POST") {
      const body = (calls[calls.length - 1]!.body ?? {}) as {
        label?: string;
        dataset_ids?: string[];
      };
      const id = `k${keysStore.size + 1}`;
      const fingerprint = `fp${id.padStart(12, "0")}`;
      const created = {
        id,
        customer_id: customerId,
        label: body.label ?? "unlabeled",
        fingerprint,
        dataset_ids: body.dataset_ids ?? [],
        status: "active",
        created_at: "2026-10-10T00:00:00Z",
        revoked_at: null,
        last_used_at: null,
      };
      keysStore.set(id, created);
      return Promise.resolve(
        jsonResponse({ ...created, key: `wdk-test-${id}` }, 201),
      );
    }
    match = path.match(/^\/api\/v1\/data-plane-keys\/([^/]+)$/);
    if (match && method === "DELETE") {
      const row = keysStore.get(match[1]);
      if (!row) {
        return Promise.resolve(jsonResponse({ detail: "key not found" }, 404));
      }
      row.status = "revoked";
      row.revoked_at = "2026-10-10T01:00:00Z";
      return Promise.resolve(jsonResponse(row));
    }

    match = path.match(/^\/api\/v1\/datasets\/([^/]+)\/corrections$/);
    if (match) {
      const dataset = ownDataset(match[1]);
      if (!dataset) {
        return Promise.resolve(jsonResponse({ detail: "dataset not found" }, 404));
      }
      if (method === "GET") {
        // 真实 API 回 {corrections:[…]} 信封（与生产同形——曾因假后端回
        // 裸数组掩盖客户端解包缺失，生产白屏，E2E 抓出后修正）。
        return Promise.resolve(
          jsonResponse({ corrections: corrections.get(dataset.id) ?? [] }),
        );
      }
      if (method === "POST") {
        const payload = (calls[calls.length - 1]!.body ?? {}) as CorrectionInput;
        const id = nextCorrectionId++;
        const correction: Correction = {
          id,
          dataset_id: dataset.id,
          op: payload.op as CorrectionOp,
          row_id: "row_id" in payload ? payload.row_id : null,
          column: payload.op === "update" ? payload.column : null,
          value: payload.op === "update" ? payload.value : null,
          values: payload.op === "insert" ? payload.values : null,
          actor: "console-test",
          created_at: "2026-10-05T12:30:00",
          reverted_at: null,
          dangling_at: null,
          dangling_reason: null,
        };
        addCorrection(correction);
        // 假后端同步应用修正，便于断言预览刷新后的结果。
        const data = rowsStore.get(dataset.id);
        if (data) {
          if (payload.op === "update") {
            data.rows = data.rows.map((row) =>
              row.__row_id === payload.row_id
                ? { ...row, [payload.column]: payload.value }
                : row,
            );
          } else if (payload.op === "delete") {
            data.rows = data.rows.filter((row) => row.__row_id !== payload.row_id);
          } else {
            data.rows = [...data.rows, { ...payload.values, __row_id: `ins:${id}` }];
          }
        }
        return Promise.resolve(jsonResponse({ correction_id: id }, 201));
      }
    }

    match = path.match(/^\/api\/v1\/datasets\/([^/]+)\/corrections\/(\d+)\/revert$/);
    if (match && method === "POST") {
      const dataset = ownDataset(match[1]);
      if (!dataset) {
        return Promise.resolve(jsonResponse({ detail: "dataset not found" }, 404));
      }
      const list = corrections.get(dataset.id) ?? [];
      const correction = list.find((c) => c.id === Number(match![2]));
      if (!correction) {
        return Promise.resolve(jsonResponse({ detail: "correction not found" }, 404));
      }
      correction.reverted_at = "2026-10-05T13:00:00";
      return Promise.resolve(jsonResponse({ reverted: true }));
    }

    match = path.match(/^\/api\/v1\/datasets\/([^/]+)\/syncs$/);
    if (match && method === "GET") {
      const dataset = ownDataset(match[1]);
      if (!dataset) {
        return Promise.resolve(jsonResponse({ detail: "dataset not found" }, 404));
      }
      return Promise.resolve(jsonResponse(syncs.get(dataset.id) ?? []));
    }

    match = path.match(/^\/api\/v1\/datasets\/([^/]+)\/resume$/);
    if (match && method === "POST") {
      const dataset = ownDataset(match[1]);
      if (!dataset) {
        return Promise.resolve(jsonResponse({ detail: "dataset not found" }, 404));
      }
      const payload = (calls[calls.length - 1]!.body ?? {}) as {
        accept_columns?: string[];
      };
      for (const name of payload.accept_columns ?? []) {
        if (!dataset.columns.some((c) => c.name === name)) {
          dataset.columns = [...dataset.columns, { name, type: "TEXT" }];
        }
      }
      dataset.sync_status = "idle";
      dataset.paused_reason = null;
      dataset.updated_at = "2026-10-05T13:10:00";
      return Promise.resolve(jsonResponse(dataset));
    }

    // ── 我的数据：连接器（配对令牌 / 列表 / 吊销） ──
    if (path === "/api/v1/connectors/pairing-tokens" && method === "POST") {
      const ttl = options.pairingTokenTtlSeconds ?? 900;
      return Promise.resolve(
        jsonResponse(
          {
            token: `fwp_test_${nextTokenSeq++}`,
            expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
          },
          201,
        ),
      );
    }

    if (path === "/api/v1/connectors" && method === "GET") {
      const mine = [...connectors.values()].filter(
        (c) => !c.customer_id || c.customer_id === customerId,
      );
      return Promise.resolve(jsonResponse(mine));
    }

    match = path.match(/^\/api\/v1\/connectors\/([^/]+)$/);
    if (match && method === "DELETE") {
      const connector = connectors.get(match[1]);
      if (
        !connector ||
        (connector.customer_id && connector.customer_id !== customerId)
      ) {
        return Promise.resolve(jsonResponse({ detail: "connector not found" }, 404));
      }
      connector.revoked_at = "2026-10-05T13:20:00";
      return Promise.resolve(jsonResponse(connector));
    }

    // ── 定时刷新调度（wire-refresh-scheduler 4.1）：列表/建（类型+地板+配额
    //    校验）/删/暂停恢复——语义对齐 api 仓 schedules 路由（Bearer 客户隔离）──
    const ownSchedules = (): StoredSchedule[] =>
      [...schedulesStore.values()].filter(
        (s) => !s.customer_id || s.customer_id === customerId,
      );
    const scheduleRow = (row: StoredSchedule): RefreshSchedule => {
      const { customer_id: _c, ...out } = row;
      return out;
    };
    const scheduleBase = Date.parse("2026-10-11T08:00:00Z");

    if (path === "/api/v1/refresh-schedules" && method === "GET") {
      return Promise.resolve(jsonResponse(ownSchedules().map(scheduleRow)));
    }
    if (path === "/api/v1/refresh-schedules" && method === "POST") {
      if (options.failScheduleCreateStatus) {
        return Promise.resolve(
          jsonResponse(
            {
              detail:
                options.failScheduleCreateDetail ??
                `schedule create ${options.failScheduleCreateStatus}`,
            },
            options.failScheduleCreateStatus,
          ),
        );
      }
      const payload = (calls[calls.length - 1]!.body ?? {}) as {
        target_type?: string;
        target_id?: string;
        interval_minutes?: number;
      };
      // 类型校验：dataset 须 derived 来源、artifact 须 kind=dashboard（跨客户
      // 与失存目标一律 404——不泄露存在性）。
      let reject: { status: number; detail: string } | null = null;
      if (payload.target_type === "dataset") {
        const dataset = ownDataset(String(payload.target_id ?? ""));
        if (!dataset) {
          reject = { status: 404, detail: "dataset not found" };
        } else if (dataset.source_kind !== "derived") {
          reject = {
            status: 422,
            detail: "仅派生（derived）来源数据集可设定时刷新（上传/连接器来源走各自同步链路）",
          };
        }
      } else if (payload.target_type === "artifact") {
        const artifact = ownLifecycleArtifact(Number(payload.target_id), customerId);
        if (!artifact) {
          reject = { status: 404, detail: "artifact not found" };
        } else if (artifact.kind !== "dashboard") {
          reject = {
            status: 422,
            detail: "仅仪表盘（dashboard）产物可设定时刷新",
          };
        }
      } else {
        reject = {
          status: 422,
          detail: "target_type 必须是 dataset 或 artifact",
        };
      }
      // 间隔地板：dataset ≥60、artifact ≥360（AI 刷新耗 token，封无人值守成本）。
      const floor = payload.target_type === "artifact" ? 360 : 60;
      const minutes = payload.interval_minutes;
      if (
        !reject &&
        (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < floor)
      ) {
        reject = {
          status: 422,
          detail: `刷新间隔不能低于 ${floor} 分钟（当前 ${String(minutes)}）`,
        };
      }
      // 每客户配额（默认 10）。
      if (!reject && ownSchedules().length >= 10) {
        reject = { status: 422, detail: "定时刷新数量已达上限（10 个）" };
      }
      if (reject) {
        return Promise.resolve(jsonResponse({ detail: reject.detail }, reject.status));
      }
      const id = nextScheduleId++;
      const created: StoredSchedule = {
        id,
        customer_id: customerId,
        target_type: payload.target_type as StoredSchedule["target_type"],
        target_id: String(payload.target_id),
        interval_minutes: minutes!,
        next_run_at: new Date(scheduleBase + minutes! * 60_000)
          .toISOString()
          .slice(0, 19),
        paused: false,
        last_status: "pending",
        last_run_at: null,
        last_error: null,
        created_at: "2026-10-11T08:00:00",
      };
      schedulesStore.set(id, created);
      return Promise.resolve(jsonResponse(scheduleRow(created), 201));
    }
    match = path.match(/^\/api\/v1\/refresh-schedules\/(\d+)$/);
    if (match && method === "DELETE") {
      const row = schedulesStore.get(Number(match[1]));
      if (!row || (row.customer_id && row.customer_id !== customerId)) {
        return Promise.resolve(jsonResponse({ detail: "schedule not found" }, 404));
      }
      schedulesStore.delete(row.id);
      return Promise.resolve(jsonResponse(scheduleRow(row)));
    }
    match = path.match(/^\/api\/v1\/refresh-schedules\/(\d+)\/(pause|resume)$/);
    if (match && method === "POST") {
      const row = schedulesStore.get(Number(match[1]));
      if (!row || (row.customer_id && row.customer_id !== customerId)) {
        return Promise.resolve(jsonResponse({ detail: "schedule not found" }, 404));
      }
      row.paused = match[2] === "pause";
      return Promise.resolve(jsonResponse(scheduleRow(row)));
    }

    // ── 管线图（wire-transform-pipeline-view 2.2）：GET /api/v1/pipeline/graph
    //    ——语义对齐 api 仓组装：本客户数据集全量节点（storage_tier 容错读取、
    //    dataset 调度登记→schedule_cron）、derived 的 source_ref 解析父 key 成边
    //    （op 统一 derived）、BFS 深度（源=0）、环/孤儿边跳过计 anomalies、
    //    节点超 500 截断 truncated。pipelineGraph 覆盖时原样返回。──
    if (path === "/api/v1/pipeline/graph" && method === "GET") {
      if (options.failPipelineGraphStatus) {
        return Promise.resolve(
          jsonResponse(
            {
              detail:
                options.failPipelineGraphDetail ??
                `pipeline graph ${options.failPipelineGraphStatus}`,
            },
            options.failPipelineGraphStatus,
          ),
        );
      }
      if (options.pipelineGraph) {
        return Promise.resolve(jsonResponse(options.pipelineGraph));
      }
      const mine = [...datasets.values()].filter(
        (d) => !d.customer_id || d.customer_id === customerId,
      );
      const byKey = new Map(mine.map((d) => [d.key, d]));
      let anomalies = 0;
      const parentOf = new Map<string, string>();
      const edges: PipelineGraph["edges"] = [];
      for (const dataset of mine) {
        if (dataset.source_kind !== "derived") continue;
        const parent = dataset.source_ref ? byKey.get(dataset.source_ref) : undefined;
        if (!parent) {
          anomalies += 1; // 孤儿边：父 key 无对应行
          continue;
        }
        edges.push({
          from_dataset_id: parent.id,
          to_dataset_id: dataset.id,
          op: "derived",
        });
        parentOf.set(dataset.id, parent.id);
      }
      // 深度（源=0，派生按链深）；沿父链遇已访问节点即环 → 计 anomalies、按 0 层。
      const depthCache = new Map<string, number>();
      const depthOf = (id: string, seen: Set<string>): number => {
        const cached = depthCache.get(id);
        if (cached != null) return cached;
        const parent = parentOf.get(id);
        if (!parent) {
          depthCache.set(id, 0);
          return 0;
        }
        if (seen.has(id)) {
          anomalies += 1;
          depthCache.set(id, 0);
          return 0;
        }
        seen.add(id);
        const depth = depthOf(parent, seen) + 1;
        depthCache.set(id, depth);
        return depth;
      };
      const truncated = mine.length > 500;
      const kept = new Set(mine.slice(0, 500).map((d) => d.id));
      const nodes: PipelineGraph["nodes"] = mine
        .filter((d) => kept.has(d.id))
        .map((d) => {
          const scheduled = [...schedulesStore.values()].some(
            (s) =>
              (!s.customer_id || s.customer_id === customerId) &&
              s.target_type === "dataset" &&
              s.target_id === d.id,
          );
          return {
            dataset_id: d.id,
            key: d.key,
            name: d.name,
            source_kind: d.source_kind,
            storage_tier: (d as DatasetWithTier).storage_tier ?? null,
            row_count: d.row_count,
            updated_at: d.updated_at,
            depth: depthOf(d.id, new Set()),
            schedule_cron: scheduled ? "0 * * * *" : null,
          };
        });
      return Promise.resolve(
        jsonResponse({
          nodes,
          edges: edges.filter((e) => kept.has(e.from_dataset_id) && kept.has(e.to_dataset_id)),
          anomalies,
          truncated,
        }),
      );
    }

    return Promise.resolve(jsonResponse({ detail: "not found" }, 404));
  }) as unknown as typeof fetch;

  return {
    calls,
    fetchImpl,
    addMessage,
    addArtifact,
    addLifecycleArtifact,
    addDataset,
    addConnector,
    addRows,
    addCorrection,
    addSync,
    addRefreshSchedule,
    getDatasets: () => [...datasets.values()],
    getCorrections: (datasetId: string) => corrections.get(datasetId) ?? [],
    getPackSubscriptions: (customerId = "demo-customer") =>
      [...(packSubscriptions.get(customerId) ?? [])],
  };
}

/** 任意请求一律失败的后端（错误态测试）。 */
export function consoleFailingBackend(
  status = 500,
  detail = "boom",
): typeof fetch {
  return (() =>
    Promise.resolve(jsonResponse({ detail }, status))) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// 登录会话测试件（wire-self-serve-launch 4.4/4.6/5.2/6.2）
// ---------------------------------------------------------------------------

function b64urlJson(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** 造测试 ID token（JWT 形状，payload base64url；签名段无意义——校验在服务端）。 */
export function makeIdToken(
  claims: { sub?: string; roles?: string[]; email?: string; name?: string } = {},
): string {
  const payload = {
    sub: claims.sub ?? "demo-customer",
    ...(claims.roles ? { roles: claims.roles } : {}),
    ...(claims.email ? { email: claims.email } : {}),
    ...(claims.name ? { name: claims.name } : {}),
  };
  return `${b64urlJson({ alg: "HS256", typ: "JWT" })}.${b64urlJson(payload)}.test-signature`;
}

/** 从请求头解出 Bearer token 的 sub claim（即客户标识；无/坏 token → null）。 */
export function subOfBearer(headers: Record<string, string>): string | null {
  const authorization = headers["authorization"] ?? "";
  const match = authorization.match(/^Bearer (.+)$/);
  if (!match) return null;
  try {
    const payload = match[1]!.split(".")[1];
    if (!payload) return null;
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(
      padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="),
    );
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))) as {
      sub?: string;
    };
    return typeof claims.sub === "string" && claims.sub ? claims.sub : null;
  } catch {
    return null;
  }
}

/**
 * 种子登录会话（sessionStorage）：idToken = makeIdToken(claims)，
 * customer 回填 plan_code（免费档门禁/用量页测试用）。返回会话对象便于断言。
 */
export function seedConsoleSession(
  overrides: {
    sub?: string;
    roles?: string[];
    email?: string;
    planCode?: string;
    customerName?: string;
    idToken?: string;
  } = {},
): ConsoleSession {
  const idToken = overrides.idToken ?? makeIdToken(overrides);
  const session: ConsoleSession = {
    idToken,
    expiresAt: Date.now() + 3600_000,
    identity: overrides.email ?? overrides.sub ?? "demo-customer",
    email: overrides.email,
    roles: overrides.roles ?? [],
    customer: {
      id: 1,
      name: overrides.customerName ?? "演示客户",
      plan_code: overrides.planCode ?? "basic",
    },
  };
  saveSession(session);
  return session;
}
