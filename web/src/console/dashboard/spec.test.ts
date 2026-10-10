// 仪表盘 spec v1 契约测试（wire-dashboard-renderer 任务 1.1/1.2）：
// 宽容校验三态（合法 v1 / 含非法面板的 v1 / 旧自由 JSON legacy）+
// id 生成器 / 移序 / 面板模板 / 信封组装。
import { describe, expect, it } from "vitest";
import {
  buildArtifactEnvelope,
  convertPanelType,
  duplicatePanel,
  generatePanelId,
  moveItem,
  parseDashboardSpec,
  panelTemplate,
  type DashboardPanel,
} from "./spec";

/** v1 本体（编辑器预览 / 内层直给形态）。 */
const V1_BODY = {
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
        ],
      },
    },
  ],
};

describe("parseDashboardSpec（宽容校验三态）", () => {
  it("合法 v1：信封与本体两种输入都解析为 v1 态", () => {
    // 信封（产物详情 spec 原样）
    const fromEnvelope = parseDashboardSpec({
      title: "宏观仪表盘",
      spec: V1_BODY,
    });
    expect(fromEnvelope.kind).toBe("v1");
    if (fromEnvelope.kind !== "v1") return;
    expect(fromEnvelope.title).toBe("宏观仪表盘");
    expect(fromEnvelope.panels).toHaveLength(2);
    expect(fromEnvelope.badPanels).toEqual([]);
    expect(fromEnvelope.panels[0]).toEqual(V1_BODY.panels[0]);

    // 本体直给（编辑器实时预览）
    const fromBody = parseDashboardSpec(V1_BODY);
    expect(fromBody.kind).toBe("v1");
    if (fromBody.kind !== "v1") return;
    expect(fromBody.panels).toHaveLength(2);
    expect(fromBody.title).toBe("宏观仪表盘");
  });

  it("非法面板收集跳过、合法面板不受牵连（不整板失败）", () => {
    const parsed = parseDashboardSpec({
      spec: {
        panels: [
          V1_BODY.panels[0],
          { type: "pie", title: "坏类型" }, // type 不在枚举
          "只是一个字符串", // 非 JSON 对象
          null,
        ],
      },
    });
    expect(parsed.kind).toBe("v1");
    if (parsed.kind !== "v1") return;
    expect(parsed.panels).toHaveLength(1);
    expect(parsed.panels[0]?.id).toBe("k1");
    expect(parsed.badPanels.map((b) => b.reason)).toEqual([
      "bad_type",
      "not_object",
      "not_object",
    ]);
    expect(parsed.badPanels[0]?.index).toBe(1);
    expect(parsed.badPanels[0]?.raw).toEqual({ type: "pie", title: "坏类型" });
  });

  it("宽容归一：缺 id 自动补、span 非法回退 1、snapshot 列行数不齐截断补 null", () => {
    const parsed = parseDashboardSpec({
      spec: {
        panels: [
          {
            // 缺 id / snapshot 行比列长 / 格子类型越界（bool、对象）
            type: "table",
            title: "明细",
            span: 9,
            snapshot: {
              columns: ["月份", 42, "值"],
              rows: [
                ["7月", true, 1, "多余列"],
                ["8月"],
                "不是数组行",
                [null, 2, { x: 1 }],
              ],
            },
            config: { unit: "%", yName: 123, subtitle: "注" },
          },
        ],
      },
    });
    expect(parsed.kind).toBe("v1");
    if (parsed.kind !== "v1") return;
    const panel = parsed.panels[0] as DashboardPanel;
    expect(panel.id).toBe("p1"); // 自动补 id
    expect(panel.span).toBe(1); // 非法 span 回退
    expect(panel.snapshot?.columns).toEqual(["月份", "值"]); // 非字符串列过滤
    expect(panel.snapshot?.rows).toEqual([
      ["7月", null], // 截断到列数 + 坏格子置 null
      ["8月", null], // 短行补 null
      [null, 2], // 非数组行整行跳过；对象格子置 null
    ]);
    expect(panel.config).toEqual({ unit: "%", subtitle: "注" }); // 非字符串字段丢弃
  });

  it("旧自由 JSON（无 panels）与非对象输入 → legacy 态", () => {
    // 产物页历史种子形状：信封内层是自由 JSON
    const legacy = parseDashboardSpec({
      title: "宏观仪表盘",
      spec: { indicators: ["CN_CPI_YOY"], layout: "2x2" },
    });
    expect(legacy.kind).toBe("legacy");
    if (legacy.kind !== "legacy") return;
    expect(legacy.raw).toEqual({
      title: "宏观仪表盘",
      spec: { indicators: ["CN_CPI_YOY"], layout: "2x2" },
    });

    // panels 非数组 / 输入非对象：同样 legacy（不崩不拒）
    expect(parseDashboardSpec({ spec: { panels: "oops" } }).kind).toBe("legacy");
    expect(parseDashboardSpec(null).kind).toBe("legacy");
    expect(parseDashboardSpec([1, 2]).kind).toBe("legacy");
    expect(parseDashboardSpec("text").kind).toBe("legacy");
  });

  it("v1 标题回退：内层缺 title 时取信封 title，再缺为空串", () => {
    const parsed = parseDashboardSpec({
      title: "信封标题",
      spec: { panels: [] },
    });
    expect(parsed.kind).toBe("v1");
    if (parsed.kind !== "v1") return;
    expect(parsed.title).toBe("信封标题");
    expect(parseDashboardSpec({ panels: [] })).toMatchObject({
      kind: "v1",
      title: "",
    });
  });
});

