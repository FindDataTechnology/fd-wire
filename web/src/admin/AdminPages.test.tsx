// 账本 / 目录治理 / 用量分轨三页组件测试（任务 7.1）+ #/admin 路由解析。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { parseHash } from "../App";
import { LedgerPage } from "./LedgerPage";
import { CatalogGovernancePage } from "./CatalogGovernancePage";
import { UsageOverviewPage } from "./UsageOverviewPage";
import { installAdminBackend } from "./testing";
import type { AdminCustomer, LedgerEntry } from "./api";

const TOKEN = "test-admin-token";

const CUSTOMERS: AdminCustomer[] = [
  {
    id: 1,
    name: "上海壹座",
    sub2api_user_id: "acme-caller",
    plan_id: 1,
    plan_code: "starter",
    plan_name: "起步版",
    status: "active",
    created_at: "2026-10-01T08:00:00",
  },
  {
    id: 2,
    name: "萬星數據",
    sub2api_user_id: "wanxing-caller",
    plan_id: 2,
    plan_code: "professional",
    plan_name: "专业版",
    status: "active",
    created_at: "2026-10-02T08:00:00",
  },
];

const LEDGER: LedgerEntry[] = [
  {
    id: 1,
    customer_id: 1,
    kind: "grant",
    quantity: 500_000,
    amount_micro: 1_999_000_000,
    amount_yuan: "1999.00",
    amount_yuan_str: "¥1,999.00",
    period: "2026-09",
    idempotency_key: "grant:1:2026-09",
    source_ref: null,
    sub2api_applied: false,
    created_at: "2026-09-01T00:05:00",
  },
  {
    id: 2,
    customer_id: 1,
    kind: "overage",
    quantity: 1_200,
    amount_micro: 4_800_000,
    amount_yuan: "4.80",
    amount_yuan_str: "¥4.80",
    period: "2026-10",
    idempotency_key: "settle:2026-10:period:1",
    source_ref: null,
    sub2api_applied: true,
    created_at: "2026-10-01T00:05:00",
  },
  {
    id: 3,
    customer_id: 2,
    kind: "adjustment",
    quantity: 0,
    amount_micro: -500_000,
    amount_yuan: "-0.50",
    amount_yuan_str: "¥-0.50",
    period: "2026-10",
    idempotency_key: "adjust:2:2026-10:ref-77",
    source_ref: "ref-77",
    sub2api_applied: false,
    created_at: "2026-10-02T09:00:00",
  },
];

