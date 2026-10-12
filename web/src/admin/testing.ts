// 测试专用：内部后台 API 的内存假后端（语义对齐 api 仓 fd_wire_api.admin
// admin 双闸后的 web 侧口径：Authorization: Bearer <ID token> 鉴权（浏览器
// 不持 X-Admin-Token——那由 nginx 服务端注入）、客户 CRUD、账本只读、
// 需求单派发（状态机白名单）、目录治理 append-only 审核意见、分轨用量聚合）。
import type {
  AdminCustomer,
  AdminDemand,
  AdminPlan,
  AdminWorkorderResult,
  AggRow,
  CatalogPendingResponse,
  CustomerLocalDataOverview,
  CustomerUsage,
  DemandStatus,
  LedgerEntry,
  ReviewNote,
  UsageOverview,
} from "./api";
import { ALLOWED_TRANSITIONS as MACHINE_TRANSITIONS } from "./demandsMachine";
import { saveSession } from "../console/auth";

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

/** 需求单三态状态机白名单（共享 demandsMachine.ts 的镜像）。 */
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
  /** 期望的 Bearer 凭据（测试会话的 idToken；请求头不匹配 → 401）。 */
  bearerToken?: string;
  /** 强制全部请求返回该状态（如 403 模拟 env 未配置的 fail-closed）。 */
  forceStatus?: number;
  /** 强制 transition 端点返回该状态（如 409 冲突回显测试）。 */
  failTransitionStatus?: number;
  /** 「转生成工单」成功响应覆盖（缺省用 DEFAULT_WORKORDER_RESULT）。 */
  workorderResult?: AdminWorkorderResult;
  /** 强制 workorder 端点返回该状态（如 422 无源地址回显测试）。 */
  failWorkorderStatus?: number;
  /** 「重试开 scope」结果（wire-scope-delivery-live）：ok（缺省，建 scope
   *  成功）/ fail（上游仍不可用——200 但仍 pending，留档 scope_create_failed）。 */
  scopeRetryOutcome?: "ok" | "fail";
  /** 强制 scope-retry 端点返回该状态（如 409 门禁文案回显测试）。 */
  failScopeRetryStatus?: number;
  customers?: AdminCustomer[];
  demands?: AdminDemand[];
  ledger?: LedgerEntry[];
  tracks?: AggRow[];
  bySource?: AggRow[];
  /** 客户本地数据只读概览（/internal/datasets/overview 响应体）。 */
  datasetOverviews?: CustomerLocalDataOverview[];
}