describe("编辑器工具（任务 1.2）", () => {
  it("generatePanelId：p1/p2 递增并跳过已占用 id", () => {
    expect(generatePanelId([])).toBe("p1");
    expect(generatePanelId(["p1"])).toBe("p2");
    expect(generatePanelId(["p1", "p2", "p4"])).toBe("p3");
  });

  it("moveItem：不可变移序 + 越界回弹原地", () => {
    const items = ["a", "b", "c"];
    expect(moveItem(items, 1, 0)).toEqual(["b", "a", "c"]);
    expect(moveItem(items, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(items, 2, 2)).toEqual(items);
    expect(moveItem(items, 0, 9)).toEqual(items);
    expect(moveItem(items, -1, 0)).toEqual(items);
    expect(items).toEqual(["a", "b", "c"]); // 原数组不动
  });

  it("panelTemplate：各类型起始模板（kpi 值锚在 rows[0][0]）", () => {
    const existing = ["p1", "p2"];
    const kpi = panelTemplate("kpi", existing);
    expect(kpi.id).toBe("p3");
    expect(kpi.type).toBe("kpi");
    expect(kpi.span).toBe(1);
    expect(kpi.snapshot).toEqual({ columns: ["value"], rows: [[0]] });
    expect(kpi.config).toEqual({ unit: "", subtitle: "" });

    const line = panelTemplate("line", existing);
    expect(line.snapshot?.columns).toEqual(["x", "y"]);
    expect(line.snapshot?.rows).toEqual([]);

    expect(panelTemplate("bar", [])?.snapshot?.columns).toEqual(["x", "y"]);
    expect(panelTemplate("table", [])?.snapshot?.columns).toEqual(["列一", "列二"]);
  });

  it("buildArtifactEnvelope：v1 本体放回产物信封（服务端最小校验口径）", () => {
    const spec = {
      title: "宏观仪表盘",
      panels: [V1_BODY.panels[0] as DashboardPanel],
    };
    expect(buildArtifactEnvelope(spec)).toEqual({
      title: "宏观仪表盘",
      spec: { title: "宏观仪表盘", panels: spec.panels },
    });
  });
});

describe("编辑器 v2 工具（wire-dashboard-editor-v2 任务 1.1）", () => {
  it("convertPanelType：line↔bar↔table 互转保 snapshot/config 零损失、needConfirm=false", () => {
    const line = V1_BODY.panels[1] as DashboardPanel;
    const result = convertPanelType(line, "table");
    expect(result.needConfirm).toBe(false);
    expect(result.panel).toEqual({ ...line, type: "table" }); // 仅换 type
    expect(result.panel.snapshot).toEqual(line.snapshot); // 数据原样
    // 不可变：原面板不动
    expect(line.type).toBe("line");

    const withConfig = { ...line, config: { xName: "月份", yName: "PMI" } };
    expect(convertPanelType(withConfig, "bar").panel).toEqual({
      ...withConfig,
      type: "bar",
    });
  });

  it("convertPanelType：kpi↔图表类互转 needConfirm=true（两个方向）", () => {
    const kpi = V1_BODY.panels[0] as DashboardPanel;
    expect(convertPanelType(kpi, "line").needConfirm).toBe(true);
    expect(convertPanelType(kpi, "table").needConfirm).toBe(true);

    const chart = V1_BODY.panels[1] as DashboardPanel;
    const intoKpi = convertPanelType(chart, "kpi");
    expect(intoKpi.needConfirm).toBe(true);
    // snapshot 仍原样保留（渲染层 kpi 只读首值——取舍由确认对话框交代）
    expect(intoKpi.panel.snapshot).toEqual(chart.snapshot);
  });

  it("convertPanelType：同类型转换为幂等原样返回（needConfirm=false）", () => {
    const kpi = V1_BODY.panels[0] as DashboardPanel;
    const same = convertPanelType(kpi, "kpi");
    expect(same.needConfirm).toBe(false);
    expect(same.panel).toBe(kpi); // 原对象原样返回
  });

  it("duplicatePanel：新 id（避开占用）+ 副本标题 + snapshot/config 深拷贝", () => {
    const kpi = V1_BODY.panels[0] as DashboardPanel;
    const copy = duplicatePanel(kpi);
    expect(copy.id).not.toBe(kpi.id); // 缺省避开原面板自身 id
    expect(copy.id).toBe("p1"); // generatePanelId 口径
    expect(copy.title).toBe("CPI 同比副本"); // 默认「副本」后缀
    expect(copy.type).toBe("kpi");
    expect(copy.snapshot).toEqual(kpi.snapshot);
    expect(copy.config).toEqual(kpi.config);

    // 深拷贝：改副本数据不波及原件
    copy.snapshot?.rows.push([9.9]);
    if (copy.config) copy.config.unit = "‰";
    expect(kpi.snapshot?.rows).toEqual([[2.1]]);
    expect(kpi.config?.unit).toBe("%");

    // 传入既有 id 集合时避开占用；后缀可指定（i18n）
    expect(duplicatePanel(kpi, ["p1"]).id).toBe("p2");
    expect(duplicatePanel(kpi, ["p1", "p2"], " (copy)").title).toBe(
      "CPI 同比 (copy)",
    );
  });
});
