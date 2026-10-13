// 质量规则区块测试（wire-quality-rules）：规则列表 + 每条规则最新结果徽章
// （pass/fail）、空态、错误态（fetch 500 + 重试）、canEdit=false 只读档
// （无添加/启停/删除/立即检查/改名入口）、添加流程（POST 契约载荷 + 列表
// 刷新 + 表单复位）、添加 422 后端 detail 如实、立即检查（POST run → 返回
// 结果就地刷新）、删除（window.confirm 用 removeConfirm 文案；取消不发）、
// 启停开关 PATCH、行内改名 save/cancel、snapshot 通道结果显示基准时刻。
// fetch 为本文件内置契约假后端（零网络，不改 testing.ts——DatasetDetail 手法）；
// 新 i18n 键译文未落地前 t() 回落键名本身，断言只锚 testid/data-* 与语言
// 中立内容（检查表达式、数值），不锚文案。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import {
  DatasetQualityRulesSection,
  describeQualityCheck,
  latestResultFor,
  metricNeedsColumn,
  type QualityRule,
  type QualityRuleCheck,
  type QualityRuleResult,
} from "./DatasetQualityRulesSection";
import { seedConsoleSession } from "./testing";

const RULES_PATH = "/api/v1/datasets/ds-1/quality-rules";
const RUN_PATH = `${RULES_PATH}/run`;
const RESULTS_PATH = `${RULES_PATH}/results`;

function makeCheck(partial: Partial<QualityRuleCheck> = {}): QualityRuleCheck {
  return {
    metric: "null_rate",
    column: "age",
    op: "<=",
    threshold: 0.05,
    ...partial,
  };
}

function makeRule(partial: Partial<QualityRule> = {}): QualityRule {
  return {
    id: "r1",
    dataset_id: "ds-1",
    name: null,
    enabled: true,
    check: makeCheck(),
    updated_by: "demo-customer",
    updated_at: "2026-10-12T09:00:00",
    ...partial,
  };
}

function makeResult(
  partial: Partial<QualityRuleResult> = {},
): QualityRuleResult {
  return {
    id: 101,
    rule_id: "r1",
    status: "pass",
    element_count: 1000,
    unexpected_count: 0,
    pass_rate: 1,
    observed: 0.012,
    channel: "query",
    basis_at: null,
    error_text: null,
    created_at: "2026-10-12T10:00:00",
    ...partial,
  };
}

type FetchCall = {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: unknown;
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  } as unknown as Response;
}

/** 契约假后端：规则 CRUD（内存维护）+ run（按启用规则追加结果，可注入
 *  每规则状态）+ results 列表（最近在前，limit 生效）。 */
