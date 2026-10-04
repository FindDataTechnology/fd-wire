import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { parseHash } from "../App";
import { HomeView } from "./HomeView";

beforeEach(() => i18n.changeLanguage("zh"));
afterEach(cleanup);

describe("HomeView（官网首页 · 柏讯产品叙事）", () => {
  it("hero 与三条价值主张（57,000+ 目录 / MCP 直连 / AI+需求闭环）", () => {
    render(<HomeView />);

    expect(screen.getByText("柏讯 Wire · B2B 数据平台")).toBeTruthy();
    expect(screen.getByText("57,000+ 指标目录")).toBeTruthy();
    expect(screen.getByText("MCP 直连数据")).toBeTruthy();
    expect(screen.getByText("AI 构建分析与爬虫需求闭环")).toBeTruthy();
    // 五线站位一句（不展开叙事）
    expect(screen.getByText(/壹座之上、萬星闪耀/)).toBeTruthy();
  });

  it("CTA：浏览指标目录 → #/catalog；联系开通 → mailto 占位", () => {
    render(<HomeView />);

    expect(
      screen.getByTestId("home-cta-catalog").getAttribute("href"),
    ).toBe("#/catalog");
    expect(
      screen.getByTestId("home-cta-contact").getAttribute("href"),
    ).toMatch(/^mailto:/);
  });

  it("路由：#/ 归首页，首页无需登录即可渲染", () => {
    expect(parseHash("#/")).toEqual({ name: "home" });
    // 未登录环境（无任何凭据存储）直接渲染成功即代表可访问
    render(<HomeView />);
    expect(screen.getByTestId("home-cta-catalog")).toBeTruthy();
  });
});
