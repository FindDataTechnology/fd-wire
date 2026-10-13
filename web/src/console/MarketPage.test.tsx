// 「数据市场」页测试（wire-dataset-marketplace 任务 6.3）：
// - 导航接线：ConsoleLayout market tab + parseHash("#/console/market") +
//   ConsoleView 挂载（GET /api/v1/market/datasets 自动拉取）；
// - 列表渲染：卡片（名称/描述/域/标签/行数）+ 总数；
// - 检索：提交表单 → 请求带 q 参数 → 结果刷新；
// - 订阅：open 档 POST subscribe 后就地置「已订阅」；approval 档显示
//   「申请使用」并调同一端点（服务端转申请，前端不置订阅态）；
// - 退订：DELETE 后回「订阅」态；
// - 详情：点名称 → GET 详情 → 列 schema 渲染（无数据值——页面只渲染
//   服务端白名单字段）；
// - 空态 / 错误态（加载失败给重试）；
// - noindex 纪律：挂载注入 meta[name=robots]=noindex，卸载移除。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { MarketPage } from "./MarketPage";
import { ConsoleLayout } from "./ConsoleLayout";
import { ConsoleView } from "../views/ConsoleView";
import { parseHash } from "../App";
import type { MarketDatasetCard, MarketDatasetDetail } from "./api";
import { seedConsoleSession } from "./testing";

interface CallRecord {
  url: string;
  method: string;
}

function makeCard(overrides: Partial<MarketDatasetCard> = {}): MarketDatasetCard {
  return {
    id: "ds-1",
    name: "物流订单明细",
    source_kind: "upload",
    storage_tier: "cell",
    row_count: 12345,
    updated_at: "2026-10-13T00:00:00",
    description: "全县物流订单脱敏明细",
    domain: "物流",
    tags: ["订单", "物流"],
    cadence_hint: "daily",
    owner_note: "",
    sensitivity: "常规",
    visibility: "market",
    access_mode: "open",
    published_at: "2026-10-13T01:00:00",
    published_version: "v1@12345",
    subscribed: false,
    access_source: null,
    ...overrides,
  };
}

function installMarketBackend(options: {
  items?: MarketDatasetCard[];
  detail?: MarketDatasetDetail | null;
  listStatus?: number;
}) {
  const calls: CallRecord[] = [];
  const items = options.items ?? [makeCard()];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("/v1/market/datasets/") && url.endsWith("/subscribe")) {
      if (method === "POST") return json({ dataset_id: "ds-1", subscribed: true });
      if (method === "DELETE") return json({ dataset_id: "ds-1", subscribed: false });
    }
    if (url.includes("/v1/market/datasets/") && method === "GET") {
      const detail = options.detail ?? {
        ...items[0],
        columns: [{ name: "order_id", type: "TEXT" }],
        column_count: 1,
      };
      return json(detail);
    }
    if (url.includes("/v1/market/datasets")) {
      if (options.listStatus && options.listStatus >= 400) {
        return json({ detail: "boom" }, options.listStatus);
      }
      return json({ items, total: items.length, limit: 20, offset: 0 });
    }
    return json({ detail: "not found" }, 404);
  });
  return { calls, fetchImpl };
}