function installBackend(options: {
  rules?: QualityRule[];
  results?: QualityRuleResult[];
  note?: string;
  /** 强制 GET 规则列表返回该状态（错误态测试）。 */
  failRulesGetStatus?: number;
  /** 强制 POST 新增规则返回该状态（422 detail 回显测试）。 */
  failAddStatus?: number;
  failAddDetail?: string;
  /** run 时按规则注入结果状态（缺省 pass）。 */
  runStatuses?: Record<string, QualityRuleResult["status"]>;
} = {}) {
  const rules = [...(options.rules ?? [])];
  let results = [...(options.results ?? [])];
  let nextRuleId = 1;
  let nextResultId =
    results.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  const calls: FetchCall[] = [];

  const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(_input), "http://console.test");
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      new Headers(init.headers as HeadersInit).forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
    }
    calls.push({
      method,
      url,
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });

    const path = url.pathname;
    if (path === RULES_PATH && method === "GET") {
      if (options.failRulesGetStatus) {
        return jsonResponse(
          { detail: `quality rules ${options.failRulesGetStatus}` },
          options.failRulesGetStatus,
        );
      }
      return jsonResponse({ items: rules, note: options.note ?? "" });
    }
    if (path === RULES_PATH && method === "POST") {
      if (options.failAddStatus) {
        return jsonResponse(
          { detail: options.failAddDetail ?? `add ${options.failAddStatus}` },
          options.failAddStatus,
        );
      }
      const payload = calls[calls.length - 1]!.body as {
        check: QualityRuleCheck;
      };
      const rule: QualityRule = {
        id: `rule-${nextRuleId++}`,
        dataset_id: "ds-1",
        name: null,
        enabled: true,
        check: payload.check,
        updated_by: "demo-customer",
        updated_at: "2026-10-13T10:00:00",
      };
      rules.push(rule);
      return jsonResponse(rule, 201);
    }
    const ruleMatch = path.match(/^\/api\/v1\/datasets\/ds-1\/quality-rules\/([^/]+)$/);
    if (ruleMatch && (method === "PATCH" || method === "DELETE")) {
      const ruleId = ruleMatch[1]!;
      const index = rules.findIndex((row) => row.id === ruleId);
      if (index < 0) return jsonResponse({ detail: "no such rule" }, 404);
      if (method === "DELETE") {
        rules.splice(index, 1);
        return jsonResponse(null, 204);
      }
      const payload = (calls[calls.length - 1]!.body ?? {}) as Partial<QualityRule>;
      rules[index] = { ...rules[index]!, ...payload };
      return jsonResponse(rules[index]);
    }
    if (path === RUN_PATH && method === "POST") {
      const ranAt = "2026-10-13T11:00:00";
      for (const rule of rules) {
        if (!rule.enabled) continue;
        const status = options.runStatuses?.[rule.id] ?? "pass";
        results = [
          makeResult({
            id: nextResultId++,
            rule_id: rule.id,
            status,
            element_count: 120,
            unexpected_count: status === "fail" ? 3 : 0,
            pass_rate: status === "fail" ? 0.9 : 1,
            observed: rule.check.threshold,
            channel: "query",
            error_text: status === "error" ? "engine timeout" : null,
            created_at: ranAt,
          }),
          ...results,
        ];
      }
      return jsonResponse({ results, ranAt }, 201);
    }
    if (path === RESULTS_PATH && method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? "20");
      return jsonResponse({ items: results.slice(0, limit) });
    }
    return jsonResponse({ detail: "not found" }, 404);
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetchImpl);
  return { calls, getRules: () => rules, getResults: () => results };
}

function callsOf(calls: FetchCall[], method: string, path: string): FetchCall[] {
  return calls.filter((call) => call.method === method && call.url.pathname === path);
}

