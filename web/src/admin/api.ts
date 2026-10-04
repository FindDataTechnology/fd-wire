// 内部后台 API 客户端（wire-platform-v1 任务 7.1 web 面）。
// - 端点族：/internal/admin/*（api 仓 fd_wire_api.admin 路由）——客户管理 /
//   账本 / 需求单派发 / 目录治理 / 用量分轨。
// - 鉴权：X-Admin-Token 头（env FD_WIRE_ADMIN_TOKEN；未配置 fail-closed 403）。
//   token 为 localStorage 可编辑的开发占位（鉴权上线后由正式登录态替换，
//   UI 面注明「仅开发用」）。
// - 基址：VITE_ADMIN_API_BASE 显式覆盖；缺省从 API_BASE 剥掉结尾 /api 推导
//   （默认同源根——dev 本地直连可设 VITE_ADMIN_API_BASE=http://127.0.0.1:8000）。
// - 错误如实：非 2xx 一律抛 AdminApiError（携带 status 与后端 detail），
//   UI 原样呈现（401/403 = 鉴权失败态），绝不静默吞掉。
import { API_BASE } from "../catalog/api";

function resolveAdminBase(): string {
  const explicit = String(import.meta.env.VITE_ADMIN_API_BASE ?? "").trim();
  if (explicit) return explicit;
  // "/api"（同源代理前缀）→ ""；"https://host/api" → "https://host"
  return API_BASE.replace(/\/api\/?$/, "");
}

export const ADMIN_API_BASE = resolveAdminBase();

/** admin 令牌的开发占位存储（仅开发用；生产由登录态提供）。 */
export const ADMIN_TOKEN_STORAGE_KEY = "wire-web-admin-token";
export const DEFAULT_ADMIN_TOKEN = "dev-admin-token";

export function loadAdminToken(): string {
  try {
    const raw = localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
    return raw && raw.trim() ? raw.trim() : DEFAULT_ADMIN_TOKEN;
  } catch {
    return DEFAULT_ADMIN_TOKEN;
  }
}

export function saveAdminToken(raw: string): string {
  const normalized = raw.trim() || DEFAULT_ADMIN_TOKEN;
  try {
    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, normalized);
  } catch {
    /* localStorage 不可用时仅本次会话生效 */
  }
  return normalized;
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

export type DemandStatus =
  | "submitted"
  | "evaluating"
  | "quoted"
  | "awaiting_confirm"
  | "building"
  | "delivery_acceptance"
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
  confirmed_by_operator?: boolean;
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
  token: string;
  body?: unknown;
}

async function requestJson<T>(path: string, options: RequestOptions): Promise<T> {
  const { method, token, body } = options;
  const url = `${ADMIN_API_BASE}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "X-Admin-Token": token,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
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

export function fetchPlans(token: string): Promise<AdminPlan[]> {
  return requestJson("/internal/admin/plans", { method: "GET", token });
}

export function fetchCustomers(token: string): Promise<AdminCustomer[]> {
  return requestJson("/internal/admin/customers", { method: "GET", token });
}

export function createCustomer(
  token: string,
  payload: { name: string; plan_code: string; sub2api_user_id?: string | null },
): Promise<AdminCustomer> {
  return requestJson("/internal/admin/customers", {
    method: "POST",
    token,
    body: payload,
  });
}

export function patchCustomer(
  token: string,
  customerId: number,
  payload: { plan_code?: string; status?: string },
): Promise<AdminCustomer> {
  return requestJson(`/internal/admin/customers/${customerId}`, {
    method: "PATCH",
    token,
    body: payload,
  });
}

// ---------------------------------------------------------------------------
// 额度与账本
// ---------------------------------------------------------------------------

export function fetchCustomerUsage(
  token: string,
  customerId: number,
): Promise<CustomerUsage> {
  return requestJson(`/internal/admin/customers/${customerId}/usage`, {
    method: "GET",
    token,
  });
}

export function fetchLedger(
  token: string,
  params: { customer_id?: number; period?: string } = {},
): Promise<LedgerEntry[]> {
  const qs = new URLSearchParams();
  if (params.customer_id != null) qs.set("customer_id", String(params.customer_id));
  if (params.period) qs.set("period", params.period);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return requestJson(`/internal/admin/ledger${suffix}`, { method: "GET", token });
}

// ---------------------------------------------------------------------------
// 需求单派发台
// ---------------------------------------------------------------------------

export function fetchDemands(
  token: string,
  status?: DemandStatus,
): Promise<AdminDemand[]> {
  const suffix = status ? `?status=${status}` : "";
  return requestJson(`/internal/admin/demands${suffix}`, { method: "GET", token });
}

export function transitionDemand(
  token: string,
  demandId: number,
  payload: DemandTransitionInput,
): Promise<AdminDemand> {
  return requestJson(`/internal/admin/demands/${demandId}/transition`, {
    method: "POST",
    token,
    body: payload,
  });
}

// ---------------------------------------------------------------------------
// 目录治理
// ---------------------------------------------------------------------------

export function fetchCatalogPending(
  token: string,
  status: "registered" | "verified" = "registered",
): Promise<CatalogPendingResponse> {
  return requestJson(`/internal/admin/catalog/pending?status=${status}`, {
    method: "GET",
    token,
  });
}

export function addVerifyNote(
  token: string,
  indicatorId: string,
  note: string,
  author = "admin-console",
): Promise<ReviewNote> {
  return requestJson(
    `/internal/admin/catalog/${encodeURIComponent(indicatorId)}/verify-note`,
    { method: "POST", token, body: { note, author } },
  );
}

export function fetchReviewNotes(
  token: string,
  indicatorId: string,
): Promise<ReviewNote[]> {
  return requestJson(
    `/internal/admin/catalog/${encodeURIComponent(indicatorId)}/notes`,
    { method: "GET", token },
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
  token: string,
  query: UsageOverviewQuery = {},
): Promise<UsageOverview> {
  const qs = new URLSearchParams();
  if (query.credential_track) qs.set("credential_track", query.credential_track);
  if (query.start) qs.set("start", query.start);
  if (query.end) qs.set("end", query.end);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return requestJson(`/internal/admin/usage/overview${suffix}`, {
    method: "GET",
    token,
  });
}