/** 「转生成工单」缺省成功响应（形状对齐 api 仓 export_workorder_service）。 */
const DEFAULT_WORKORDER_RESULT: AdminWorkorderResult = {
  ticket_yaml:
    "kind: generate\nunit: spiders/stats-gov-cn/\ncategory: null\nbrief:\n  source_urls:\n  - https://www.stats.gov.cn/sj/zxfb/\n  expectations: 需要光伏装机相关数据\n  cadence: daily\n  notes: wire 需求单 DE-20261004-02；客户代号 cust-002\ngolden:\n- spiders/stats-gov-cn/golden/\nverify:\n  commands:\n  - python3 scripts/health_verify.py --ticket reports/health-tickets/20261004-wire-DE-20261004-02.yaml\n",
  ticket_path: "reports/health-tickets/20261004-wire-DE-20261004-02.yaml",
  delivered: false,
  queued_for_pull: true,
  slug_check: "free",
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

/** 安装假后端为 global fetch；返回调用记录与数据注入接口。 */
export function installAdminBackend(options: AdminBackendOptions = {}): {
  calls: FetchCall[];
  fetchImpl: typeof fetch;
  notes: ReviewNote[];
} {
  const bearerToken = options.bearerToken ?? "test-admin-token";
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

    const authorization = headers["authorization"] ?? "";
    if (!authorization) {
      return Promise.resolve(
        jsonResponse(
          { detail: "缺少 Authorization: Bearer <ID token>（登录会话）" },
          401,
        ),
      );
    }
    if (authorization !== `Bearer ${bearerToken}`) {
      return Promise.resolve(jsonResponse({ detail: "无效的登录凭据" }, 401));
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
    match = path.match(/^\/internal\/admin\/demands\/(\d+)\/workorder$/);
    if (match && method === "POST") {
      const id = Number(match[1]);
      if (options.failWorkorderStatus) {
        return Promise.resolve(
          jsonResponse(
            {
              detail:
                `需求单 DE-20261004-0${id} 没有 source_urls（存量单无源地址）` +
                "——生成工单必须来自带合法源地址的新单",
            },
            options.failWorkorderStatus,
          ),
        );
      }
      const demand = demands.find((d) => d.id === id);
      if (!demand) {
        return Promise.resolve(jsonResponse({ detail: `demand ${id} 不存在` }, 404));
      }
      if (demand.status !== "in_progress") {
        return Promise.resolve(
          jsonResponse(
            {
              detail: `生成工单只能在 in_progress 状态导出（当前 ${demand.status}）`,
            },
            409,
          ),
        );
      }
      return Promise.resolve(
        jsonResponse(options.workorderResult ?? DEFAULT_WORKORDER_RESULT),
      );
    }

    match = path.match(/^\/internal\/admin\/demands\/(\d+)\/scope-retry$/);
    if (match && method === "POST") {
      const id = Number(match[1]);
      const demand = demands.find((d) => d.id === id);
      if (!demand) {
        return Promise.resolve(jsonResponse({ detail: `demand ${id} 不存在` }, 404));
      }
      // 前置闸镜像（api 仓 scope_retry_conflict）：409 文案逐字同语义
      if (demand.status !== "delivered") {
        return Promise.resolve(
          jsonResponse(
            { detail: `仅已交付单可重试开 scope（当前 ${demand.status}）` },
            409,
          ),
        );
      }
      if (demand.scope_status !== "pending") {
        return Promise.resolve(
          jsonResponse(
            {
              detail: `scope 已交付或无 pending 留档（当前 ${demand.scope_status ?? "none"}）`,
            },
            409,
          ),
        );
      }
      if (options.failScopeRetryStatus) {
        // 强制失败（如 409 回显测试）：取并发态变化下的可信门禁文案
        return Promise.resolve(
          jsonResponse(
            { detail: `scope 已交付或无 pending 留档（当前 ${demand.scope_status ?? "none"}）` },
            options.failScopeRetryStatus,
          ),
        );
      }
      if (options.scopeRetryOutcome === "fail") {
        // 诚实降级：200 + 仍 pending，最新留档 scope_create_failed
        demand.delivery_events = [
          ...demand.delivery_events,
          {
            type: "scope_create_failed",
            at: "2026-10-12T10:00:00+00:00",
            error: "scope API 未配置（SCOPE_API_BASE 为空），私有 scope 交付挂起待重试",
          },
        ];
        return Promise.resolve(jsonResponse(demand));
      }
      demand.scope_status = "ok";
      demand.scope_name = `demand-${demand.code}`;
      demand.delivery_events = [
        ...demand.delivery_events,
        {
          type: "scope_created",
          at: "2026-10-12T10:00:00+00:00",
          scope_name: demand.scope_name,
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

    // -- 客户本地数据只读概览 ----------------------------------------------
    // admin 双闸后的 web 侧口径：与其它 /internal 端点同走登录 Bearer
    // （X-Admin-Token 由 nginx 注入，浏览器不再携带 X-Internal-Token）。
    if (path === "/internal/datasets/overview" && method === "GET") {
      const overview: CustomerLocalDataOverview[] = options.datasetOverviews ?? [
        {
          customer_id: "cust-alpha",
          datasets: 3,
          storage_bytes: 2_147_483_648,
          connectors: [
            {
              id: "conn-alpha-1",
              status: "online",
              last_heartbeat_at: "2026-10-06T09:58:00+00:00",
            },
            {
              id: "conn-alpha-2",
              status: "offline",
              last_heartbeat_at: "2026-10-05T09:58:00+00:00",
            },
          ],
        },
        {
          customer_id: "cust-beta",
          datasets: 0,
          storage_bytes: 0,
          connectors: [],
        },
      ];
      return Promise.resolve(jsonResponse(overview));
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

/**
 * 种子 admin 登录会话（sessionStorage）：idToken 与假后端期望 Bearer 一致
 * （默认 test-admin-token），roles 含 wire-admin（角色门禁放行）。
 * X-Admin-Token 由 nginx 服务端注入——测试面不存在该头。
 */
export function seedAdminSession(idToken = "test-admin-token"): void {
  saveSession({
    idToken,
    expiresAt: Date.now() + 3600_000,
    identity: "admin@finddatatech.cloud",
    roles: ["wire-admin"],
  });
}