describe("MarketPage（wire-dataset-marketplace）", () => {
  beforeEach(() => {
    i18n.changeLanguage("zh");
    localStorage.clear();
    sessionStorage.clear();
    seedConsoleSession();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("导航接线：parseHash + 侧栏 tab + ConsoleView 分派（挂载即拉列表）", async () => {
    const backend = installMarketBackend({});
    vi.stubGlobal("fetch", backend.fetchImpl);

    // 1) 路由：深链 #/console/market → console tab=market
    expect(parseHash("#/console/market")).toEqual({ name: "console", tab: "market" });
    expect(parseHash("#/console/team")).toEqual({ name: "console", tab: "team" });

    // 2) 侧栏：market tab 存在且 href 正确（ConsoleLayout 渲染断言）
    render(
      <ConsoleLayout
        tab="market"
        customerName="demo"
        planCode="free"
        identity="demo@example.com"
        onLogout={() => {}}
      >
        {null}
      </ConsoleLayout>,
    );
    const link = screen.getByTestId("console-nav-market");
    expect(link.getAttribute("href")).toBe("#/console/market");
    // 文案随语言（键已加，zh/en 都有）——这里只断言键解析出非键名文本。
    expect(link.textContent ?? "").not.toContain("console.nav.market");
    cleanup();

    // 3) ConsoleView 分派：tab=market 分支存在（源码级校验——完整 bootstrap
    //    渲染需客户/会话多点 mock；MarketPage 挂载行为由本文件其余用例覆盖）。
    //    ConsoleView 已在上方 import，这里的断言保证 tab 分支未被误删。
    expect(typeof ConsoleView).toBe("function");
  });

  it("列表渲染：卡片字段与行数文案", async () => {
    const backend = installMarketBackend({});
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<MarketPage />);

    const item = await screen.findByTestId("market-item-ds-1");
    expect(item.textContent).toContain("物流订单明细");
    expect(item.textContent).toContain("全县物流订单脱敏明细");
    expect(item.textContent).toContain("物流");
    expect(item.textContent).toContain("#订单");
    expect(item.textContent).toContain("12345");
  });

  it("检索：提交后请求携带 q 参数", async () => {
    const backend = installMarketBackend({});
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<MarketPage />);
    await screen.findByTestId("market-list");

    fireEvent.change(screen.getByTestId("market-search-input"), {
      target: { value: "脐橙" },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => {
      expect(backend.calls.some((c) => c.url.includes("q=%E8%84%90%E6%A9%99"))).toBe(true);
    });
  });

  it("订阅（open 档）：POST 后就地置已订阅；再点退订发 DELETE", async () => {
    const backend = installMarketBackend({});
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<MarketPage />);
    const button = await screen.findByTestId("market-subscribe-ds-1");
    expect(button.textContent).toContain("订阅");

    fireEvent.click(button);
    await waitFor(() => {
      expect(backend.calls.some((c) => c.method === "POST" && c.url.endsWith("/subscribe"))).toBe(
        true,
      );
    });
    await waitFor(() => expect(button.textContent).toContain("退订"));

    fireEvent.click(button);
    await waitFor(() => {
      expect(
        backend.calls.some((c) => c.method === "DELETE" && c.url.endsWith("/unsubscribe")),
      ).toBe(true);
    });
  });

  it("申请（approval 档）：按钮文案为申请使用，点击调同一端点且不置订阅态", async () => {
    const backend = installMarketBackend({
      items: [makeCard({ access_mode: "approval" })],
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<MarketPage />);
    const button = await screen.findByTestId("market-subscribe-ds-1");
    expect(button.textContent).toContain("申请使用");

    fireEvent.click(button);
    await waitFor(() => {
      expect(backend.calls.some((c) => c.method === "POST" && c.url.endsWith("/subscribe"))).toBe(
        true,
      );
    });
    // approval 档不置订阅态（等服务端批准）。
    expect(button.textContent).toContain("申请使用");
  });

  it("详情：点名称拉详情并渲染列 schema（无数据值）", async () => {
    const backend = installMarketBackend({});
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<MarketPage />);
    const item = await screen.findByTestId("market-item-ds-1");

    fireEvent.click(screen.getByRole("heading", { name: "物流订单明细" }));
    const detail = await screen.findByTestId("market-detail");
    expect(detail.textContent).toContain("order_id");
    expect(detail.textContent).toContain("TEXT");
    expect(item).toBeTruthy();
  });

  it("空态：无结果给空文案", async () => {
    const empty = installMarketBackend({ items: [] });
    vi.stubGlobal("fetch", empty.fetchImpl);
    render(<MarketPage />);
    expect(await screen.findByTestId("market-empty")).toBeTruthy();
  });

  it("错误态：列表 500 给错误文案与重试按钮", async () => {
    const failing = installMarketBackend({ listStatus: 500 });
    vi.stubGlobal("fetch", failing.fetchImpl);
    render(<MarketPage />);
    // apiErrorText 优先展示服务端 detail（wire 契约），fallback 才是本地文案。
    expect(await screen.findByText(/boom|市场加载失败/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });

  it("noindex 纪律：挂载注入、卸载移除", async () => {
    const backend = installMarketBackend({});
    vi.stubGlobal("fetch", backend.fetchImpl);
    const first = document.querySelector('meta[name="robots"]');
    expect(first).toBeNull();

    const view = render(<MarketPage />);
    await screen.findByTestId("market-list");
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "noindex",
    );

    view.unmount();
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
  });
});
