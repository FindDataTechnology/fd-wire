// 仪表盘 spec v1 契约与宽容校验（wire-dashboard-renderer 任务 1）。
//
// 存储形状：产物 spec 是信封 `{ title, spec: {…} }`（服务端最小校验口径，
// 见 api 仓 artifacts/service.validate_spec——title 非空 + spec 非空对象）；
// 仪表盘 v1 本体 = 信封内层 `{ title, panels: […] }`。parseDashboardSpec
// 同时接受信封（产物详情原样）与本体（编辑器预览）两种输入。
//
// 校验口径（宽容）：panels 里的非法面板逐个收集原因并跳过，不整板失败；
// snapshot 列行数不齐截断/补 null 标注不拒收；缺 id 的面板自动补 id；
// span 非法回退 1。旧自由 JSON（内层无 panels 数组）返回 legacy 态。
export const DASHBOARD_PANEL_TYPES = ["kpi", "line", "bar", "table"] as const;
export type DashboardPanelType = (typeof DASHBOARD_PANEL_TYPES)[number];

export const DASHBOARD_PANEL_SPANS = [1, 2, 3] as const;
export type DashboardPanelSpan = (typeof DASHBOARD_PANEL_SPANS)[number];

/** 快照数据（AI 生成仪表盘时内嵌的已取数结果；实时取数是后续物化 change）。 */
export interface DashboardSnapshot {
  columns: string[];
  rows: Array<Array<string | number | null>>;
}

/** 各面板类型的少量展示选项。 */
export interface DashboardPanelConfig {
  /** kpi：数值右侧的单位（如 %、亿元）。 */
  unit?: string;
  /** kpi：大数下方的副标题。 */
  subtitle?: string;
  /** line/bar：y 轴名。 */
  yName?: string;
  /** line/bar：x 轴名。 */
  xName?: string;
}

export interface DashboardPanel {
  id: string;
  type: DashboardPanelType;
  title: string;
  /** 栅格宽度（3 列栅格中的 1/2/3 列）。 */
  span: DashboardPanelSpan;
  /** 来源标注（指标 code / 数据集名，展示用）。 */
  source?: string;
  snapshot?: DashboardSnapshot;
  config?: DashboardPanelConfig;
}

/** 仪表盘 v1 本体（信封的 spec 内层）。 */
export interface DashboardSpecV1 {
  title: string;
  panels: DashboardPanel[];
}

/** 被跳过的非法面板（原样保留 raw 便于标注与排查）。 */
export interface DashboardBadPanel {
  /** 在原 panels 数组里的序号（0 起）。 */
  index: number;
  /** 跳过原因（i18n 键之外的机器码，渲染层映射文案）。 */
  reason: "not_object" | "bad_type";
  raw: unknown;
}

export type DashboardParseResult =
  | {
      /** v1 = 内层有 panels 数组（面板可全部非法——badPanels 如实呈现）。 */
      kind: "v1";
      title: string;
      panels: DashboardPanel[];
      badPanels: DashboardBadPanel[];
    }
  | {
      /** legacy = 旧自由 JSON（无 panels 结构）：整体只读查看，不拒收。 */
      kind: "legacy";
      raw: Record<string, unknown>;
    };

function isPanelType(value: unknown): value is DashboardPanelType {
  return (
    typeof value === "string" &&
    (DASHBOARD_PANEL_TYPES as readonly string[]).includes(value)
  );
}

/** snapshot 宽容归一：columns 只留字符串；行截断到列数、坏格子置 null。 */
function normalizeSnapshot(raw: unknown): DashboardSnapshot | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as { columns?: unknown; rows?: unknown };
  if (!Array.isArray(record.columns) && !Array.isArray(record.rows)) {
    return undefined;
  }
  const columns = (Array.isArray(record.columns) ? record.columns : [])
    .filter((c): c is string => typeof c === "string");
  const rawRows = Array.isArray(record.rows) ? record.rows : [];
  // 行数列数不齐：截断到 columns 长度（不齐处补 null），非数组行整行跳过。
  const rows = rawRows
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) =>
      columns.map(
        (_, i): string | number | null => {
          const cell = row[i];
          return typeof cell === "string" || typeof cell === "number"
            ? cell
            : null;
        },
      ),
    );
  return { columns, rows };
}

