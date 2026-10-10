import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { parseHash, isConsoleCallbackPath, App } from "./App";
import "./i18n";
import i18n from "./i18n";
import { installFakeBackend } from "./catalog/testing";
import { resetCatalogStatsCacheForTests } from "./catalog/useCatalogStats";
import { installConsoleBackend, seedConsoleSession } from "./console/testing";

describe("parseHash（hash 路由解析）", () => {
  it("空 / 首页 / 未知路径 → home", () => {
    expect(parseHash("")).toEqual({ name: "home" });
    expect(parseHash("#/")).toEqual({ name: "home" });
    expect(parseHash("#/unknown/path")).toEqual({ name: "home" });
  });

  it("目录列表与详情", () => {
    expect(parseHash("#/catalog")).toEqual({ name: "catalog" });
    expect(parseHash("#/catalog/ind-001")).toEqual({
      name: "catalogDetail",
      id: "ind-001",
    });
    expect(parseHash("#/catalog/a%2Fb")).toEqual({ name: "catalogDetail", id: "a/b" });
  });

  it("控制台：默认 datasets、六 tab、未知段回落 datasets（wire-ux-consolidation 2.2）", () => {
    expect(parseHash("#/console")).toEqual({
      name: "console",
      tab: "datasets",
    });
    expect(parseHash("#/console/chat")).toEqual({
      name: "console",
      tab: "chat",
    });
    // 旧深链 ?c=<id> 被忽略（对话页退役），仍落 chat tab（壹座引导卡）。
    expect(parseHash("#/console/chat?c=12")).toEqual({
      name: "console",
      tab: "chat",
    });
    expect(parseHash("#/console/artifacts")).toEqual({
      name: "console",
      tab: "artifacts",
    });
    expect(parseHash("#/console/datasets")).toEqual({
      name: "console",
      tab: "datasets",
    });
    expect(parseHash("#/console/demands")).toEqual({
      name: "console",
      tab: "demands",
    });
    expect(parseHash("#/console/usage")).toEqual({
      name: "console",
      tab: "usage",
    });
    // 未知二级段回落默认 datasets
    expect(parseHash("#/console/whatever")).toEqual({
      name: "console",
      tab: "datasets",
    });
  });

  it("控制台 / 需求单占位（预填指标）/ 登录", () => {
    expect(parseHash("#/console/demands/new?indicator=CN_COAL")).toEqual({
      name: "demandNew",
      indicator: "CN_COAL",
    });
    expect(parseHash("#/console/demands/new")).toEqual({
      name: "demandNew",
      indicator: null,
    });
    expect(parseHash("#/login")).toEqual({ name: "login" });
  });

  it("公开分享深链（wire-dashboard-share）：id/t/v 齐全解析；t/v 缺失为 null", () => {
    expect(parseHash("#/share/dashboard/11?t=tok-abc&v=3")).toEqual({
      name: "shareDashboard",
      id: "11",
      token: "tok-abc",
      version: "3",
    });
    // 缺 t/v（接收者手改链接）：token/version 如实为 null，ShareView 落无效页
    expect(parseHash("#/share/dashboard/11")).toEqual({
      name: "shareDashboard",
      id: "11",
      token: null,
      version: null,
    });
    // 缺 id 段不构成分享路由，回落首页
    expect(parseHash("#/share/dashboard")).toEqual({ name: "home" });
    expect(parseHash("#/share/other/11?t=x")).toEqual({ name: "home" });
  });
});

describe("App shell（admin 导航按角色显隐 · Logto 回调真实路径）", () => {
  beforeEach(() => {
    i18n.changeLanguage("zh");
    resetCatalogStatsCacheForTests();
    sessionStorage.clear();
    window.location.hash = "";
    // App 渲染含首页（活取 stats）——打上 stats 不可用的假后端（零网络）
    vi.stubGlobal("fetch", installFakeBackend([], {}, null).fetchImpl);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    window.location.hash = "";
  });

  it("isConsoleCallbackPath：/console/callback 命中（容忍尾斜杠），其余真实路径不命中", () => {
    expect(isConsoleCallbackPath("/console/callback")).toBe(true);
    expect(isConsoleCallbackPath("/console/callback/")).toBe(true);
    expect(isConsoleCallbackPath("/")).toBe(false);
    expect(isConsoleCallbackPath("/console")).toBe(false);
  });

  it("无会话/普通客户：导航不渲染「内部后台」入口；wire-admin 会话才渲染", () => {
    // 无会话
    const { unmount } = render(<App />);
    expect(screen.queryByTestId("nav-admin")).toBeNull();
    unmount();
    cleanup();
    sessionStorage.clear();
    // 普通客户（无 wire-admin 角色）
    seedConsoleSession({ sub: "plain-customer", roles: [] });
    const { unmount: unmount2 } = render(<App />);
    expect(screen.queryByTestId("nav-admin")).toBeNull();
    unmount2();
    cleanup();
    sessionStorage.clear();
    // wire-admin 会话：入口渲染（路由直达另有 AdminView 角色门禁兜底）
    seedConsoleSession({ sub: "admin", roles: ["wire-admin"] });
    render(<App />);
    expect(screen.getByTestId("nav-admin").getAttribute("href")).toBe("#/admin");
  });
});

