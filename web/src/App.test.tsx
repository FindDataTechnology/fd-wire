import { describe, expect, it } from "vitest";
import { parseHash } from "./App";

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
