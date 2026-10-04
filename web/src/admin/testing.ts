// 测试专用：内部后台 API 的内存假后端（语义对齐 api 仓 fd_wire_api.admin：
// X-Admin-Token 鉴权、客户 CRUD、账本只读、需求单派发（状态机白名单）、
// 目录治理 append-only 审核意见、分轨用量聚合）。
import type {
  AdminCustomer,
  AdminDemand,
  AdminPlan,
  AggRow,
  CatalogPendingResponse,
  CustomerUsage,
  DemandStatus,
  LedgerEntry,
  ReviewNote,
  UsageOverview,
} from "./api";
import { ALLOWED_TRANSITIONS as MACHINE_TRANSITIONS } from "./demandsMachine";

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

/** 需求单八态状态机白名单（共享 demandsMachine.ts 的镜像）。 */
export const ALLOWED_TRANSITIONS = MACHINE_TRANSITIONS;

export const DEFAULT_PLANS: AdminPlan[] = [
  {
    id: 1,
    code: "starter",
    name: "起步版",
    monthly_price_micro: 1_999_000_000,
    monthly_price_yuan: "¥1,999",
    included_lines: 500_000,
    overage_unit_price_micro: 4_000,
    is_active: true,
  },
  {
    id: 2,
    code: "professional",
    name: "专业版",
    monthly_price_micro: 6_999_000_000,
    monthly_price_yuan: "¥6,999",
    included_lines: 3_000_000,
    overage_unit_price_micro: 3_000,
    is_active: true,
  },
  {
    id: 3,
    code: "enterprise",
    name: "旗舰版",
    monthly_price_micro: 19_999_000_000,
    monthly_price_yuan: "¥19,999",
    included_lines: 12_000_000,
    overage_unit_price_micro: 2_000,
    is_active: true,
  },
];

