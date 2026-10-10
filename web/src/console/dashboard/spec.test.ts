// 仪表盘 spec v1 契约测试（wire-dashboard-renderer 任务 1.1/1.2）：
// 宽容校验三态（合法 v1 / 含非法面板的 v1 / 旧自由 JSON legacy）+
// id 生成器 / 移序 / 面板模板 / 信封组装。
// wire-dashboard-query-contract 任务 2.1/2.4：面板 query 契约——宽容归一
// （合法/非法/limit 回退/列去重保序）、parse 挂载与非法丢弃、编辑 helpers
// （duplicate/convert）保留 query。
import { describe, expect, it } from "vitest";
import {
  buildArtifactEnvelope,
  convertPanelType,
  duplicatePanel,
  generatePanelId,
  moveItem,
  normalizePanelQuery,
  parseDashboardSpec,
  panelTemplate,
  type DashboardPanel,
  type DashboardPanelQuery,
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

describe("面板 query 契约（wire-dashboard-query-contract 任务 2.1）", () => {
  /** 合法全字段 query（kpi 单值约定：sort 到最近一行 + limit 1 + 投影值列）。 */
  const VALID_QUERY: DashboardPanelQuery = {
    dataset_id: "ds_coal_price",
    filters: [{ column: "city", op: "eq", value: "秦皇岛" }],
    sort: [{ column: "date", dir: "desc" }],
    limit: 1,
    columns: ["price"],
  };

  it("合法 query 原样归一（全字段；value 原样透传不猜类型）", () => {
    expect(normalizePanelQuery(VALID_QUERY)).toEqual(VALID_QUERY);
    // 只带 dataset_id：可选字段缺省不落
    expect(normalizePanelQuery({ dataset_id: "ds_x" })).toEqual({ dataset_id: "ds_x" });
    // value 为任意 JSON 值（数组/对象/布尔）均透传
    expect(
      normalizePanelQuery({
        dataset_id: "ds_x",
        filters: [
          { column: "tags", op: "in", value: ["a", "b"] },
          { column: "ok", op: "eq", value: true },
        ],
      }),
    ).toEqual({
      dataset_id: "ds_x",
      filters: [
        { column: "tags", op: "in", value: ["a", "b"] },
        { column: "ok", op: "eq", value: true },
      ],
    });
  });

  it("顶层非对象（含数组/null）或 dataset_id 缺失/非字符串/空串 → undefined", () => {
    expect(normalizePanelQuery(undefined)).toBeUndefined();
    expect(normalizePanelQuery(null)).toBeUndefined();
    expect(normalizePanelQuery("query")).toBeUndefined();
    expect(normalizePanelQuery(42)).toBeUndefined();
    expect(normalizePanelQuery([])).toBeUndefined();
    expect(normalizePanelQuery({ filters: [] })).toBeUndefined(); // 缺 dataset_id
    expect(normalizePanelQuery({ dataset_id: "" })).toBeUndefined(); // 空串
    expect(normalizePanelQuery({ dataset_id: 123 })).toBeUndefined(); // 非字符串
    expect(normalizePanelQuery({ dataset_id: "  " })).toEqual({ dataset_id: "  " }); // 仅要求非空，不 trim
  });

  it("filters 宽容归一：非法项丢弃（算子白名单/空 column/非对象项），全不合法不落字段", () => {
    expect(
      normalizePanelQuery({
        dataset_id: "ds_x",
        filters: [
          { column: "city", op: "between", value: [1, 2] }, // 算子不在白名单 → 丢弃
          { column: "", op: "eq", value: 1 }, // 空 column → 丢弃
          { column: "date", op: "regex", value: ".*" }, // 丢弃
          "只是一个字符串", // 非对象项 → 丢弃
          null,
          { column: "city", op: "gte", value: 500 }, // 合法 → 保留
          { column: "name", op: "contains", value: "煤" }, // 合法 → 保留
        ],
      }),
    ).toEqual({
      dataset_id: "ds_x",
      filters: [
        { column: "city", op: "gte", value: 500 },
        { column: "name", op: "contains", value: "煤" },
      ],
    });
    // 全不合法 → 字段不落（query 本体仍保留 dataset_id）
    expect(
      normalizePanelQuery({ dataset_id: "ds_x", filters: [{ column: "c", op: "bad" }] }),
    ).toEqual({ dataset_id: "ds_x" });
    // 非数组 / 空数组 → 同样不落字段
    expect(normalizePanelQuery({ dataset_id: "ds_x", filters: "oops" })).toEqual({
      dataset_id: "ds_x",
    });
    expect(normalizePanelQuery({ dataset_id: "ds_x", filters: [] })).toEqual({
      dataset_id: "ds_x",
    });
  });

  it("sort 宽容归一：dir 不在 asc/desc 或空 column 丢弃；全不合法/非数组不落字段", () => {
    expect(
      normalizePanelQuery({
        dataset_id: "ds_x",
        sort: [
          { column: "date", dir: "DESC" }, // 方向白名单外 → 丢弃
          { column: "", dir: "asc" }, // 空 column → 丢弃
          { column: "price", dir: "desc" }, // 合法 → 保留
          "只是一个字符串",
        ],
      }),
    ).toEqual({ dataset_id: "ds_x", sort: [{ column: "price", dir: "desc" }] });
    expect(
      normalizePanelQuery({ dataset_id: "ds_x", sort: [{ column: "date", dir: "up" }] }),
    ).toEqual({ dataset_id: "ds_x" });
    expect(normalizePanelQuery({ dataset_id: "ds_x", sort: "oops" })).toEqual({
      dataset_id: "ds_x",
    });
    expect(normalizePanelQuery({ dataset_id: "ds_x", sort: [] })).toEqual({
      dataset_id: "ds_x",
    });
  });

  it("limit：非法（非数字/非整数/越界 1..1000）回退 100；合法保留；缺省不落", () => {
    for (const bad of [0, -5, 1001, 2000, 2.5, "50", null, NaN]) {
      expect(normalizePanelQuery({ dataset_id: "ds_x", limit: bad })).toEqual({
        dataset_id: "ds_x",
        limit: 100,
      });
    }
    expect(normalizePanelQuery({ dataset_id: "ds_x", limit: 1 })).toEqual({
      dataset_id: "ds_x",
      limit: 1,
    });
    expect(normalizePanelQuery({ dataset_id: "ds_x", limit: 1000 })).toEqual({
      dataset_id: "ds_x",
      limit: 1000,
    });
    expect(normalizePanelQuery({ dataset_id: "ds_x" })).toEqual({ dataset_id: "ds_x" }); // 未给出不落
  });

  it("columns：只留字符串、去重保序；非字符串丢弃；全非法/非数组/空不落字段", () => {
    expect(
      normalizePanelQuery({
        dataset_id: "ds_x",
        columns: ["价格", "日期", "价格", 42, null, "城市", true, "日期"],
      }),
    ).toEqual({ dataset_id: "ds_x", columns: ["价格", "日期", "城市"] });
    expect(
      normalizePanelQuery({ dataset_id: "ds_x", columns: [42, null, {}] }),
    ).toEqual({ dataset_id: "ds_x" }); // 全非法 → 不落
    expect(normalizePanelQuery({ dataset_id: "ds_x", columns: "oops" })).toEqual({
      dataset_id: "ds_x",
    });
    expect(normalizePanelQuery({ dataset_id: "ds_x", columns: [] })).toEqual({
      dataset_id: "ds_x",
    });
  });

  it("parseDashboardSpec：合法 query 挂载到面板；非法 query 整体丢弃（面板照常收下）", () => {
    const parsed = parseDashboardSpec({
      spec: {
        panels: [
          {
            id: "q1",
            type: "table",
            title: "契约面板",
            snapshot: { columns: ["日期", "价格"], rows: [["7月", 850]] },
            query: {
              dataset_id: "ds_coal",
              filters: [{ column: "c", op: "bad" }, { column: "city", op: "eq", value: 1 }],
              limit: 5000,
              columns: ["价格", "价格", 9],
            },
          },
          {
            id: "q2",
            type: "kpi",
            title: "坏契约面板",
            snapshot: { columns: ["value"], rows: [[1]] },
            query: { filters: [{ column: "c", op: "eq", value: 1 }] }, // 缺 dataset_id
          },
        ],
      },
    });
    expect(parsed.kind).toBe("v1");
    if (parsed.kind !== "v1") return;
    // 合法 query：归一后挂载（非法 filters 项丢弃、limit 越界回退 100、列去重保序）
    expect(parsed.panels[0]?.query).toEqual({
      dataset_id: "ds_coal",
      filters: [{ column: "city", op: "eq", value: 1 }],
      limit: 100,
      columns: ["价格"],
    });
    // 非法 query：整体丢弃，面板本体不受影响（snapshot 原样，渲染读快照）
    expect(parsed.panels[1]?.query).toBeUndefined();
    expect(parsed.panels[1]?.snapshot).toEqual({ columns: ["value"], rows: [[1]] });
    expect(parsed.badPanels).toEqual([]); // 非法 query 不计坏面板
  });

  it("duplicatePanel 保留 query（structuredClone 深拷贝，副本改 query 不波及原件）", () => {
    const panel: DashboardPanel = {
      id: "q1",
      type: "table",
      title: "契约面板",
      span: 2,
      snapshot: { columns: ["日期"], rows: [["7月"]] },
      query: { ...VALID_QUERY, filters: [{ column: "city", op: "eq", value: "秦皇岛" }] },
    };
    const copy = duplicatePanel(panel, ["q1"]);
    expect(copy.query).toEqual(panel.query); // 原样保留
    // 深拷贝独立：改副本 query 字段不波及原件
    copy.query!.dataset_id = "ds_other";
    copy.query!.filters![0]!.column = "mutated";
    expect(panel.query!.dataset_id).toBe("ds_coal_price");
    expect(panel.query!.filters![0]!.column).toBe("city");
  });

  it("convertPanelType 保留 query（对象展开——仅换 type，kpi↔图表互转同样保留）", () => {
    const kpi: DashboardPanel = {
      id: "q1",
      type: "kpi",
      title: "契约指标",
      span: 1,
      snapshot: { columns: ["value"], rows: [[850]] },
      query: VALID_QUERY,
    };
    const toLine = convertPanelType(kpi, "line");
    expect(toLine.needConfirm).toBe(true);
    expect(toLine.panel.type).toBe("line");
    expect(toLine.panel.query).toEqual(VALID_QUERY); // 原样保留
    expect(kpi.query).toEqual(VALID_QUERY); // 不可变：原面板不动

    const toKpi = convertPanelType(
      { ...kpi, type: "line", query: { dataset_id: "ds_y", limit: 7 } },
      "kpi",
    );
    expect(toKpi.panel.query).toEqual({ dataset_id: "ds_y", limit: 7 });
  });
});
