// 测试专用：控制台 API 的内存假后端（语义对齐 api 仓 fd_wire_api 路由：
// Authorization: Bearer <ID token> 身份（解码 sub 即客户标识）、创建即跑
// 一轮循环、消息 append-only、产物草稿列表；wire-customer-local-data 任务组 3
// 追加 数据集/上传/修正/同步/连接器 路由；wire-self-serve-launch 追加
// /api/console/{auth/config,session,usage} 路由——纯内存、零网络）。
import type {
  ChatMessage,
  Connector,
  Conversation,
  ConversationDetail,
  Correction,
  CorrectionInput,
  CorrectionOp,
  Dataset,
  DatasetColumn,
  DraftArtifact,
  MessageRole,
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
  /** 配对令牌有效期秒数（默认 900 = 15 分钟）。 */
  pairingTokenTtlSeconds?: number;
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
  addDataset: (dataset: Dataset) => void;
  addConnector: (connector: Connector) => void;
  addRows: (
    datasetId: string,
    columns: DatasetColumn[],
    rows: Array<Record<string, unknown>>,
  ) => void;
  addCorrection: (correction: Correction) => void;
  addSync: (sync: SyncRecord) => void;
  getDatasets: () => Dataset[];
  getCorrections: (datasetId: string) => Correction[];
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
  const syncs = new Map<string, SyncRecord[]>();
  let nextUploadSeq = 1;
  let nextCorrectionId = 1;
  let nextTokenSeq = 1;

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

    const customerId = subOfBearer(headers);
    if (!customerId) {
      return Promise.resolve(
        jsonResponse(
          { detail: "缺少 Authorization: Bearer <ID token>（登录会话）" },
          401,
        ),
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

    // ── 我的数据：数据集列表 / 建档 / 详情 / 预览 ──
    if (path === "/api/v1/datasets" && method === "GET") {
      const mine = [...datasets.values()].filter(
        (d) => !d.customer_id || d.customer_id === customerId,
      );
      return Promise.resolve(jsonResponse(mine));
    }

    if (path === "/api/v1/datasets" && method === "POST") {
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
      datasets.set(id, dataset);
      return Promise.resolve(jsonResponse(dataset, 201));
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

    match = path.match(/^\/api\/v1\/datasets\/([^/]+)\/corrections$/);
    if (match) {
      const dataset = ownDataset(match[1]);
      if (!dataset) {
        return Promise.resolve(jsonResponse({ detail: "dataset not found" }, 404));
      }
      if (method === "GET") {
        return Promise.resolve(jsonResponse(corrections.get(dataset.id) ?? []));
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

    return Promise.resolve(jsonResponse({ detail: "not found" }, 404));
  }) as unknown as typeof fetch;

  return {
    calls,
    fetchImpl,
    addMessage,
    addArtifact,
    addDataset,
    addConnector,
    addRows,
    addCorrection,
    addSync,
    getDatasets: () => [...datasets.values()],
    getCorrections: (datasetId: string) => corrections.get(datasetId) ?? [],
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