describe("App 页脚分发（wire-ux-consolidation 任务 1.2）", () => {
  beforeEach(() => {
    i18n.changeLanguage("zh");
    resetCatalogStatsCacheForTests();
    localStorage.clear();
    sessionStorage.clear();
    window.location.hash = "";
    // 门户页含目录/定价活取——打上不可用假后端（零网络，回退态不碍页脚断言）。
    vi.stubGlobal("fetch", installFakeBackend([], {}, null).fetchImpl);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    window.location.hash = "";
  });

  it("四门户视图（首页/定价/文档/指标目录）挂全量页脚", () => {
    for (const hash of ["#/", "#/pricing", "#/docs", "#/catalog"]) {
      window.location.hash = hash;
      const { unmount } = render(<App />);
      expect(screen.getByTestId("site-footer")).toBeTruthy();
      expect(screen.getByTestId("footer-service-official")).toBeTruthy();
      expect(screen.queryByTestId("console-footer")).toBeNull();
      unmount();
      cleanup();
      resetCatalogStatsCacheForTests();
    }
  });

  it("#/console 挂紧凑页脚（单行版权+备案，无跨服务行/GitHub）", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", installConsoleBackend([]).fetchImpl);
    window.location.hash = "#/console";
    render(<App />);
    expect(screen.getByTestId("console-footer")).toBeTruthy();
    expect(screen.getByTestId("footer-icp").textContent).toBe(
      "粤ICP备2026118740号-1",
    );
    expect(screen.queryByTestId("site-footer")).toBeNull();
    expect(screen.queryAllByTestId(/^footer-service-/)).toEqual([]);
    expect(screen.queryByTestId("footer-github")).toBeNull();
  });

  it("#/admin 不渲染页脚", () => {
    window.location.hash = "#/admin";
    render(<App />);
    expect(screen.getByTestId("admin-role-gate")).toBeTruthy();
    expect(screen.queryByTestId("site-footer")).toBeNull();
    expect(screen.queryByTestId("console-footer")).toBeNull();
  });
});

describe("App 公开分享壳（wire-dashboard-share）", () => {
  beforeEach(() => {
    i18n.changeLanguage("zh");
    resetCatalogStatsCacheForTests();
    localStorage.clear();
    sessionStorage.clear();
    window.location.hash = "";
    document.title = "柏讯 Wire — B2B 数据平台";
    // 分享页调公开端点（无鉴权）——404 即「链接无效」态，零依赖。
    vi.stubGlobal(
      "fetch",
      (() =>
        Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ detail: "not found" }),
        } as unknown as Response)) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    window.location.hash = "";
  });

  it("#/share/dashboard/* 渲染独立极简壳：品牌锁定顶栏在，站点导航/页脚不渲染", async () => {
    window.location.hash = "#/share/dashboard/9?t=tok&v=2";
    // 无登录会话（分享页免登录红线）
    render(<App />);

    expect(await screen.findByTestId("share-invalid")).toBeTruthy();
    // 品牌锁定（wire-share-branding）：寻数·柏讯 + Wire 双语并呈
    expect(screen.getByTestId("share-topbar").textContent).toContain(
      "寻数·柏讯",
    );
    expect(screen.getByTestId("share-topbar").textContent).toContain("Wire");
    // 独立成壳：不进站点 header/footer，也无控制台布局
    expect(screen.queryByTestId("site-footer")).toBeNull();
    expect(screen.queryByTestId("console-footer")).toBeNull();
    // 标题前缀与 noindex 红线在 App 壳层同样生效
    expect(document.title).toContain("分享 · ");
    expect(
      document
        .querySelector('meta[name="robots"]')
        ?.getAttribute("content"),
    ).toBe("noindex");
  });
});