beforeEach(() => {
  i18n.changeLanguage("zh");
  localStorage.clear();
  sessionStorage.clear();
  // 登录会话种子：请求自动附 Authorization: Bearer（假后端不校验值）。
  seedConsoleSession();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe("DatasetQualityRulesSection 渲染与三态（wire-quality-rules）", () => {
  it("两条规则 + 各自最新结果徽章（r1 两条结果取最新 pass；r2 fail），请求带 Bearer", async () => {
    const backend = installBackend({
      rules: [
        makeRule({ id: "r1", check: makeCheck() }),
        makeRule({
          id: "r2",
          check: makeCheck({ metric: "row_count", column: undefined, op: ">=", threshold: 100 }),
        }),
      ],
      results: [
        makeResult({ id: 102, rule_id: "r1", status: "pass", created_at: "2026-10-12T12:00:00" }),
        makeResult({ id: 101, rule_id: "r1", status: "fail", created_at: "2026-10-12T10:00:00" }),
        makeResult({ id: 100, rule_id: "r2", status: "fail", unexpected_count: 5 }),
      ],
    });
    render(<DatasetQualityRulesSection datasetId="ds-1" canEdit />);

    // 加载态先行（契约 testid 在场），随后规则落位
    expect(screen.getByTestId("quality-rules-loading")).toBeTruthy();
    const item1 = await screen.findByTestId("quality-rule-item-r1");
    expect(item1.textContent).toContain("null_rate(age) <= 0.05");
    expect(item1.getAttribute("data-enabled")).toBe("true");
    expect(screen.getByTestId("quality-rule-item-r2").textContent).toContain(
      "row_count >= 100",
    );
    // 徽章取最新一条：r1（pass 覆盖更早的 fail）、r2（唯一一条 fail）
    expect(
      screen.getByTestId("quality-rule-result-badge-r1").getAttribute("data-status"),
    ).toBe("pass");
    expect(
      screen.getByTestId("quality-rule-result-badge-r2").getAttribute("data-status"),
    ).toBe("fail");
    // 结果列表在场（最近在前）
    const list = screen.getByTestId("quality-rules-results");
    expect(
      within(list)
        .getAllByTestId("quality-rule-result-row")
        .map((row) => row.getAttribute("data-rule-id")),
    ).toEqual(["r1", "r1", "r2"]);
    // 全部请求自动附 Bearer
    expect(backend.calls.length).toBeGreaterThan(0);
    expect(
      backend.calls.every((call) =>
        (call.headers["authorization"] ?? "").startsWith("Bearer "),
      ),
    ).toBe(true);
  });

  it("空态：无规则 → empty 提示；无结果 → results-empty（无结果列表）", async () => {
    installBackend({ rules: [], results: [] });
    render(<DatasetQualityRulesSection datasetId="ds-1" canEdit />);

    expect(await screen.findByTestId("quality-rules-empty")).toBeTruthy();
    expect(screen.getByTestId("quality-rules-results-empty")).toBeTruthy();
    expect(screen.queryByTestId("quality-rules-results")).toBeNull();
    // 添加表单在场（canEdit）
    expect(screen.getByTestId("quality-rule-add")).toBeTruthy();
  });

  it("错误态：GET 500 → 错误面 + 重试再拉；无加载残留", async () => {
    const backend = installBackend({ failRulesGetStatus: 500 });
    render(<DatasetQualityRulesSection datasetId="ds-1" canEdit />);

    expect(await screen.findByTestId("quality-rules-error")).toBeTruthy();
    expect(screen.queryByTestId("quality-rules-loading")).toBeNull();
    expect(screen.queryByTestId("quality-rule-add")).toBeNull();

    fireEvent.click(screen.getByTestId("quality-rules-retry"));
    await waitFor(() =>
      expect(callsOf(backend.calls, "GET", RULES_PATH).length).toBe(2),
    );
  });

  it("canEdit=false：只读——无添加/启停/删除/立即检查/改名入口，规则与徽章仍呈现", async () => {
    installBackend({
      rules: [makeRule({ id: "r1" })],
      results: [makeResult({ id: 101, rule_id: "r1" })],
    });
    render(<DatasetQualityRulesSection datasetId="ds-1" canEdit={false} />);

    await screen.findByTestId("quality-rule-item-r1");
    expect(screen.queryByTestId("quality-rule-add")).toBeNull();
    expect(screen.queryByTestId("quality-rule-metric")).toBeNull();
    expect(screen.queryByTestId("quality-rules-run")).toBeNull();
    expect(screen.queryByTestId("quality-rule-toggle-r1")).toBeNull();
    expect(screen.queryByTestId("quality-rule-delete-r1")).toBeNull();
    expect(screen.queryByTestId("quality-rule-rename-r1")).toBeNull();
    // 只读展示仍在：检查表达式 + 最新徽章 + 结果列表
    expect(screen.getByTestId("quality-rule-item-r1").textContent).toContain(
      "null_rate(age) <= 0.05",
    );
    expect(
      screen.getByTestId("quality-rule-result-badge-r1").getAttribute("data-status"),
    ).toBe("pass");
    expect(screen.getByTestId("quality-rules-results")).toBeTruthy();
  });
});

describe("DatasetQualityRulesSection 添加与删除（wire-quality-rules）", () => {
  it("添加流程：metric 选 null_rate → column 框出现；POST 契约载荷 → 列表刷新、表单复位", async () => {
    const backend = installBackend({ rules: [], results: [] });
    render(<DatasetQualityRulesSection datasetId="ds-1" canEdit />);
    await screen.findByTestId("quality-rules-empty");

    // row_count 默认无 column 框；切 null_rate 后出现
    expect(screen.queryByTestId("quality-rule-column")).toBeNull();
    fireEvent.change(screen.getByTestId("quality-rule-metric"), {
      target: { value: "null_rate" },
    });
    fireEvent.change(screen.getByTestId("quality-rule-column"), {
      target: { value: "age" },
    });
    fireEvent.change(screen.getByTestId("quality-rule-op"), {
      target: { value: "<=" },
    });
    fireEvent.change(screen.getByTestId("quality-rule-threshold"), {
      target: { value: "0.05" },
    });
    fireEvent.click(screen.getByTestId("quality-rule-add"));

    await waitFor(() =>
      expect(callsOf(backend.calls, "POST", RULES_PATH).length).toBe(1),
    );
    const post = callsOf(backend.calls, "POST", RULES_PATH)[0]!;
    expect(post.body).toEqual({
      check: { metric: "null_rate", column: "age", op: "<=", threshold: 0.05 },
    });
    expect(post.headers["authorization"]).toMatch(/^Bearer /);
    // 列表刷新：新规则出现（假后端分配 id=rule-1）
    const item = await screen.findByTestId("quality-rule-item-rule-1");
    expect(item.textContent).toContain("null_rate(age) <= 0.05");
    expect(screen.queryByTestId("quality-rules-empty")).toBeNull();
    // 表单复位（threshold 清空、metric 回 row_count → column 框收起）
    expect(
      (screen.getByTestId("quality-rule-threshold") as HTMLInputElement).value,
    ).toBe("");
    expect(screen.queryByTestId("quality-rule-column")).toBeNull();
  });

  it("value_violations：allowed 框逗号拆数组随载荷上行；422 后端 detail 原样呈现", async () => {
    const backend = installBackend({
      failAddStatus: 422,
      failAddDetail: "允许值个数须在 2-32 之间",
    });
    render(<DatasetQualityRulesSection datasetId="ds-1" canEdit />);
    await screen.findByTestId("quality-rules-empty");

    expect(screen.queryByTestId("quality-rule-allowed")).toBeNull();
    fireEvent.change(screen.getByTestId("quality-rule-metric"), {
      target: { value: "value_violations" },
    });
    fireEvent.change(screen.getByTestId("quality-rule-column"), {
      target: { value: "city" },
    });
    fireEvent.change(screen.getByTestId("quality-rule-threshold"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByTestId("quality-rule-allowed"), {
      target: { value: "北京, 上海，杭州" },
    });
    fireEvent.click(screen.getByTestId("quality-rule-add"));

    await waitFor(() =>
      expect(callsOf(backend.calls, "POST", RULES_PATH).length).toBe(1),
    );
    // 载荷：allowed 逗号/中文逗号拆分 + 去空白；op 默认 >=
    expect(callsOf(backend.calls, "POST", RULES_PATH)[0]!.body).toEqual({
      check: {
        metric: "value_violations",
        column: "city",
        op: ">=",
        threshold: 0,
        allowed: ["北京", "上海", "杭州"],
      },
    });
    // 422 detail 如实回显（apiErrorText 语义）
    const error = await screen.findByTestId("quality-rules-action-error");
    expect(error.textContent).toContain("允许值个数须在 2-32 之间");
    // 列表仍空（未误入新规则），按钮复位可重试
    expect(screen.getByTestId("quality-rules-empty")).toBeTruthy();
    expect(screen.getByTestId("quality-rule-add").hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("删除：confirm 用 removeConfirm 文案——确认后 DELETE → 列表刷新；取消不发", async () => {
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmMock);
    const backend = installBackend({ rules: [makeRule({ id: "r1" })], results: [] });
    render(<DatasetQualityRulesSection datasetId="ds-1" canEdit />);
    await screen.findByTestId("quality-rule-item-r1");

    // 取消：不发请求、规则保留
    vi.stubGlobal("confirm", vi.fn(() => false));
    fireEvent.click(screen.getByTestId("quality-rule-delete-r1"));
    expect(callsOf(backend.calls, "DELETE", `${RULES_PATH}/r1`).length).toBe(0);
    expect(screen.getByTestId("quality-rule-item-r1")).toBeTruthy();

    // 确认：confirm 收到 removeConfirm 文案
    vi.stubGlobal("confirm", confirmMock);
    fireEvent.click(screen.getByTestId("quality-rule-delete-r1"));
    expect(confirmMock).toHaveBeenCalledWith(
      "确定删除这条质量规则？（历史结果将保留）",
    );
    await waitFor(() =>
      expect(callsOf(backend.calls, "DELETE", `${RULES_PATH}/r1`).length).toBe(1),
    );
    expect(
      callsOf(backend.calls, "DELETE", `${RULES_PATH}/r1`)[0]!.headers[
        "authorization"
      ],
    ).toMatch(/^Bearer /);
    await waitFor(() =>
      expect(screen.queryByTestId("quality-rule-item-r1")).toBeNull(),
    );
    expect(screen.getByTestId("quality-rules-empty")).toBeTruthy();
  });
});

describe("DatasetQualityRulesSection 运行与启停/改名（wire-quality-rules）", () => {
  it("立即检查：POST run（Bearer）→ 用返回结果就地刷新（空态消失、徽章更新）", async () => {
    const backend = installBackend({ rules: [makeRule({ id: "r1" })], results: [] });
    render(<DatasetQualityRulesSection datasetId="ds-1" canEdit />);
    await screen.findByTestId("quality-rule-item-r1");
    expect(screen.getByTestId("quality-rules-results-empty")).toBeTruthy();

    fireEvent.click(screen.getByTestId("quality-rules-run"));
    await waitFor(() =>
      expect(callsOf(backend.calls, "POST", RUN_PATH).length).toBe(1),
    );
    expect(
      callsOf(backend.calls, "POST", RUN_PATH)[0]!.headers["authorization"],
    ).toMatch(/^Bearer /);
    // 结果就地刷新：新结果行出现、空态消失；徽章同步为 pass
    await screen.findByTestId("quality-rules-results");
    expect(screen.queryByTestId("quality-rules-results-empty")).toBeNull();
    expect(
      screen.getByTestId("quality-rule-result-badge-r1").getAttribute("data-status"),
    ).toBe("pass");
    await waitFor(() =>
      expect(screen.getByTestId("quality-rules-run").hasAttribute("disabled")).toBe(
        false,
      ),
    );
  });

  it("启停开关：点击 → PATCH {enabled:false} → 行态翻转、按钮文案切 disabled", async () => {
    const backend = installBackend({ rules: [makeRule({ id: "r1" })], results: [] });
    render(<DatasetQualityRulesSection datasetId="ds-1" canEdit />);
    await screen.findByTestId("quality-rule-item-r1");

    fireEvent.click(screen.getByTestId("quality-rule-toggle-r1"));
    await waitFor(() =>
      expect(callsOf(backend.calls, "PATCH", `${RULES_PATH}/r1`).length).toBe(1),
    );
    expect(
      callsOf(backend.calls, "PATCH", `${RULES_PATH}/r1`)[0]!.body,
    ).toEqual({ enabled: false });
    await waitFor(() =>
      expect(
        screen.getByTestId("quality-rule-item-r1").getAttribute("data-enabled"),
      ).toBe("false"),
    );
    expect(
      screen.getByTestId("quality-rule-toggle-r1").textContent,
    ).toBe("已停用");
  });

  it("行内改名：save → PATCH {name} 生效；cancel 不发请求", async () => {
    const backend = installBackend({ rules: [makeRule({ id: "r1" })], results: [] });
    render(<DatasetQualityRulesSection datasetId="ds-1" canEdit />);
    await screen.findByTestId("quality-rule-item-r1");

    // cancel：退出编辑、零 PATCH
    fireEvent.click(screen.getByTestId("quality-rule-rename-r1"));
    fireEvent.change(screen.getByTestId("quality-rule-name-input"), {
      target: { value: "年龄空值率" },
    });
    fireEvent.click(screen.getByTestId("quality-rule-name-cancel"));
    expect(screen.queryByTestId("quality-rule-name-input")).toBeNull();
    expect(callsOf(backend.calls, "PATCH", `${RULES_PATH}/r1`).length).toBe(0);

    // save：PATCH {name} → 行内呈现新名（检查表达式仍并列在场）
    fireEvent.click(screen.getByTestId("quality-rule-rename-r1"));
    fireEvent.change(screen.getByTestId("quality-rule-name-input"), {
      target: { value: "年龄空值率" },
    });
    fireEvent.click(screen.getByTestId("quality-rule-name-save"));
    await waitFor(() =>
      expect(callsOf(backend.calls, "PATCH", `${RULES_PATH}/r1`).length).toBe(1),
    );
    expect(
      callsOf(backend.calls, "PATCH", `${RULES_PATH}/r1`)[0]!.body,
    ).toEqual({ name: "年龄空值率" });
    await waitFor(() =>
      expect(screen.getByTestId("quality-rule-item-r1").textContent).toContain(
        "年龄空值率",
      ),
    );
    expect(screen.getByTestId("quality-rule-item-r1").textContent).toContain(
      "null_rate(age) <= 0.05",
    );
  });
});

describe("DatasetQualityRulesSection 结果呈现（wire-quality-rules）", () => {
  it("snapshot 通道结果显示基准时刻（basisAt）；query 通道不显示", async () => {
    installBackend({
      rules: [
        makeRule({ id: "r1", check: makeCheck() }),
        makeRule({
          id: "r2",
          check: makeCheck({ metric: "row_count", column: undefined, op: ">=", threshold: 10 }),
        }),
      ],
      results: [
        makeResult({
          id: 102,
          rule_id: "r2",
          observed: 12,
          channel: "snapshot",
          basis_at: "2026-10-12T08:00:00",
        }),
        makeResult({ id: 101, rule_id: "r1", channel: "query" }),
      ],
    });
    render(<DatasetQualityRulesSection datasetId="ds-1" canEdit />);

    const list = await screen.findByTestId("quality-rules-results");
    const rows = within(list).getAllByTestId("quality-rule-result-row");
    const snapshotRow = rows.find(
      (row) => row.getAttribute("data-rule-id") === "r2",
    )!;
    const queryRow = rows.find(
      (row) => row.getAttribute("data-rule-id") === "r1",
    )!;

    // snapshot：基准时刻在场（本地化含年份），observed vs threshold 并列
    const basis = within(snapshotRow).getByTestId("quality-rule-result-basis");
    expect(basis.textContent).toContain("2026");
    expect(snapshotRow.textContent).toContain("12");
    expect(snapshotRow.textContent).toContain("10");
    // query：无基准时刻
    expect(within(queryRow).queryByTestId("quality-rule-result-basis")).toBeNull();
  });

  it("error 态结果：徽章与结果行均为 error，error_text 摘要呈现", async () => {
    installBackend({
      rules: [makeRule({ id: "r1" })],
      results: [
        makeResult({
          id: 101,
          rule_id: "r1",
          status: "error",
          observed: null,
          element_count: null,
          unexpected_count: null,
          pass_rate: null,
          error_text: "engine timeout: quality tool exceeded 30s budget",
        }),
      ],
    });
    render(<DatasetQualityRulesSection datasetId="ds-1" canEdit />);

    await screen.findByTestId("quality-rule-item-r1");
    const badge = screen.getByTestId("quality-rule-result-badge-r1");
    expect(badge.getAttribute("data-status")).toBe("error");
    expect(badge.textContent).toContain("engine timeout");
    const row = within(screen.getByTestId("quality-rules-results"))
      .getAllByTestId("quality-rule-result-row")[0]!;
    expect(row.getAttribute("data-status")).toBe("error");
    expect(row.textContent).toContain("engine timeout");
  });
});

describe("纯逻辑：describeQualityCheck / latestResultFor / metricNeedsColumn", () => {
  it("describeQualityCheck：带列/不带列/value_violations 允许值清单", () => {
    expect(
      describeQualityCheck({ metric: "null_rate", column: "age", op: "<=", threshold: 0.05 }),
    ).toBe("null_rate(age) <= 0.05");
    expect(
      describeQualityCheck({ metric: "row_count", op: ">=", threshold: 100 }),
    ).toBe("row_count >= 100");
    expect(
      describeQualityCheck({
        metric: "value_violations",
        column: "city",
        op: ">",
        threshold: 0,
        allowed: ["北京", "上海"],
      }),
    ).toBe("value_violations(city) > 0 ∈ {北京, 上海}");
  });

  it("latestResultFor：同规则多条取 id 最大（最新）；无结果返回 null", () => {
    const results = [
      makeResult({ id: 1, rule_id: "r1", status: "fail" }),
      makeResult({ id: 2, rule_id: "r1", status: "pass" }),
      makeResult({ id: 3, rule_id: "r2", status: "fail" }),
    ];
    expect(latestResultFor(results, "r1")?.id).toBe(2);
    expect(latestResultFor(results, "r2")?.id).toBe(3);
    expect(latestResultFor(results, "r3")).toBeNull();
  });

  it("metricNeedsColumn：row_count/key_uniqueness 全表口径免列，其余必填", () => {
    expect(metricNeedsColumn("row_count")).toBe(false);
    expect(metricNeedsColumn("key_uniqueness")).toBe(false);
    expect(metricNeedsColumn("null_count")).toBe(true);
    expect(metricNeedsColumn("null_rate")).toBe(true);
    expect(metricNeedsColumn("filled_rate")).toBe(true);
    expect(metricNeedsColumn("value_violations")).toBe(true);
  });
});
