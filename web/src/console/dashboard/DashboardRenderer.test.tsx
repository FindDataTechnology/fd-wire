// 仪表盘渲染器组件测试（wire-dashboard-renderer 任务 2.3）：
// 三类面板渲染（kpi/line+bar/table）、空数据占位、坏面板隔离（不整板失败）、
// 旧自由 JSON legacy 态、快照口径标注。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "../../i18n";
import i18n from "../../i18n";
import { DashboardRenderer } from "./DashboardRenderer";

beforeEach(() => {
  i18n.changeLanguage("zh");
});

afterEach(() => {
  cleanup();
});

/** 含三类面板 + 空数据面板 + 两个非法面板的 v1 信封。 */
const MIXED_SPEC = {
  title: "宏观仪表盘",
  spec: {
    title: "宏观仪表盘",
    panels: [
      {
        id: "k1",
        type: "kpi",
        title: "CPI 同比",
        span: 1,
        source: "CN_CPI_YOY",
        snapshot: { columns: ["value"], rows: [[2.1]] },
        config: { unit: "%", subtitle: "2026-09" },
      },
      {
        id: "l1",
        type: "line",
        title: "PMI 走势",
        span: 2,
        snapshot: {
          columns: ["月份", "PMI"],
          rows: [
            ["7月", 49.4],
            ["8月", 49.1],
            ["9月", 49.8],
          ],
        },
        config: { yName: "PMI", xName: "月份" },
      },
      {
        id: "b1",
        type: "bar",
        title: "发电量",
        span: 1,
        snapshot: {
          columns: ["月份", "火电", "水电"],
          rows: [
            ["7月", 100, 50],
            ["8月", 110, 60],
          ],
        },
      },
      {
        id: "t1",
        type: "table",
        title: "月度明细",
        span: 3,
        snapshot: {
          columns: ["月份", "值"],
          rows: Array.from({ length: 25 }, (_, i) => [`2026-${i + 1}月`, i]),
        },
      },
      { id: "e1", type: "kpi", title: "空指标", span: 1 },
      { type: "pie", title: "坏类型" },
      "只是一个字符串",
    ],
  },
};

describe("DashboardRenderer（快照渲染）", () => {
  it("三类面板渲染：kpi 大数卡 / line+bar echarts / table 简表", () => {
    render(<DashboardRenderer spec={MIXED_SPEC} />);

    expect(screen.getByTestId("dashboard-title").textContent).toBe("宏观仪表盘");

    // kpi：值 + 单位 + 副标题 + 来源标注
    expect(screen.getByTestId("dashboard-kpi-value").textContent).toBe("2.1");
    expect(screen.getByTestId("dashboard-kpi-unit").textContent).toBe("%");
    expect(screen.getByTestId("dashboard-kpi-subtitle").textContent).toBe("2026-09");
    expect(screen.getByTestId("dashboard-panel-source").textContent).toBe(
      "CN_CPI_YOY",
    );

    // line + bar：echarts 容器（SVG 渲染器在测试环境可跑）
    const charts = screen.getAllByTestId("dashboard-chart");
    expect(charts).toHaveLength(2);
    for (const chart of charts) {
      expect(chart.querySelector("svg")).toBeTruthy();
    }

    // table：25 行全渲染 + 超 20 行启用内部滚动
    const table = screen.getByTestId("dashboard-table");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(25);
    expect(table.querySelector("tbody tr td")?.textContent).toBe("2026-1月");
    expect((table.parentElement as HTMLElement).className).toContain(
      "overflow-y-auto",
    );

    // 栅格跨度：line 面板占 2 列（Tailwind 静态类映射）
    const linePanel = screen
      .getAllByTestId("dashboard-panel")
      .find((el) => el.getAttribute("data-panel-id") === "l1")!;
    expect(linePanel.className).toContain("md:col-span-2");

    // 快照口径小字
    expect(screen.getByTestId("dashboard-snapshot-note").textContent).toContain(
      "快照数据",
    );
  });

  it("空 snapshot 如实显「无数据」；kpi 值为 null 同样占位", () => {
    render(
      <DashboardRenderer
        spec={{
          title: "空看板",
          panels: [
            { id: "a", type: "line", title: "空折线", span: 1 },
            { id: "b", type: "table", title: "空表", span: 1 },
            {
              id: "c",
              type: "kpi",
              title: "空值",
              span: 1,
              snapshot: { columns: ["value"], rows: [[null]] },
            },
          ],
        }}
      />,
    );
    expect(screen.getAllByTestId("dashboard-no-data")).toHaveLength(3);
  });

  it("坏面板隔离：非法面板单卡标注跳过，合法面板不受牵连", () => {
    render(<DashboardRenderer spec={MIXED_SPEC} />);

    const bads = screen.getAllByTestId("dashboard-bad-panel");
    expect(bads).toHaveLength(2);
    // 序号 1 起 + 原因文案
    expect(bads[0]?.getAttribute("data-index")).toBe("5");
    expect(bads[0]?.textContent).toContain("面板 #6");
    expect(bads[0]?.textContent).toContain("kpi / line / bar / table");
    expect(bads[1]?.textContent).toContain("面板 #7");
    expect(bads[1]?.textContent).toContain("JSON 对象");

    // 合法面板照常渲染（不整板失败）
    expect(screen.getAllByTestId("dashboard-panel")).toHaveLength(5);
    expect(screen.getByTestId("dashboard-kpi-value").textContent).toBe("2.1");
  });

  it("旧自由 JSON →「旧版自由格式」+ 只读 JSON 查看", () => {
    render(
      <DashboardRenderer
        spec={{
          title: "宏观仪表盘",
          spec: { indicators: ["CN_CPI_YOY", "CN_PMI"], layout: "2x2" },
        }}
      />,
    );
    expect(screen.getByTestId("dashboard-legacy")).toBeTruthy();
    expect(screen.getByTestId("dashboard-legacy").textContent).toContain(
      "旧版自由格式",
    );
    const json = screen.getByTestId("dashboard-legacy-json").textContent ?? "";
    expect(json).toContain("CN_CPI_YOY");
    expect(json).toContain("2x2");
    // legacy 态不渲染任何面板
    expect(screen.queryByTestId("dashboard-panel")).toBeNull();
  });

  it("空看板（零面板零坏面板）→ 空态提示 + 快照口径仍在", () => {
    render(<DashboardRenderer spec={{ title: "", panels: [] }} />);
    expect(screen.getByTestId("dashboard-empty-panels").textContent).toContain(
      "还没有面板",
    );
    expect(screen.queryByTestId("dashboard-title")).toBeNull();
    expect(screen.getByTestId("dashboard-snapshot-note")).toBeTruthy();
  });
});
