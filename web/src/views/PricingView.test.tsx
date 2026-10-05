import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { parseHash } from "../App";
import { PricingView } from "./PricingView";
import { installFakeBackend } from "../catalog/testing";
import { resetCatalogStatsCacheForTests } from "../catalog/useCatalogStats";

const STATS = {
  registered: 57553,
  verified: 3421,
  by_source: [{ source_db: "world_bank", registered: 12000, verified: 800 }],
};

beforeEach(() => {
  i18n.changeLanguage("zh");
  resetCatalogStatsCacheForTests();
  // 缺省打上 stats 不可用的假后端（回退文案路径）；活数用例内自行重打
  const backend = installFakeBackend([], {}, null);
  vi.stubGlobal("fetch", backend.fetchImpl);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PricingView（定价三档 · design.md 已裁决口径）", () => {
  it("三档价格与包含行数、超额阶梯单价", () => {
    render(<PricingView />);

    // 三档价格
    expect(screen.getByText("¥1,999")).toBeTruthy();
    expect(screen.getByText("¥6,999")).toBeTruthy();
    expect(screen.getByText("¥19,999")).toBeTruthy();
    // 包含行数
    expect(screen.getByText("含 50 万行/月")).toBeTruthy();
    expect(screen.getByText("含 300 万行/月")).toBeTruthy();
    expect(screen.getByText("含 1,200 万行/月")).toBeTruthy();
    // 超额阶梯 ¥0.004 / ¥0.003 / ¥0.002 每行
    expect(screen.getByText("超额 ¥0.004/行")).toBeTruthy();
    expect(screen.getByText("超额 ¥0.003/行")).toBeTruthy();
    expect(screen.getByText("超额 ¥0.002/行")).toBeTruthy();
  });

  it("中档（专业版）标「推荐」，入门/企业档无此徽标", () => {
    render(<PricingView />);

    const pro = screen.getByTestId("tier-pro");
    expect(within(pro).getByText("专业版")).toBeTruthy();
    expect(within(pro).getByText("推荐")).toBeTruthy();
    expect(within(screen.getByTestId("tier-starter")).queryByText("推荐")).toBeNull();
    expect(
      within(screen.getByTestId("tier-enterprise")).queryByText("推荐"),
    ).toBeNull();
  });

  it("脚注：需求单独立报价、法律域默认询价；CTA 为 mailto 占位", () => {
    render(<PricingView />);

    expect(screen.getByText(/数据需求单独立报价/)).toBeTruthy();
    expect(screen.getByText(/法律域数据默认询价开通/)).toBeTruthy();
    const cta = screen.getAllByText("联系开通")[0].closest("a");
    expect(cta?.getAttribute("href")).toMatch(/^mailto:/);
  });

  it("目录规模数字活取 stats（57,553 → 「57,000+ 指标目录全量浏览」）", async () => {
    const backend = installFakeBackend([], {}, STATS);
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<PricingView />);

    // 功能列表随三档卡片各渲染一次
    const live = await screen.findAllByText("57,000+ 指标目录全量浏览");
    expect(live.length).toBe(3);
    // 其余功能项不受影响
    expect(screen.getAllByText("MCP 直连数据读取").length).toBe(3);
  });

  it("stats 不可用 → 功能列表回退不带数字文案", () => {
    render(<PricingView />);

    const fallback = screen.getAllByText("指标目录全量浏览");
    expect(fallback.length).toBe(3);
    expect(screen.queryByText(/57,000/)).toBeNull();
  });

  it("路由：#/pricing 解析为 pricing（未登录可访问）", () => {
    expect(parseHash("#/pricing")).toEqual({ name: "pricing" });
  });
});
