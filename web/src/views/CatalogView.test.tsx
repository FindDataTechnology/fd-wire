import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "../i18n";
import i18n, { switchLanguage } from "../i18n";
import { CatalogView } from "./CatalogView";
import { resetDomainsCacheForTests } from "../catalog/useDomains";
import {
  failingBackend,
  installFakeBackend,
  makeListItems,
  type FetchCall,
} from "../catalog/testing";
import type { IndicatorListItem } from "../catalog/api";

const THREE: IndicatorListItem[] = [
  {
    indicator_id: "ind-cpi",
    source_db: "gta",
    code: "CN_CPI_YOY",
    name_zh: "居民消费价格指数同比",
    name_en: "CPI YoY",
    domain: "macro",
    frequency: "月度",
    unit: null,
    status: "verified",
  },
  {
    indicator_id: "ind-pmi",
    source_db: "gta",
    code: "CN_PMI",
    name_zh: "制造业PMI",
    name_en: "Manufacturing PMI",
    domain: "macro",
    frequency: "月度",
    unit: null,
    status: "registered",
  },
  {
    indicator_id: "ind-coal",
    source_db: "world_bank",
    code: "CN_COAL",
    name_zh: null,
    name_en: "Coal Output",
    domain: "energy",
    frequency: "周度",
    unit: null,
    status: "registered",
  },
];

let calls: FetchCall[];

function install(items: IndicatorListItem[]): void {
  const backend = installFakeBackend(items);
  calls = backend.calls;
  vi.stubGlobal("fetch", backend.fetchImpl);
}

beforeEach(() => {
  resetDomainsCacheForTests();
  i18n.changeLanguage("zh");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CatalogView（公开目录列表）", () => {
  it("渲染列表：中文优先/英文兜底、code、域徽标、状态徽标语义分级", async () => {
    install(THREE);
    render(<CatalogView />);

    await screen.findByText("居民消费价格指数同比");
    // name_zh 缺失 → name_en 兜底
    expect(screen.getByText("Coal Output")).toBeTruthy();
    expect(screen.getByText("CN_CPI_YOY")).toBeTruthy();
    // 状态徽标：verified=绿「可直读」×1，registered=琥珀「按需开通」×2
    const statusTexts = () =>
      screen.getAllByTestId("status-badge").map((el) => el.textContent);
    expect(statusTexts().filter((s) => s?.includes("可直读")).length).toBe(1);
    expect(statusTexts().filter((s) => s?.includes("按需开通")).length).toBe(2);
    // 域徽标
    const domainTexts = screen
      .getAllByTestId("domain-badge")
      .map((el) => el.textContent);
    expect(domainTexts.length).toBe(3);
    expect(domainTexts.filter((s) => s === "energy").length).toBe(1);
    // 行点击 → 详情路由（indicator_id）
    expect(
      screen.getByRole("link", { name: /居民消费价格指数同比/ }).getAttribute("href"),
    ).toBe("#/catalog/ind-cpi");
  });

  it("关键词搜索防抖后带 q 参数；无结果显示空态", async () => {
    install(THREE);
    render(<CatalogView />);
    await screen.findByText("Coal Output");

    fireEvent.change(screen.getByLabelText("搜索"), { target: { value: "cpi" } });
    await waitFor(
      () => expect(calls.some((c) => c.url.searchParams.get("q") === "cpi")).toBe(true),
      { timeout: 2000 },
    );
    await waitFor(() => expect(screen.queryByText("Coal Output")).toBeNull());
    expect(screen.getByText("居民消费价格指数同比")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("搜索"), { target: { value: "zzz" } });
    const empty = await screen.findByTestId("catalog-empty", {}, { timeout: 2000 });
    expect(empty.textContent).toContain("没有匹配的指标");
  });

  it("status 与 domain 筛选下发参数并收窄结果", async () => {
    install(THREE);
    render(<CatalogView />);
    await screen.findByText("居民消费价格指数同比");

    fireEvent.change(screen.getByLabelText("状态"), { target: { value: "registered" } });
    await waitFor(() =>
      expect(calls.some((c) => c.url.searchParams.get("status") === "registered")).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText("居民消费价格指数同比")).toBeNull());
    expect(screen.getByText("制造业PMI")).toBeTruthy();

    // 域下拉选项由后台数据推导，出现后可选
    await screen.findByRole("option", { name: "energy" }, { timeout: 2000 });
    fireEvent.change(screen.getByLabelText("所属域"), { target: { value: "energy" } });
    await waitFor(() =>
      expect(calls.some((c) => c.url.searchParams.get("domain") === "energy")).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText("制造业PMI")).toBeNull());
    expect(screen.getByText("Coal Output")).toBeTruthy();
  });

  it("分页：下一页/上一页携带 page 参数", async () => {
    install(makeListItems(25));
    const { container } = render(<CatalogView />);

    await screen.findByText("共 25 条 · 第 1 / 2 页");
    expect(container.querySelectorAll("tbody tr").length).toBe(20);

    fireEvent.click(screen.getByText("下一页"));
    await waitFor(() =>
      expect(calls.some((c) => c.url.searchParams.get("page") === "2")).toBe(true),
    );
    await screen.findByText("共 25 条 · 第 2 / 2 页");
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(5));
    expect(screen.getByText("下一页").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("上一页").hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByText("上一页"));
    await screen.findByText("共 25 条 · 第 1 / 2 页");
  });

  it("API 不可达显示错误态，重试后恢复", async () => {
    vi.stubGlobal("fetch", failingBackend(503));
    render(<CatalogView />);
    const error = await screen.findByTestId("catalog-error");
    expect(error.textContent).toContain("目录服务暂时不可用");

    install(THREE); // 换成健康后端后重试
    fireEvent.click(screen.getByText("重试"));
    await screen.findByText("居民消费价格指数同比");
    expect(screen.queryByTestId("catalog-error")).toBeNull();
  });

  it("语言切换：状态徽标文案随 i18n 切换", async () => {
    install(THREE);
    render(<CatalogView />);
    await screen.findByText("居民消费价格指数同比");

    const badgeCount = (substr: string) =>
      screen
        .getAllByTestId("status-badge")
        .filter((el) => el.textContent?.includes(substr)).length;

    expect(badgeCount("可直读")).toBe(1);
    act(() => switchLanguage("en"));
    await waitFor(() => expect(badgeCount("Direct read")).toBe(1));
    expect(badgeCount("On demand")).toBe(2);
    expect(screen.getByRole("option", { name: "Direct read" })).toBeTruthy();

    act(() => switchLanguage("zh"));
    await waitFor(() => expect(badgeCount("可直读")).toBe(1));
  });
});
