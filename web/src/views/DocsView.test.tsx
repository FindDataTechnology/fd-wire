import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { parseHash } from "../App";
import { DocsView, MCP_ENDPOINT } from "./DocsView";

beforeEach(() => i18n.changeLanguage("zh"));
afterEach(cleanup);

describe("DocsView（文档三节 · 如实呈现）", () => {
  it("三节结构：快速开始 / 计量与计费 / 需求单流程", () => {
    render(<DocsView />);

    expect(screen.getByText("快速开始")).toBeTruthy();
    expect(screen.getByText("计量与计费")).toBeTruthy();
    expect(screen.getByText("需求单流程")).toBeTruthy();
  });

  it("快速开始：MCP 端点占位 + 密钥调用示意（密钥管理指控制台）", () => {
    render(<DocsView />);

    expect(screen.getByTestId("mcp-endpoint").textContent).toBe(MCP_ENDPOINT);
    expect(screen.getByText(/控制台「密钥管理」/)).toBeTruthy();
    expect(screen.getByText(/Authorization: Bearer/)).toBeTruthy();
  });

  it("计量与计费四要点：按行 / AI 探索不计费 / 两档预警 / 硬停", () => {
    render(<DocsView />);

    expect(screen.getByText("按行计量")).toBeTruthy();
    expect(screen.getByText("AI 探索不计费")).toBeTruthy();
    expect(screen.getByText(/80% 与 95%/)).toBeTruthy();
    expect(screen.getByText(/fail-closed 硬停/)).toBeTruthy();
  });

  it("需求单八态：七个主步骤 + 拒绝分支说明", () => {
    render(<DocsView />);

    for (const label of [
      "已提交",
      "评估中",
      "已报价",
      "待确认",
      "构建中",
      "交付验收",
      "已交付",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // 第八态：已拒绝（分支留档说明）
    expect(screen.getByText(/「已拒绝」/)).toBeTruthy();
    expect(screen.getAllByTestId(/^demand-step-/)).toHaveLength(7);
  });

  it("「上线中」徽标存在：控制台分析构建 / cell 开通 / 需求单提交", () => {
    render(<DocsView />);

    const badges = screen.getAllByTestId("coming-soon-badge");
    expect(badges.length).toBeGreaterThanOrEqual(3);
    for (const b of badges) {
      expect(b.textContent).toContain("上线中");
    }
    expect(screen.getByText("控制台分析构建")).toBeTruthy();
    expect(screen.getByText(/cell 开通/)).toBeTruthy();
    expect(screen.getByText("需求单提交")).toBeTruthy();
  });

  it("路由：#/docs 解析为 docs（未登录可访问）", () => {
    expect(parseHash("#/docs")).toEqual({ name: "docs" });
  });
});