function normalizeConfig(raw: unknown): DashboardPanelConfig | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const config: DashboardPanelConfig = {};
  for (const key of ["unit", "subtitle", "yName", "xName"] as const) {
    if (typeof record[key] === "string") config[key] = record[key] as string;
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

/**
 * 宽容解析仪表盘 spec：接受产物信封（`{title, spec:{title, panels}}`）或
 * v1 本体（`{title, panels}`）。内层无 panels 数组 → legacy 态（旧自由
 * JSON，调用方整体只读呈现）；有 panels 数组 → v1 态，逐面板校验：
 * 非 JSON 对象 / type 不在枚举 → 收集进 badPanels 跳过；id 缺失自动补、
 * span 非法回退 1、snapshot/config 归一（不拒收）。
 */
export function parseDashboardSpec(raw: unknown): DashboardParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { kind: "legacy", raw: {} };
  }
  const envelope = raw as { title?: unknown; spec?: unknown };
  // 信封解包：spec 字段是对象则视作 v1 本体所在；否则把整体当本体尝试。
  const body: Record<string, unknown> =
    typeof envelope.spec === "object" && envelope.spec !== null
      ? (envelope.spec as Record<string, unknown>)
      : (raw as Record<string, unknown>);

  if (!Array.isArray(body.panels)) {
    return { kind: "legacy", raw: raw as Record<string, unknown> };
  }

  const usedIds = new Set<string>();
  const panels: DashboardPanel[] = [];
  const badPanels: DashboardBadPanel[] = [];
  body.panels.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      badPanels.push({ index, reason: "not_object", raw: entry });
      return;
    }
    const record = entry as Record<string, unknown>;
    if (!isPanelType(record.type)) {
      badPanels.push({ index, reason: "bad_type", raw: entry });
      return;
    }
    const title = typeof record.title === "string" ? record.title : "";
    // id 缺失/非字符串：自动补稳定 id（不拒收——AI 草稿常缺 id）。
    let id = typeof record.id === "string" && record.id ? record.id : "";
    if (!id) id = generatePanelId(usedIds);
    usedIds.add(id);
    const span = (
      DASHBOARD_PANEL_SPANS as readonly number[]
    ).includes(record.span as number)
      ? (record.span as DashboardPanelSpan)
      : 1;
    const snapshot = normalizeSnapshot(record.snapshot);
    const config = normalizeConfig(record.config);
    const source = typeof record.source === "string" ? record.source : undefined;
    panels.push({
      id,
      type: record.type,
      title,
      span,
      ...(source !== undefined ? { source } : {}),
      ...(snapshot !== undefined ? { snapshot } : {}),
      ...(config !== undefined ? { config } : {}),
    });
  });

  const title =
    typeof body.title === "string"
      ? body.title
      : typeof envelope.title === "string"
        ? envelope.title
        : "";
  return { kind: "v1", title, panels, badPanels };
}

/** 面板 id 生成器：`p1`、`p2`… 跳过已占用值（编辑器增删移序用）。 */
export function generatePanelId(existing: Iterable<string>): string {
  const used = new Set(existing);
  let seq = 1;
  while (used.has(`p${seq}`)) seq += 1;
  return `p${seq}`;
}

/** 不可变移序（编辑器左移/右移）：把 from 项移动到 to（越界回弹原地）。 */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (
    from < 0 ||
    from >= items.length ||
    to < 0 ||
    to >= items.length ||
    from === to
  ) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** 各类型的新面板起始模板（编辑器「添加面板」用；数据留空由用户/预览如实呈现）。 */
export function panelTemplate(
  type: DashboardPanelType,
  existingIds: Iterable<string>,
): DashboardPanel {
  const base = {
    id: generatePanelId(existingIds),
    type,
    title: "",
    span: 1 as DashboardPanelSpan,
  };
  switch (type) {
    case "kpi":
      // kpi 值存 snapshot.rows[0][0]（编辑表单的读写锚点）。
      return {
        ...base,
        snapshot: { columns: ["value"], rows: [[0]] },
        config: { unit: "", subtitle: "" },
      };
    case "line":
    case "bar":
      // 第一列当 x 轴、其余列为系列；空行 → 预览「无数据」如实呈现。
      return {
        ...base,
        snapshot: { columns: ["x", "y"], rows: [] },
      };
    case "table":
      return {
        ...base,
        snapshot: { columns: ["列一", "列二"], rows: [] },
      };
  }
}

/** 信封组装：编辑器保存时把 v1 本体放回产物信封（服务端最小校验口径）。 */
export function buildArtifactEnvelope(spec: DashboardSpecV1): {
  title: string;
  spec: DashboardSpecV1;
} {
  return { title: spec.title, spec: { title: spec.title, panels: spec.panels } };
}

/** convertPanelType 结果：转换后的面板 + kpi↔图表互转的确认标记。 */
export interface ConvertPanelResult {
  panel: DashboardPanel;
  /**
   * kpi 与图表类互转时为 true——kpi 只读 snapshot 首值、图表读整表，
   * 两个方向都有信息取舍，调用方须先让用户确认再落地。
   */
  needConfirm: boolean;
}

/**
 * 面板类型转换（编辑器 v2）：snapshot/config 原样保留（四类型共用同一
 * snapshot 形状，line↔bar↔table 互转零数据损失），仅换 type；同类型转换
 * 为幂等原样返回。kpi↔图表类互转带 needConfirm 标记（是否确认由调用方
 * 决定，本函数不弹窗）。不可变：原面板不动，返回新对象。
 */
export function convertPanelType(
  panel: DashboardPanel,
  target: DashboardPanelType,
): ConvertPanelResult {
  const needConfirm = isKpi(panel.type) !== isKpi(target);
  return {
    panel: panel.type === target ? panel : { ...panel, type: target },
    needConfirm,
  };
}

function isKpi(type: DashboardPanelType): boolean {
  return type === "kpi";
}

/**
 * 面板复制（编辑器 v2）：新 id（generatePanelId 避开既有占用）、标题加
 * 副本后缀、snapshot/config 深拷贝（structuredClone——副本的后续编辑绝不
 * 波及原件）。existingIds 缺省只避开原面板自身 id；编辑器调用时应传入
 * 当前全部面板 id 以杜绝碰撞。
 */
export function duplicatePanel(
  panel: DashboardPanel,
  existingIds: Iterable<string> = [],
  titleSuffix = "副本",
): DashboardPanel {
  const used = new Set([...existingIds]);
  used.add(panel.id);
  const copy = structuredClone(panel);
  return {
    ...copy,
    id: generatePanelId(used),
    title: `${panel.title}${titleSuffix}`,
  };
}
