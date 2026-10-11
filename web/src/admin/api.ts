// 内部后台 API 客户端（wire-platform-v1 任务 7.1 web 面）。
// - 端点族：/internal/admin/*（api 仓 fd_wire_api.admin 路由）——客户管理 /
//   账本 / 需求单派发 / 目录治理 / 用量分轨。
// - 鉴权（admin 双闸，wire-self-serve-launch 任务 5.2）：请求自动附
//   Authorization: Bearer <ID token>（Logto 登录会话，服务端校验 wire-admin
//   角色）；第二道 X-Admin-Token 闸由 web 容器 nginx 在 /internal/ 反代上
//   服务端注入（env FD_WIRE_ADMIN_TOKEN）——浏览器永不持有该值，开发占位的
//   DEFAULT_ADMIN_TOKEN / localStorage 令牌存储已整体退场。
// - 基址：VITE_ADMIN_API_BASE 显式覆盖；缺省从 API_BASE 剥掉结尾 /api 推导
//   （默认同源根——dev 本地直连可设 VITE_ADMIN_API_BASE=http://127.0.0.1:8000）。
// - 错误如实：非 2xx 一律抛 AdminApiError（携带 status 与后端 detail），
//   UI 原样呈现（401/403 = 鉴权失败态），绝不静默吞掉。
import { API_BASE } from "../catalog/api";
import { loadSession } from "../console/auth";

function resolveAdminBase(): string {
  const explicit = String(import.meta.env.VITE_ADMIN_API_BASE ?? "").trim();
  if (explicit) return explicit;
  // "/api"（同源代理前缀）→ ""；"https://host/api" → "https://host"
  return API_BASE.replace(/\/api\/?$/, "");
}

export const ADMIN_API_BASE = resolveAdminBase();

/** 登录会话 Bearer 头（无会话即 401 如实上抛；不携带任何手填令牌）。 */
function bearerHeaders(): Record<string, string> {
  const session = loadSession();
  if (!session?.idToken) {
    throw new AdminApiError("no console session (sign in required)", 401);
  }
  return { Authorization: `Bearer ${session.idToken}` };
}

// ---------------------------------------------------------------------------
// 类型（对齐 api 仓 fd_wire_api/admin/schemas.py 与 demands.schemas）
// ---------------------------------------------------------------------------

export interface AdminPlan {
  id: number;
  code: string;
  name: string;
  monthly_price_micro: number;
  monthly_price_yuan: string;
  included_lines: number;
  overage_unit_price_micro: number;
  is_active: boolean;
}

export interface AdminCustomer {
  id: number;
  name: string;
  /** v1 兼作计量身份映射（metering caller 名） */
  sub2api_user_id: string | null;
  plan_id: number;
  plan_code: string;
  plan_name: string;
  status: string;
  created_at: string;
}

export interface UsagePeriodRow {
  period: string;
  calls: number;
  rows: number;
}

export interface CustomerUsage {
  customer_id: number;
  customer_name: string;
  caller: string | null;
  credential_track: string;
  totals: UsagePeriodRow;
  periods: UsagePeriodRow[];
}

export type LedgerKind =
  | "grant"
  | "overage"
  | "hardstop"
  | "demand"
  | "adjustment";

export interface LedgerEntry {
  id: number;
  customer_id: number;
  kind: LedgerKind;
  quantity: number;
  amount_micro: number;
  amount_yuan: string;
  amount_yuan_str: string;
  period: string;
  idempotency_key: string;
  source_ref: string | null;
  sub2api_applied: boolean;
  created_at: string;
}

/** 需求单状态（三态机 + rejected；八态工作流的五个旧态已废除，前端不出现）。 */
export type DemandStatus =
  | "submitted"
  | "in_progress"
  | "delivered"
  | "rejected";

export interface DemandHistoryEvent {
  status: string;
  at: string;
  by: string;
  note: string | null;
}

