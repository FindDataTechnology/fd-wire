// 产物页 dashboard 集成测试（wire-dashboard-renderer 任务 4.1 / 5.1，组件级）：
// - dashboard kind 卡片「查看看板」内嵌展开（不走路由）→ 三类面板渲染；
// - 「编辑」切编辑器 → 改标题保存 v2（PUT）→ 返回查看新版本生效；
// - legacy spec 只读 + 编辑禁用；archived 只读；非 dashboard kind 无入口。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "../../i18n";
import i18n from "../../i18n";
import { ArtifactsPage } from "../ArtifactsPage";
import { installConsoleBackend, seedConsoleSession } from "../testing";

/** v1 仪表盘信封：kpi + line + table 三面板。 */
const V1_DASHBOARD_SPEC = {
  title: "宏观仪表盘",
  spec: {
    title: "宏观仪表盘",
    panels: [
      {
        id: "k1",
        type: "kpi",
        title: "CPI 同比",
        span: 1,
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
      {
        id: "t1",
        type: "table",
        title: "月度明细",
        span: 3,
        snapshot: {
          columns: ["月份", "值"],
          rows: [
            ["7月", 49.4],
            ["8月", 49.1],
          ],
        },
      },
    ],
  },
};

beforeEach(() => {
  i18n.changeLanguage("zh");
  localStorage.clear();
  sessionStorage.clear();
  seedConsoleSession({ sub: "demo-customer" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

function install() {
  const backend = installConsoleBackend([]);
  // 31：v1 仪表盘（draft）；32：非 dashboard kind（入口零变化对照）；
  // 33：legacy 自由 JSON 仪表盘；34：archived 仪表盘。
  backend.addLifecycleArtifact({
    id: 31,
    kind: "dashboard",
    title: "宏观仪表盘",
    version: 1,
    spec: V1_DASHBOARD_SPEC,
  });
  backend.addLifecycleArtifact({
    id: 32,
    kind: "alert_rule",
    title: "煤价告警",
    spec: { title: "煤价告警", spec: { threshold: 0.05 } },
  });
  backend.addLifecycleArtifact({
    id: 33,
    kind: "dashboard",
    title: "旧版看板",
    spec: { title: "旧版看板", spec: { indicators: ["CN_CPI_YOY"], layout: "2x2" } },
  });
  backend.addLifecycleArtifact({
    id: 34,
    kind: "dashboard",
    title: "已归档看板",
    status: "archived",
    spec: V1_DASHBOARD_SPEC,
  });
  vi.stubGlobal("fetch", backend.fetchImpl);
  return backend;
}

function rowOf(id: number): HTMLElement {
  return screen
    .getAllByTestId("artifact-item")
    .find((el) => el.getAttribute("data-artifact-id") === String(id))!;
}

describe("产物页 dashboard 集成（查看看板 → 编辑 → 保存 v2 → 新版本生效）", () => {
  it("dashboard kind 卡片「查看看板」内嵌展开：三类面板渲染 + 快照口径", async () => {
    install();
    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");

    // v1 仪表盘与非 dashboard kind 各一个入口（legacy/archived 也是 dashboard kind）
    expect(screen.getAllByTestId("artifact-dashboard-view")).toHaveLength(3);

    fireEvent.click(within(rowOf(31)).getByTestId("artifact-dashboard-view"));
    expect(await screen.findByTestId("dashboard-pane")).toBeTruthy();
    // 三类面板：kpi 大数 + line 图容器 + table 简表
    expect(screen.getByTestId("dashboard-kpi-value").textContent).toBe("2.1");
    expect(screen.getAllByTestId("dashboard-chart")).toHaveLength(1);
    expect(screen.getByTestId("dashboard-table").querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getByTestId("dashboard-snapshot-note").textContent).toContain("快照数据");

    // 非 dashboard kind 行没有入口
    expect(within(rowOf(32)).queryByTestId("artifact-dashboard-view")).toBeNull();

    // 再点一次收起
    fireEvent.click(within(rowOf(31)).getByTestId("artifact-dashboard-view"));
    await waitFor(() => {
      expect(screen.queryByTestId("dashboard-pane")).toBeNull();
    });
  });

  it("E2E：编辑改标题保存 v2 → 返回查看新版本生效（行版本号同步）", async () => {
    const backend = install();
    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");

    fireEvent.click(within(rowOf(31)).getByTestId("artifact-dashboard-view"));
    await screen.findByTestId("dashboard-pane");

    // 切编辑器：改面板标题 + kpi 值
    fireEvent.click(screen.getByTestId("dashboard-edit"));
    const editor = await screen.findByTestId("dashboard-editor");
    const kpiRow = within(editor)
      .getAllByTestId("editor-panel")
      .find((el) => el.getAttribute("data-panel-id") === "k1")!;
    fireEvent.change(within(kpiRow).getByTestId("editor-panel-title"), {
      target: { value: "CPI 环比" },
    });
    fireEvent.change(within(kpiRow).getByTestId("editor-kpi-value"), {
      target: { value: "1.8" },
    });
    fireEvent.click(within(editor).getByTestId("editor-save"));

    // PUT 信封 + 新版本提示 + 列表行版本号 v2
    expect((await screen.findByTestId("editor-saved-version")).textContent).toContain("v2");
    const put = backend.calls.find((c) => c.method === "PUT");
    expect(put?.url.pathname).toBe("/api/v1/artifacts/31");
    expect(JSON.stringify(put?.body)).toContain("CPI 环比");
    await waitFor(() => {
      expect(within(rowOf(31)).getByTestId("artifact-version").textContent).toBe("v2");
    });

    // 返回查看：新版本内容生效（保存后基线已推进，不触发 confirm）
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm); // happy-dom 无原生 confirm：打桩
    fireEvent.click(within(editor).getByTestId("editor-exit"));
    expect(confirm).not.toHaveBeenCalled();
    expect(
      screen
        .getAllByTestId("dashboard-panel-title")
        .some((el) => el.textContent === "CPI 环比"),
    ).toBe(true);
    expect(screen.getByTestId("dashboard-kpi-value").textContent).toBe("1.8");
  });

  it("legacy 仪表盘：旧版自由格式 + 只读 JSON；编辑入口禁用", async () => {
    install();
    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");

    fireEvent.click(within(rowOf(33)).getByTestId("artifact-dashboard-view"));
    expect(await screen.findByTestId("dashboard-legacy")).toBeTruthy();
    expect(screen.getByTestId("dashboard-legacy-json").textContent).toContain(
      "CN_CPI_YOY",
    );
    expect((screen.getByTestId("dashboard-edit") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("archived 仪表盘：只读徽标 + 编辑入口禁用（渲染不受影响）", async () => {
    install();
    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");

    fireEvent.click(within(rowOf(34)).getByTestId("artifact-dashboard-view"));
    expect(await screen.findByTestId("dashboard-pane")).toBeTruthy();
    expect(screen.getByTestId("dashboard-renderer")).toBeTruthy();
    expect(screen.getByTestId("dashboard-kpi-value").textContent).toBe("2.1");
    expect((screen.getByTestId("dashboard-edit") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("看板加载失败如实呈现错误态", async () => {
    const failing = installConsoleBackend([]);
    failing.addLifecycleArtifact({
      id: 41,
      kind: "dashboard",
      title: "幽灵看板",
      spec: V1_DASHBOARD_SPEC,
    });
    // 覆盖详情路由：GET /api/v1/artifacts/41 一律 404（列表仍走假后端）
    const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://console.test");
      if (
        url.pathname === "/api/v1/artifacts/41" &&
        (init?.method ?? "GET").toUpperCase() === "GET"
      ) {
        return { ok: false, status: 404, json: () => Promise.resolve({ detail: "artifact not found" }) };
      }
      return failing.fetchImpl(input as RequestInfo, init);
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", wrapped);

    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");
    fireEvent.click(within(rowOf(41)).getByTestId("artifact-dashboard-view"));
    expect(await screen.findByTestId("dashboard-load-error")).toBeTruthy();
  });
});