export interface AdminBackendOptions {
  /** 期望的 X-Admin-Token（请求头不匹配 → 401）。 */
  adminToken?: string;
  /** 强制全部请求返回该状态（如 403 模拟 env 未配置的 fail-closed）。 */
  forceStatus?: number;
  /** 强制 transition 端点返回该状态（如 409 冲突回显测试）。 */
  failTransitionStatus?: number;
  customers?: AdminCustomer[];
  demands?: AdminDemand[];
  ledger?: LedgerEntry[];
  tracks?: AggRow[];
  bySource?: AggRow[];
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

/** 安装假后端为 global fetch；返回调用记录与数据注入接口。 */
export function installAdminBackend(options: AdminBackendOptions = {}): {
  calls: FetchCall[];
  fetchImpl: typeof fetch;
  notes: ReviewNote[];
} {
  const adminToken = options.adminToken ?? "test-admin-token";
  const customers = [...(options.customers ?? [])];
  const demands = [...(options.demands ?? [])];
  const ledger = [...(options.ledger ?? [])];
  const notes: ReviewNote[] = [];
  const tracks = options.tracks ?? [
    { key: "customer", calls: 12, rows: 3400 },
    { key: "platform", calls: 5, rows: 800 },
  ];
  const bySource = options.bySource ?? [
    { key: "yizuo", calls: 8, rows: 2600 },
    { key: "wanxing", calls: 4, rows: 800 },
    { key: "platform-internal", calls: 5, rows: 800 },
  ];
  let nextCustomerId = Math.max(0, ...customers.map((c) => c.id)) + 1;
  let nextNoteId = 1;

  const calls: FetchCall[] = [];

  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit): Promise<FakeResponse> => {
    const url = new URL(String(input), "http://admin.test");
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = headersOf(init);
    calls.push({
      method,
      url,
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    if (options.forceStatus) {
      return Promise.resolve(
        jsonResponse({ detail: `forced ${options.forceStatus}` }, options.forceStatus),
      );
    }

    const token = headers["x-admin-token"];
    if (!token) {
      return Promise.resolve(
        jsonResponse({ detail: "缺少 X-Admin-Token（内部后台鉴权头）" }, 401),
      );
    }
    if (token !== adminToken) {
      return Promise.resolve(jsonResponse({ detail: "无效的 X-Admin-Token" }, 401));
    }

    const path = url.pathname;
    const body = calls[calls.length - 1]!.body as Record<string, unknown> | undefined;

    // -- 客户管理 ----------------------------------------------------------
    if (path === "/internal/admin/plans" && method === "GET") {
      return Promise.resolve(jsonResponse(DEFAULT_PLANS));
    }
    if (path === "/internal/admin/customers" && method === "GET") {
      return Promise.resolve(jsonResponse(customers));
    }
    if (path === "/internal/admin/customers" && method === "POST") {
      const plan = DEFAULT_PLANS.find((p) => p.code === body?.plan_code);
      if (!plan) {
        return Promise.resolve(jsonResponse({ detail: `未知套餐档位: ${body?.plan_code}` }, 422));
      }
      const dup = customers.find((c) => c.name === body?.name && c.plan_id === plan.id);
      if (dup) {
        return Promise.resolve(jsonResponse({ detail: "同名同档客户已存在" }, 409));
      }
      const created: AdminCustomer = {
        id: nextCustomerId++,
        name: String(body?.name ?? ""),
        sub2api_user_id: (body?.sub2api_user_id as string) || null,
        plan_id: plan.id,
        plan_code: plan.code,
        plan_name: plan.name,
        status: "active",
        created_at: "2026-10-04T10:00:00",
      };
      customers.unshift(created);
      return Promise.resolve(jsonResponse(created, 201));
    }
    let match = path.match(/^\/internal\/admin\/customers\/(\d+)$/);
    if (match && method === "PATCH") {
      const id = Number(match[1]);
      const customer = customers.find((c) => c.id === id);
      if (!customer) {
        return Promise.resolve(jsonResponse({ detail: `customer ${id} 不存在` }, 404));
      }
      if (body?.plan_code) {
        const plan = DEFAULT_PLANS.find((p) => p.code === body.plan_code);
        if (!plan) {
          return Promise.resolve(jsonResponse({ detail: "未知套餐档位" }, 422));
        }
        customer.plan_id = plan.id;
        customer.plan_code = plan.code;
        customer.plan_name = plan.name;
      }
      if (body?.status) customer.status = String(body.status);
      return Promise.resolve(jsonResponse(customer));
    }
    match = path.match(/^\/internal\/admin\/customers\/(\d+)\/usage$/);
    if (match && method === "GET") {
      const id = Number(match[1]);
      const customer = customers.find((c) => c.id === id);
      if (!customer) {
        return Promise.resolve(jsonResponse({ detail: `customer ${id} 不存在` }, 404));
      }
      const usage: CustomerUsage = {
        customer_id: customer.id,
        customer_name: customer.name,
        caller: customer.sub2api_user_id,
        credential_track: "customer",
        totals: { period: "all", calls: 4, rows: 1200 },
        periods: [
          { period: "2026-09", calls: 1, rows: 300 },
          { period: "2026-10", calls: 3, rows: 900 },
        ],
      };
      return Promise.resolve(jsonResponse(usage));
    }

    // -- 账本 --------------------------------------------------------------
    if (path === "/internal/admin/ledger" && method === "GET") {
      const customerId = url.searchParams.get("customer_id");
      const period = url.searchParams.get("period");
      const entries = ledger.filter(
        (e) =>
          (customerId == null || e.customer_id === Number(customerId)) &&
          (!period || e.period === period),
      );
      return Promise.resolve(jsonResponse(entries));
    }

    // -- 需求单派发台 --------------------------------------------------------
    if (path === "/internal/admin/demands" && method === "GET") {
      const status = url.searchParams.get("status");
      const items = demands.filter((d) => !status || d.status === status);
      return Promise.resolve(jsonResponse(items));
    }
    match = path.match(/^\/internal\/admin\/demands\/(\d+)\/transition$/);
    if (match && method === "POST") {
      const id = Number(match[1]);
      if (options.failTransitionStatus) {
        return Promise.resolve(
          jsonResponse(
            { detail: `submitted → delivered 不允许：白名单外` },
            options.failTransitionStatus,
          ),
        );
      }
      const demand = demands.find((d) => d.id === id);
      if (!demand) {
        return Promise.resolve(jsonResponse({ detail: `demand ${id} 不存在` }, 404));
      }
      const target = body?.target_status as DemandStatus;
      const allowed = ALLOWED_TRANSITIONS[demand.status] ?? [];
      if (!allowed.includes(target)) {
        return Promise.resolve(
          jsonResponse({ detail: `${demand.status} → ${target} 不允许` }, 409),
        );
      }
      demand.status = target;
      demand.status_history = [
        ...demand.status_history,
        {
          status: target,
          at: "2026-10-04T12:00:00+00:00",
          by: String(body?.by ?? "admin-console"),
          note: (body?.note as string) ?? null,
        },
      ];
      return Promise.resolve(jsonResponse(demand));
    }

    // -- 目录治理 ------------------------------------------------------------
    if (path === "/internal/admin/catalog/pending" && method === "GET") {
      const status = url.searchParams.get("status") ?? "registered";
      const response: CatalogPendingResponse = {
        status,
        items: [
          {
            indicator_id: "ind-reg-1",
            code: "IND_REG_1",
            name_zh: "待治理指标一",
            name_en: "Pending One",
            domain: "macro",
            frequency: "monthly",
            status,
            synced_at: "2026-10-04T02:00:00+00:00",
          },
        ],
        total: 1,
      };
      return Promise.resolve(jsonResponse(response));
    }
    match = path.match(/^\/internal\/admin\/catalog\/([^/]+)\/verify-note$/);
    if (match && method === "POST") {
      const indicatorId = decodeURIComponent(match[1]);
      const note: ReviewNote = {
        id: nextNoteId++,
        indicator_id: indicatorId,
        note: String(body?.note ?? ""),
        author: String(body?.author ?? "admin-console"),
        created_at: "2026-10-04T12:00:00+00:00",
      };
      notes.push(note);
      return Promise.resolve(jsonResponse(note, 201));
    }
    match = path.match(/^\/internal\/admin\/catalog\/([^/]+)\/notes$/);
    if (match && method === "GET") {
      const indicatorId = decodeURIComponent(match[1]);
      return Promise.resolve(
        jsonResponse(notes.filter((n) => n.indicator_id === indicatorId)),
      );
    }

    // -- 用量分轨 --------------------------------------------------------------
    if (path === "/internal/admin/usage/overview" && method === "GET") {
      const track = url.searchParams.get("credential_track");
      const visibleTracks = track ? tracks.filter((t) => t.key === track) : tracks;
      const totals: AggRow = {
        key: "all",
        calls: visibleTracks.reduce((acc, t) => acc + t.calls, 0),
        rows: visibleTracks.reduce((acc, t) => acc + t.rows, 0),
      };
      const overview: UsageOverview = {
        credential_track: track,
        start: url.searchParams.get("start"),
        end: url.searchParams.get("end"),
        tracks: visibleTracks,
        by_source: bySource.filter((s) => !track || s.key !== "platform-internal" || track === "platform"),
        totals,
      };
      return Promise.resolve(jsonResponse(overview));
    }

    return Promise.resolve(jsonResponse({ detail: "not found" }, 404));
  }) as unknown as typeof fetch;

  return { calls, fetchImpl, notes };
}