export interface AdminDemand {
  id: number;
  code: string;
  customer_id: string;
  title: string;
  intent: string;
  status: DemandStatus;
  status_history: DemandHistoryEvent[];
  evaluation_summary: string | null;
  rejection_reason: string | null;
  quote_amount: string | null;
  quote_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface DemandTransitionInput {
  target_status: DemandStatus;
  note?: string;
  by?: string;
  reason?: string;
}

/** 「转生成工单」结果（与内部端点共用同一 service 的响应形状）。 */
export interface AdminWorkorderResult {
  ticket_yaml: string;
  ticket_path: string;
  delivered: boolean;
  queued_for_pull: boolean;
  slug_check: "free" | "unverified";
}

export interface IndicatorPendingItem {
  indicator_id: string;
  code: string;
  name_zh: string | null;
  name_en: string | null;
  domain: string | null;
  frequency: string | null;
  status: string;
  synced_at: string;
}

export interface CatalogPendingResponse {
  status: string;
  items: IndicatorPendingItem[];
  total: number;
}

export interface ReviewNote {
  id: number;
  indicator_id: string;
  note: string;
  author: string;
  created_at: string;
}

export interface AggRow {
  key: string;
  calls: number;
  rows: number;
}

export interface UsageOverview {
  credential_track: string | null;
  start: string | null;
  end: string | null;
  tracks: AggRow[];
  by_source: AggRow[];
  totals: AggRow;
}

// ---------------------------------------------------------------------------
// 请求底座
// ---------------------------------------------------------------------------

export class AdminApiError extends Error {
  readonly status: number | undefined;
  /** 后端 error body 的 detail 文案（如 401/403 的鉴权说明），无则 undefined。 */
  readonly detail: string | undefined;