beforeEach(() => {
  i18n.changeLanguage("zh");
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("LedgerPage（账本流水）", () => {
  it("流水渲染：kind 徽标着色、金额展示、按客户过滤 + 用量摘要", async () => {
    const backend = installAdminBackend({
      customers: CUSTOMERS,
      ledger: LEDGER,
      adminToken: TOKEN,
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<LedgerPage token={TOKEN} />);

    const rows = await screen.findAllByTestId("admin-ledger-row");
    expect(rows.length).toBe(3);
    const kinds = screen
      .getAllByTestId("admin-ledger-kind-badge")
      .map((el) => el.getAttribute("data-kind"));
    expect(kinds).toEqual(["grant", "overage", "adjustment"]);
    // kind 徽标语义着色（不同 kind 不同色类）
    const grantBadge = screen.getAllByTestId("admin-ledger-kind-badge")[0]!;
    const overageBadge = screen.getAllByTestId("admin-ledger-kind-badge")[1]!;
    expect(grantBadge.className).not.toBe(overageBadge.className);
    expect(screen.getAllByTestId("admin-ledger-amount")[0]!.textContent).toBe(
      "¥1,999.00",
    );

    // 按客户过滤：查询形状 + 该客户用量摘要（caller 联查）
    fireEvent.change(screen.getByTestId("ledger-customer-filter"), {
      target: { value: "1" },
    });
    await waitFor(() => {
      expect(screen.getAllByTestId("admin-ledger-row").length).toBe(2);
    });
    const ledgerCall = backend.calls
      .filter((c) => c.url.pathname === "/internal/admin/ledger")
      .pop()!;
    expect(ledgerCall.url.searchParams.get("customer_id")).toBe("1");
    expect(await screen.findByTestId("ledger-usage-summary")).toBeTruthy();
    expect(screen.getByTestId("ledger-usage-summary").textContent).toContain(
      "上海壹座",
    );
    expect(screen.getByTestId("ledger-usage-summary").textContent).toContain(
      "acme-caller",
    );
  });

  it("周期过滤查询形状（?period=）与空态", async () => {
    const backend = installAdminBackend({
      customers: [],
      ledger: [],
      adminToken: TOKEN,
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<LedgerPage token={TOKEN} />);
    expect(await screen.findByTestId("admin-ledger-empty")).toBeTruthy();

    fireEvent.change(screen.getByTestId("ledger-period-filter"), {
      target: { value: "2026-10" },
    });
    await waitFor(() => {
      const call = backend.calls
        .filter((c) => c.url.pathname === "/internal/admin/ledger")
        .pop()!;
      expect(call.url.searchParams.get("period")).toBe("2026-10");
    });
  });
});

describe("CatalogGovernancePage（目录治理）", () => {
  it("registered 列表 + 只读标注 + 审核意见录入调用形状与追加展示", async () => {
    const backend = installAdminBackend({ adminToken: TOKEN });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<CatalogGovernancePage token={TOKEN} />);

    const items = await screen.findAllByTestId("admin-catalog-item");
    expect(items.length).toBe(1);
    // 只读纪律如实标注
    expect(screen.getByTestId("admin-catalog-readonly-note").textContent).toContain(
      "权威库",
    );

    fireEvent.click(screen.getByTestId("admin-catalog-notes-toggle"));
    expect(screen.getByTestId("admin-catalog-note-input")).toBeTruthy();

    fireEvent.change(screen.getByTestId("admin-catalog-note-input"), {
      target: { value: "口径核对通过，待权威库复核" },
    });
    fireEvent.click(screen.getByTestId("admin-catalog-note-submit"));

    await waitFor(() => {
      expect(screen.getAllByTestId("admin-catalog-note-item").length).toBe(1);
    });
    expect(screen.getByTestId("admin-catalog-note-item").textContent).toContain(
      "口径核对通过",
    );

    const noteCall = backend.calls.find((c) => c.method === "POST")!;
    expect(noteCall.url.pathname).toBe(
      "/internal/admin/catalog/ind-reg-1/verify-note",
    );
    expect(noteCall.headers["x-admin-token"]).toBe(TOKEN);
    expect(noteCall.body).toEqual({
      note: "口径核对通过，待权威库复核",
      author: "admin-console",
    });
  });
});

describe("UsageOverviewPage（用量分轨）", () => {
  it("两轨数字卡 + 来源分布 + 轨道过滤查询形状", async () => {
    const backend = installAdminBackend({
      adminToken: TOKEN,
      tracks: [
        { key: "customer", calls: 12, rows: 3400 },
        { key: "platform", calls: 5, rows: 800 },
      ],
      bySource: [
        { key: "yizuo", calls: 8, rows: 2600 },
        { key: "wanxing", calls: 4, rows: 800 },
        { key: "platform-internal", calls: 5, rows: 800 },
      ],
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<UsageOverviewPage token={TOKEN} />);

    expect(await screen.findByTestId("admin-usage-card-customer")).toBeTruthy();
    expect(screen.getByTestId("admin-usage-card-customer-rows").textContent).toBe(
      "3,400",
    );
    expect(screen.getByTestId("admin-usage-card-platform-rows").textContent).toBe(
      "800",
    );
    const sources = screen
      .getAllByTestId("admin-usage-source-row")
      .map((el) => el.textContent);
    expect(sources.length).toBe(3);
    expect(sources[0]).toContain("壹座");
    expect(sources[2]).toContain("平台内部");

    fireEvent.change(screen.getByTestId("usage-track-filter"), {
      target: { value: "customer" },
    });
    await waitFor(() => {
      const call = backend.calls
        .filter((c) => c.url.pathname === "/internal/admin/usage/overview")
        .pop()!;
      expect(call.url.searchParams.get("credential_track")).toBe("customer");
    });
  });

  it("鉴权失败态如实呈现（401）", async () => {
    vi.stubGlobal(
      "fetch",
      installAdminBackend({ forceStatus: 401 }).fetchImpl,
    );
    render(<UsageOverviewPage token={TOKEN} />);
    expect(await screen.findByTestId("admin-auth-error")).toBeTruthy();
  });
});

describe("#/admin 路由解析", () => {
  it("五段解析与未知段回落客户页", () => {
    expect(parseHash("#/admin")).toEqual({ name: "admin", section: "customers" });
    expect(parseHash("#/admin/customers")).toEqual({
      name: "admin",
      section: "customers",
    });
    expect(parseHash("#/admin/ledger")).toEqual({ name: "admin", section: "ledger" });
    expect(parseHash("#/admin/demands")).toEqual({
      name: "admin",
      section: "demands",
    });
    expect(parseHash("#/admin/catalog")).toEqual({
      name: "admin",
      section: "catalog",
    });
    expect(parseHash("#/admin/usage")).toEqual({ name: "admin", section: "usage" });
    expect(parseHash("#/admin/whatever")).toEqual({
      name: "admin",
      section: "customers",
    });
  });
});
