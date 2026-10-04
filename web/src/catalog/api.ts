// 指标目录公开 API 客户端（wire-indicator-catalog 呈现面）。
// - 基址走 env：VITE_API_BASE（默认 "/api" 同源；dev 由 vite proxy 转发到
//   http://127.0.0.1:8000，生产同源由网关承接）。
// - 只做只读 GET：列表搜索 + 详情。不携带任何凭证，未登录可访问。
// - 响应不含观测数值（后端镜像表即无观测列），前端也不请求观测数值。

export type IndicatorStatus = "verified" | "registered";

export interface IndicatorListItem {
  indicator_id: string;
  code: string;
  name_zh: string | null;
  name_en: string | null;
  domain: string | null;
  frequency: string | null;
  status: IndicatorStatus;
}

export interface DemandPrefill {
  indicator_code: string;
}

export interface IndicatorDetail extends IndicatorListItem {
  description_zh: string | null;
  description_en: string | null;
  time_span_start: string | null;
  time_span_end: string | null;
  entity_coverage_count: number | null;
  sample_value: string | null;
  synced_at: string;
  /** 仅 registered 为 true（按需开通导流）。 */
  on_demand: boolean;
  demand_prefill: DemandPrefill | null;
}

export interface IndicatorListResponse {
  items: IndicatorListItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface CatalogQuery {
  q?: string;
  domain?: string;
  status?: IndicatorStatus | "";
  page?: number;
  page_size?: number;
}

/** API 基址：VITE_API_BASE 覆盖，默认 /api 同源。 */
export const API_BASE: string =
  String(import.meta.env.VITE_API_BASE ?? "").trim() || "/api";

export class CatalogApiError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "CatalogApiError";
    this.status = status;
  }
}

/** 组装列表查询 URL（空值参数不下发）。 */
export function buildIndicatorsUrl(query: CatalogQuery = {}): string {
  const params = new URLSearchParams();
  if (query.q && query.q.trim()) params.set("q", query.q.trim());
  if (query.domain && query.domain.trim()) params.set("domain", query.domain.trim());
  if (query.status) params.set("status", query.status);
  if (query.page != null && query.page >= 1) params.set("page", String(query.page));
  if (query.page_size != null && query.page_size >= 1)
    params.set("page_size", String(query.page_size));
  const qs = params.toString();
  return `${API_BASE}/v1/catalog/indicators${qs ? `?${qs}` : ""}`;
}

/** 详情 URL：{id} 为 indicator_id（权威主键）。 */
export function buildIndicatorDetailUrl(id: string): string {
  return `${API_BASE}/v1/catalog/indicators/${encodeURIComponent(id)}`;
}

async function getJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    throw new CatalogApiError(`network error fetching ${url}: ${(err as Error).message}`);
  }
  if (!response.ok) {
    throw new CatalogApiError(`catalog api ${response.status} for ${url}`, response.status);
  }
  try {
    return await response.json();
  } catch (err) {
    throw new CatalogApiError(`invalid json from ${url}: ${(err as Error).message}`);
  }
}

/** 目录搜索（公开，不登录）。 */
export function fetchIndicators(query: CatalogQuery = {}): Promise<IndicatorListResponse> {
  return getJson(buildIndicatorsUrl(query)) as Promise<IndicatorListResponse>;
}

/** 指标详情（公开，不登录；registered 附按需导流字段）。 */
export function fetchIndicator(id: string): Promise<IndicatorDetail> {
  return getJson(buildIndicatorDetailUrl(id)) as Promise<IndicatorDetail>;
}

/** 展示名：中文优先，英文兜底，最后兜底 code。 */
export function displayName(item: {
  name_zh: string | null;
  name_en: string | null;
  code: string;
}): string {
  return item.name_zh?.trim() || item.name_en?.trim() || item.code;
}

/** 描述摘要：中文优先英文兜底（详情页两个字段都展示）。 */
export function displayDescription(item: {
  description_zh: string | null;
  description_en: string | null;
}): string | null {
  return item.description_zh?.trim() || item.description_en?.trim() || null;
}

/** registered 导流目标：需求单提交占位路由（预填指标 code）。 */
export function demandNewHref(indicatorCode: string): string {
  return `#/console/demands/new?indicator=${encodeURIComponent(indicatorCode)}`;
}
