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
    // 硬停语义与四档口径联动（wire-self-serve-launch 7.4）：耗尽即停、次月自动恢复
    const hardStop = screen.getByText(/fail-closed 硬停/);
    expect(hardStop.textContent).toContain("次月自动恢复");
  });

  it("计费说明与定价页联动：四档口径 + pricingNote 链接 #/pricing", () => {
    render(<DocsView />);

    const pricingNote = screen.getByText(/四档套餐（免费\/基础\/标准\/自定义）/);
    expect(pricingNote.textContent).toContain("用完即停、次月恢复");
    expect(pricingNote.closest("a")?.getAttribute("href")).toBe("#/pricing");
  });

  it("需求单三态：三个主步骤 + 拒绝分支说明（八态旧名退场）", () => {
    render(<DocsView />);

    for (const label of ["已收到", "处理中", "已交付"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // rejected：分支留档说明（1 个工作日响应承诺）
    expect(screen.getByText(/「已拒绝」/)).toBeTruthy();
    expect(screen.getAllByTestId(/^demand-step-/)).toHaveLength(3);
    // 旧八态名不出现在客户面文案（wire-ux-consolidation 任务 3.5）
    const pageText = document.body.textContent ?? "";
    for (const legacy of ["评估中", "已报价", "待确认", "构建中", "交付验收"]) {
      expect(pageText).not.toContain(legacy);
    }
  });

  it("「上线中」徽标收缩为一项：cell 开通（需求单提交已上线不再挂徽标）", () => {
    render(<DocsView />);

    // 控制台（AI 对话构建/我的数据/产物）已上线（wire-self-serve-launch 7.3/7.4）；
    // 需求单提交已上线（wire-ux-consolidation 4.1）——仅 cell 开通如实挂徽标
    expect(screen.queryByText("控制台分析构建")).toBeNull();
    const badges = screen.getAllByTestId("coming-soon-badge");
    expect(badges.length).toBe(1);
    expect(badges[0]!.textContent).toContain("上线中");
    expect(screen.getByText(/cell 开通/)).toBeTruthy();
    expect(screen.getByText("需求单提交")).toBeTruthy();
  });

  // 我的数据与连接器教程（wire-connector-distribution 任务 4）：
  // 上传三步 / 连接器三步 / 常驻样例（systemd/nssm/launchd）/
  // 故障排查四条 / 控制台互链与深链锚点定位。
  it("「我的数据与连接器」：上传与连接器各三步、控制台互链", () => {
    render(<DocsView />);

    const section = screen.getByTestId("docs-local-data");
    expect(section.getAttribute("id")).toBe("local-data");
    expect(section.textContent).toContain("上传三步");
    expect(section.textContent).toContain("连接器安装三步");
    // 三步各含关键动作（拖拽 / 列类型确认 / 建集；令牌 / pair / run）
    expect(section.textContent).toContain("拖入或选择文件");
    expect(section.textContent).toContain("确认列与类型");
    expect(section.textContent).toContain("命名建档");
    expect(section.textContent).toContain("配对令牌");
    expect(section.textContent).toContain("pair --token");
    expect(section.textContent).toContain("run 常驻运行");
    // 文档 → 控制台入口
    const consoleLink = screen.getByTestId("docs-local-data-console-link");
    expect(consoleLink.getAttribute("href")).toBe("#/console/datasets");
  });

  it("常驻方式样例：systemd / nssm / launchd 三平台配置齐备", () => {
    render(<DocsView />);

    const residency = screen.getByTestId("docs-local-data-residency");
    expect(residency.textContent).toContain("systemd");
    expect(residency.textContent).toContain("nssm");
    expect(residency.textContent).toContain("launchd");
    expect(residency.textContent).toContain("fd-wire-connector.service".replace(/\.service.*/, "")); // ExecStart 在场
    expect(residency.textContent).toContain("ExecStart=/usr/local/bin/fd-wire-connector run");
    expect(residency.textContent).toContain("nssm install fd-wire-connector");
    expect(residency.textContent).toContain("com.finddata.fd-wire-connector");
  });

  it("故障排查四条：心跳 warnings / schema 漂移暂停 / 行上限 / 吊销后重配对", () => {
    render(<DocsView />);

    const block = screen.getByTestId("docs-local-data-troubleshooting");
    expect(block.textContent).toContain("心跳 warnings");
    expect(block.textContent).toContain("schema 漂移暂停");
    expect(block.textContent).toContain("行上限");
    expect(block.textContent).toContain("吊销后重配对");
  });

  it("英文文案同步（docs.localData 双语键齐备）", () => {
    i18n.changeLanguage("en");
    render(<DocsView />);

    const section = screen.getByTestId("docs-local-data");
    expect(section.textContent).toContain("My data & connectors");
    expect(section.textContent).toContain("Uploading in three steps");
    expect(section.textContent).toContain("Installing a connector in three steps");
    expect(section.textContent).toContain("Troubleshooting");
    i18n.changeLanguage("zh");
  });

  it("路由：#/docs 解析为 docs（未登录可访问）", () => {
    expect(parseHash("#/docs")).toEqual({ name: "docs" });
  });
});