  constructor(message: string, status?: number, detail?: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.detail = detail;
  }
}

interface RequestOptions {
  method: "GET" | "POST" | "PATCH";
  body?: unknown;
  /** 端点要求的额外头（一般不用——X-Admin-Token 由 nginx 服务端注入）。 */
  headers?: Record<string, string>;
}

async function requestJson<T>(path: string, options: RequestOptions): Promise<T> {
  const { method, body } = options;
  const url = `${ADMIN_API_BASE}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...bearerHeaders(),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.headers ?? {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    if (err instanceof AdminApiError) throw err;
    throw new AdminApiError(
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
    throw new AdminApiError(
      `admin api ${response.status} for ${url}`,
      response.status,
      detail,
    );
  }
  try {
    return (await response.json()) as T;
  } catch (err) {
    throw new AdminApiError(`invalid json from ${url}: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// 客户管理
// ---------------------------------------------------------------------------

export function fetchPlans(): Promise<AdminPlan[]> {
  return requestJson("/internal/admin/plans", { method: "GET" });
}

export function fetchCustomers(): Promise<AdminCustomer[]> {
  return requestJson("/internal/admin/customers", { method: "GET" });
}

export function createCustomer(
  payload: { name: string; plan_code: string; sub2api_user_id?: string | null },
): Promise<AdminCustomer> {
  return requestJson("/internal/admin/customers", {
    method: "POST",
    body: payload,
  });
}

export function patchCustomer(
  customerId: number,
  payload: { plan_code?: string; status?: string },
): Promise<AdminCustomer> {
  return requestJson(`/internal/admin/customers/${customerId}`, {
    method: "PATCH",
    body: payload,
  });
}

// ---------------------------------------------------------------------------
// 额度与账本
// ---------------------------------------------------------------------------

export function fetchCustomerUsage(customerId: number): Promise<CustomerUsage> {
  return requestJson(`/internal/admin/customers/${customerId}/usage`, {
    method: "GET",
  });
}

export function fetchLedger(
  params: { customer_id?: number; period?: string } = {},
): Promise<LedgerEntry[]> {
  const qs = new URLSearchParams();
  if (params.customer_id != null) qs.set("customer_id", String(params.customer_id));
  if (params.period) qs.set("period", params.period);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return requestJson(`/internal/admin/ledger${suffix}`, { method: "GET" });
}

// ---------------------------------------------------------------------------
// 需求单派发台
// ---------------------------------------------------------------------------

export function fetchDemands(status?: DemandStatus): Promise<AdminDemand[]> {
  const suffix = status ? `?status=${status}` : "";
  return requestJson(`/internal/admin/demands${suffix}`, { method: "GET" });
}

export function transitionDemand(
  demandId: number,
  payload: DemandTransitionInput,
): Promise<AdminDemand> {
  return requestJson(`/internal/admin/demands/${demandId}/transition`, {
    method: "POST",
    body: payload,
  });
}

/** 「转生成工单」：出单入拉取队列（出单不迁移状态；响应带全文供人工推送降级）。 */
export function exportDemandWorkorder(
  demandId: number,
  body?: { slug?: string },
): Promise<AdminWorkorderResult> {
  return requestJson(`/internal/admin/demands/${demandId}/workorder`, {
    method: "POST",
    ...(body ? { body } : {}),
  });
}

// ---------------------------------------------------------------------------
// 目录治理
// ---------------------------------------------------------------------------

export function fetchCatalogPending(
  status: "registered" | "verified" = "registered",
): Promise<CatalogPendingResponse> {
  return requestJson(`/internal/admin/catalog/pending?status=${status}`, {
    method: "GET",
  });
}

export function addVerifyNote(
  indicatorId: string,
  note: string,
  author = "admin-console",
): Promise<ReviewNote> {
  return requestJson(
    `/internal/admin/catalog/${encodeURIComponent(indicatorId)}/verify-note`,
    { method: "POST", body: { note, author } },
  );
}

export function fetchReviewNotes(indicatorId: string): Promise<ReviewNote[]> {
  return requestJson(
    `/internal/admin/catalog/${encodeURIComponent(indicatorId)}/notes`,
    { method: "GET" },
  );
}

// ---------------------------------------------------------------------------
// 用量分轨概览
// ---------------------------------------------------------------------------

export interface UsageOverviewQuery {
  credential_track?: "customer" | "platform";
  start?: string;
  end?: string;
}

export function fetchUsageOverview(
  query: UsageOverviewQuery = {},
): Promise<UsageOverview> {
  const qs = new URLSearchParams();
  if (query.credential_track) qs.set("credential_track", query.credential_track);
  if (query.start) qs.set("start", query.start);
  if (query.end) qs.set("end", query.end);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return requestJson(`/internal/admin/usage/overview${suffix}`, {
    method: "GET",
  });
}

// ---------------------------------------------------------------------------
// 客户本地数据只读概览（wire-customer-local-data 任务 5.1）
// ---------------------------------------------------------------------------

/** 连接器健康（api 仓 datasets/schemas.py InternalConnectorOut，只读投影）。 */
export interface DatasetConnectorHealth {
  id: string;
  status: string;
  last_heartbeat_at: string | null;
}

/** per-cell 概览行（api 仓 datasets/schemas.py InternalOverviewOut）。 */
export interface CustomerLocalDataOverview {
  customer_id: string;
  datasets: number;
  storage_bytes: number;
  connectors: DatasetConnectorHealth[];
}

/**
 * per-cell 客户数据集存储用量与连接器同步健康（只读，无管理操作入口）。
 * 鉴权（admin 双闸后）：自动附登录 Bearer；X-Admin-Token 由 nginx 服务端注入。
 * 浏览器不再携带任何 X-Internal-Token——datasets 内部面若仍要求该头，
 * 由 api/网关侧把该端点并入双闸通道（前端不做令牌拼装）。
 */
export function fetchCustomerLocalDataOverview(): Promise<
  CustomerLocalDataOverview[]
> {
  return requestJson("/internal/datasets/overview", {
    method: "GET",
  });
}
