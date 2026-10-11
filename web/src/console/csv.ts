// CSV 导出纯函数（wire-dashboard-export 任务 1.1）：看板整板客户端本地导出
// ——面板快照本就内嵌在产物 spec 里，零请求零新端点即可合成整板单文件。
// 运行时零依赖（仅从 spec.ts 引入类型）；RFC4180 转义 + UTF-8 BOM + CRLF
// 行尾，Excel 直接双击打开不乱码。
import type { DashboardPanel } from "./dashboard/spec";

/**
 * RFC4180 单格转义：含逗号/双引号/换行（\r 或 \n）→ 双引号包裹 + 内部
 * 引号翻倍；null → 空串（快照缺格子的如实空值）；数值 String() 原样
 * （不加引号、不失真）。
 */
export function csvEscape(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * 列头 + 数据行 → CSV 表体：每行按列序拼接（列头同样走转义），
 * CRLF 行尾（RFC4180 口径），末行不带尾换行。
 */
export function toCsv(
  columns: string[],
  rows: Array<Array<string | number | null>>,
): string {
  const lines = [columns.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  return lines.join("\r\n");
}

/**
 * 整板合成（导出文件全文）：UTF-8 BOM 前缀（Excel 中文识别）+ 逐面板
 * section——`# {面板标题}（{type}）` 注释行 + 面板快照表（toCsv）+ 空行
 * 分隔；无快照面板只有注释行（如实空结构，不报错）；panels 空/legacy
 * （null）→ 仅 `# {title}` 一行（空板如实）。行尾 CRLF。
 */
export function boardToCsv(
  title: string,
  panels: DashboardPanel[] | null,
): string {
  let sections: string[];
  if (panels === null || panels.length === 0) {
    // legacy（无面板结构）与空板：整板只有标题行。
    sections = [`# ${title}`];
  } else {
    sections = panels.map((panel) => {
      const comment = `# ${panel.title}（${panel.type}）`;
      return panel.snapshot
        ? `${comment}\r\n${toCsv(panel.snapshot.columns, panel.snapshot.rows)}`
        : comment;
    });
  }
  return `\uFEFF${sections.join("\r\n\r\n")}`;
}
