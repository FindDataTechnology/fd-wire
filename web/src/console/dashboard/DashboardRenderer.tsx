// 仪表盘快照渲染器（wire-dashboard-renderer 任务 2）。
// - 3 列栅格（span 1/2/3）；kpi 大数卡、line/bar 走 echarts（快照第一列当
//   x 轴、其余列为系列）、table 简表（超 20 行内部滚动）。
// - 容错：非法面板单卡标注跳过（不整板失败）；空 snapshot 如实显「无数据」；
//   旧自由 JSON（无 panels）整体显「旧版自由格式」+ 只读 JSON 查看。
// - 底部小字标注快照口径（快照数据，实时刷新后续开通）。
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import * as echarts from "echarts";
import {
  parseDashboardSpec,
  type DashboardPanel,
  type DashboardPanelSpan,
} from "./spec";

/** 栅格跨度 → Tailwind 列宽类（静态映射：Tailwind JIT 不识别拼接类名）。 */
const SPAN_CLASS: Record<DashboardPanelSpan, string> = {
  1: "md:col-span-1",
  2: "md:col-span-2",
  3: "md:col-span-3",
};

/** table 面板超此行数启用内部滚动。 */
const TABLE_SCROLL_THRESHOLD = 20;

/**
 * 渲染仪表盘产物 spec（信封或 v1 本体均可——见 parseDashboardSpec）。
 * 编辑器的实时预览复用本组件。
 */
export function DashboardRenderer({ spec }: { spec: unknown }) {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseDashboardSpec(spec), [spec]);

  if (parsed.kind === "legacy") {
    return (
      <div data-testid="dashboard-legacy" className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
            {t("console.dashboard.legacy.badge")}
          </span>
          <span className="text-xs text-slate-500">
            {t("console.dashboard.legacy.note")}
          </span>
        </div>
        <pre
          data-testid="dashboard-legacy-json"
          className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-3 font-mono text-[11px] text-slate-700"
        >
          {JSON.stringify(parsed.raw, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div data-testid="dashboard-renderer">
      {parsed.title && (
        <h2 data-testid="dashboard-title" className="text-sm font-semibold text-slate-800">
          {parsed.title}
        </h2>
      )}
      {parsed.panels.length === 0 && parsed.badPanels.length === 0 && (
        <p data-testid="dashboard-empty-panels" className="mt-2 text-xs text-slate-400">
          {t("console.dashboard.emptyPanels")}
        </p>
      )}
      {(parsed.panels.length > 0 || parsed.badPanels.length > 0) && (
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
          {parsed.panels.map((panel) => (
            <div
              key={panel.id}
              data-testid="dashboard-panel"
              data-panel-id={panel.id}
              data-panel-type={panel.type}
              className={`rounded-lg border border-slate-200 bg-white p-4 ${SPAN_CLASS[panel.span]}`}
            >
              <PanelCard panel={panel} />
            </div>
          ))}
          {parsed.badPanels.map((bad) => (
            <div
              key={`bad-${bad.index}`}
              data-testid="dashboard-bad-panel"
              data-index={bad.index}
              className="rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-4 md:col-span-1"
            >
              <p className="text-xs text-amber-700">
                {t("console.dashboard.badPanel", { index: bad.index + 1 })}
                {t(`console.dashboard.badPanelReason.${bad.reason}`)}
              </p>
            </div>
          ))}
        </div>
      )}
      <p data-testid="dashboard-snapshot-note" className="mt-2 text-[11px] text-slate-400">
        {t("console.dashboard.snapshotNote")}
      </p>
    </div>
  );
}

/** 单个面板：标题 + 可选来源标注 + 类型化主体。 */
function PanelCard({ panel }: { panel: DashboardPanel }) {
  const { t } = useTranslation();
  const body =
    panel.type === "kpi" ? (
      <KpiBody panel={panel} />
    ) : panel.type === "table" ? (
      <TableBody panel={panel} />
    ) : (
      <ChartBody panel={panel} />
    );
  return (
    <section className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 data-testid="dashboard-panel-title" className="text-sm font-medium text-slate-700">
          {panel.title || t(`console.dashboard.type.${panel.type}`)}
        </h3>
        {panel.source && (
          <span
            data-testid="dashboard-panel-source"
            className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500"
          >
            {panel.source}
          </span>
        )}
      </div>
      <div className="mt-2 flex-1">{body}</div>
    </section>
  );
}

/** 无数据占位（空 snapshot / 无可画系列的图表如实呈现）。 */
function NoData() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="dashboard-no-data"
      className="flex h-24 items-center justify-center rounded border border-dashed border-slate-200 text-xs text-slate-400"
    >
      {t("console.dashboard.noData")}
    </div>
  );
}

