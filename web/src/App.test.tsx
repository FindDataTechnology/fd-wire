import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { parseHash, isConsoleCallbackPath, App } from "./App";
import "./i18n";
import i18n from "./i18n";
import { installFakeBackend } from "./catalog/testing";
import { resetCatalogStatsCacheForTests } from "./catalog/useCatalogStats";
import { seedConsoleSession } from "./console/testing";

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

  it("控制台：默认 chat、四 tab、?c= 选中会话（非法值回落未选中）", () => {
    expect(parseHash("#/console")).toEqual({
      name: "console",
      tab: "chat",
      conversationId: null,
    });
    expect(parseHash("#/console/chat")).toEqual({
      name: "console",
      tab: "chat",
      conversationId: null,
    });
    expect(parseHash("#/console/chat?c=12")).toEqual({
      name: "console",
      tab: "chat",
      conversationId: 12,
    });
    expect(parseHash("#/console/chat?c=abc")).toEqual({
      name: "console",
      tab: "chat",
      conversationId: null,
    });
    expect(parseHash("#/console/artifacts")).toEqual({
      name: "console",
      tab: "artifacts",
      conversationId: null,
    });
    expect(parseHash("#/console/demands")).toEqual({
      name: "console",
      tab: "demands",
      conversationId: null,
    });
    expect(parseHash("#/console/usage")).toEqual({
      name: "console",
      tab: "usage",
      conversationId: null,
    });
    // 未知二级段回落默认 chat
    expect(parseHash("#/console/whatever")).toEqual({
      name: "console",
      tab: "chat",
      conversationId: null,
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