/** kpi 大数卡：值取 snapshot.rows[0][0]，配 config.unit / config.subtitle。 */
function KpiBody({ panel }: { panel: DashboardPanel }) {
  const value = panel.snapshot?.rows?.[0]?.[0];
  const unit = panel.config?.unit ?? "";
  const subtitle = panel.config?.subtitle ?? "";
  if (value === undefined || value === null) return <NoData />;
  return (
    <div data-testid="dashboard-kpi" className="flex flex-col justify-center py-2">
      <p className="flex items-baseline gap-1">
        <span data-testid="dashboard-kpi-value" className="text-3xl font-semibold tabular-nums text-slate-900">
          {value}
        </span>
        {unit && (
          <span data-testid="dashboard-kpi-unit" className="text-sm text-slate-500">
            {unit}
          </span>
        )}
      </p>
      {subtitle && (
        <span data-testid="dashboard-kpi-subtitle" className="mt-1 text-xs text-slate-400">
          {subtitle}
        </span>
      )}
    </div>
  );
}

/** line/bar 主体：echarts 按快照列推断维度（第一列 x、其余列系列）。 */
function ChartBody({ panel }: { panel: DashboardPanel }) {
  const { t } = useTranslation();
  const columns = panel.snapshot?.columns ?? [];
  const rows = panel.snapshot?.rows ?? [];
  // 少于两列（无系列列）或零行 = 没有可画的数据，如实占位。
  const hasData = columns.length >= 2 && rows.length > 0;

  const option = useMemo<echarts.EChartsOption>(() => {
    const seriesColumns = columns.slice(1);
    return {
      tooltip: { trigger: "axis" },
      ...(seriesColumns.length > 1 ? { legend: {} } : {}),
      grid: { left: 48, right: 16, top: seriesColumns.length > 1 ? 36 : 24, bottom: 32 },
      xAxis: {
        type: "category",
        data: rows.map((row) => String(row[0] ?? "")),
        ...(panel.config?.xName ? { name: panel.config.xName } : {}),
      },
      yAxis: {
        type: "value",
        ...(panel.config?.yName ? { name: panel.config.yName } : {}),
      },
      series: seriesColumns.map((name, i) => ({
        name,
        type: panel.type === "bar" ? "bar" : "line",
        data: rows.map((row) => row[i + 1] ?? null),
      })),
    };
  }, [columns, rows, panel.type, panel.config?.xName, panel.config?.yName]);

  if (!hasData) return <NoData />;

  return (
    <div>
      <EChartBox option={option} />
      <span className="sr-only" data-testid="dashboard-chart-label">
        {t(`console.dashboard.type.${panel.type}`)}
      </span>
    </div>
  );
}

/** echarts 绑定：init/dispose 生命周期 + option 变化重画 + 窗口缩放自适应。
 *  渲染器固定 SVG（测试环境无 canvas 也能跑；视觉与 canvas 无差别口径）。 */
function EChartBox({ option }: { option: echarts.EChartsOption }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, {
      renderer: "svg",
    });
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    // notMerge=true：面板数据整体替换（残留旧系列比清空更糟）。
    chartRef.current?.setOption(option, true);
  }, [option]);

  return <div ref={containerRef} data-testid="dashboard-chart" style={{ height: 220 }} />;
}

/** table 简表：列头 + 行；超 20 行启用内部滚动（不整页拉长）。 */
function TableBody({ panel }: { panel: DashboardPanel }) {
  const columns = panel.snapshot?.columns ?? [];
  const rows = panel.snapshot?.rows ?? [];
  if (rows.length === 0) return <NoData />;
  const scroll = rows.length > TABLE_SCROLL_THRESHOLD;
  return (
    <div
      className={scroll ? "max-h-56 overflow-y-auto rounded border border-slate-200" : "rounded border border-slate-200"}
    >
      <table data-testid="dashboard-table" className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-slate-50">
          <tr>
            {columns.map((column, i) => (
              <th
                key={`${column}-${i}`}
                className="border-b border-slate-200 px-2 py-1.5 text-left font-medium text-slate-600"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="even:bg-slate-50/50">
              {columns.map((_, c) => {
                const cell = row[c];
                return (
                  <td key={c} className="px-2 py-1.5 text-slate-700 tabular-nums">
                    {cell === null || cell === undefined ? (
                      <span className="text-slate-300">-</span>
                    ) : (
                      String(cell)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
