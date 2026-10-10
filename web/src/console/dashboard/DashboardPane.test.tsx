// 产物页 dashboard 集成测试（wire-dashboard-renderer 任务 4.1 / 5.1，组件级）：
// - dashboard kind 卡片「查看看板」内嵌展开（不走路由）→ 三类面板渲染；
// - 「编辑」切编辑器 → 改标题保存 v2（PUT）→ 返回查看新版本生效；
// - legacy spec 只读 + 编辑禁用；archived 只读；非 dashboard kind 无入口。
// wire-dashboard-refresh 任务 2.2：查看态「刷新数据」——成功流（POST refresh
// 落新版本 → 提示 + 重拉详情重渲染）/ 失败态（502/403 detail 如实）/ 409 单飞
// 进行中提示 / archived 无按钮。
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

  it("archived 仪表盘：只读徽标 + 编辑入口禁用（渲染不受影响）+ 无刷新入口", async () => {
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
    expect(screen.queryByTestId("dashboard-refresh")).toBeNull(); // archived 不可刷
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

describe("看板手动刷新（wire-dashboard-refresh 任务 2.1/2.2）", () => {
  /** 刷新后的新快照：kpi 值 2.1 → 3.4（重渲染断言锚点）。 */
  const REFRESHED_SPEC = JSON.parse(JSON.stringify(V1_DASHBOARD_SPEC)) as typeof V1_DASHBOARD_SPEC;
  (
    REFRESHED_SPEC.spec.panels[0]!.snapshot as { rows: Array<Array<string | number | null>> }
  ).rows[0]![0] = 3.4;

  /** 包一层 fetch：POST /artifacts/31/refresh 注入失败态（其余透传真后端）。 */
  function withRefreshFailure(
    backend: ReturnType<typeof installConsoleBackend>,
    status: number,
    detail: string,
  ): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://console.test");
      if (
        url.pathname === "/api/v1/artifacts/31/refresh" &&
        (init?.method ?? "GET").toUpperCase() === "POST"
      ) {
        return { ok: false, status, json: () => Promise.resolve({ detail }) };
      }
      return backend.fetchImpl(input as RequestInfo, init);
    }) as unknown as typeof fetch;
  }

  /** 打开 31 号看板的查看态（返回 pane 就绪后的断言起点）。 */
  async function openDashboard31() {
    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");
    fireEvent.click(within(rowOf(31)).getByTestId("artifact-dashboard-view"));
    await screen.findByTestId("dashboard-pane");
    expect(screen.getByTestId("dashboard-kpi-value").textContent).toBe("2.1");
  }

  it("成功流：进行中 loading 禁用 → v2 提示 → 重拉详情重渲染 + 行版本号同步", async () => {
    const backend = install();
    let refreshed = false;
    const refreshCalls: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://console.test");
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.pathname === "/api/v1/artifacts/31/refresh" && method === "POST") {
        refreshCalls.push(`${method} ${url.pathname}`);
        return gate.then(() => ({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ version: 2, refreshed_at: "2026-10-11T09:00:00" }),
        }));
      }
      if (refreshed && url.pathname === "/api/v1/artifacts/31" && method === "GET") {
        // 刷新落地后的详情：v2 + 新快照（模拟服务端已按刷新结果落版本）
        const base = (await backend.fetchImpl(input, init)) as {
          json: () => Promise<Record<string, unknown>>;
        };
        const body = await base.json();
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ...body, version: 2, spec: REFRESHED_SPEC }),
        };
      }
      return backend.fetchImpl(input as RequestInfo, init);
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", wrapped);

    await openDashboard31();

    fireEvent.click(screen.getByTestId("dashboard-refresh"));
    // 进行中：按钮禁用 + loading 文案（POST 已发出、门未放行）
    expect(refreshCalls).toEqual(["POST /api/v1/artifacts/31/refresh"]);
    expect((screen.getByTestId("dashboard-refresh") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("dashboard-refresh").textContent).toContain("刷新中");

    release();
    refreshed = true;

    // 成功：新版本号提示 + 重拉详情重渲染（2.1 → 3.4）
    expect((await screen.findByTestId("dashboard-refresh-success")).textContent).toContain("v2");
    await waitFor(() => {
      expect(screen.getByTestId("dashboard-kpi-value").textContent).toBe("3.4");
    });
    // 行版本号经 onSaved 同步为 v2，按钮恢复可用
    await waitFor(() => {
      expect(within(rowOf(31)).getByTestId("artifact-version").textContent).toBe("v2");
    });
    expect((screen.getByTestId("dashboard-refresh") as HTMLButtonElement).disabled).toBe(false);
  });

  it("失败态（502）：引擎失败 detail 如实呈现，旧快照不受影响", async () => {
    const backend = install();
    vi.stubGlobal(
      "fetch",
      withRefreshFailure(backend, 502, "刷新执行失败：LLM 输出解析失败（不是合法 spec JSON）"),
    );

    await openDashboard31();
    fireEvent.click(screen.getByTestId("dashboard-refresh"));

    expect((await screen.findByTestId("dashboard-refresh-error")).textContent).toContain(
      "LLM 输出解析失败",
    );
    // 零半写：视图仍是旧快照；按钮恢复可重试
    expect(screen.getByTestId("dashboard-kpi-value").textContent).toBe("2.1");
    expect((screen.getByTestId("dashboard-refresh") as HTMLButtonElement).disabled).toBe(false);
  });

  it("档位边界（403）：免费档提示 detail 如实呈现（升档引导）", async () => {
    const backend = install();
    vi.stubGlobal(
      "fetch",
      withRefreshFailure(backend, 403, "数据刷新需开通基础档及以上（当前档位：免费档）"),
    );

    await openDashboard31();
    fireEvent.click(screen.getByTestId("dashboard-refresh"));

    expect((await screen.findByTestId("dashboard-refresh-error")).textContent).toContain(
      "基础档及以上",
    );
  });

  it("单飞（409）：刷新进行中提示，不显示后端机口径 detail", async () => {
    const backend = install();
    vi.stubGlobal(
      "fetch",
      withRefreshFailure(backend, 409, "refresh in progress"),
    );

    await openDashboard31();
    fireEvent.click(screen.getByTestId("dashboard-refresh"));

    const error = await screen.findByTestId("dashboard-refresh-error");
    expect(error.textContent).toContain("刷新进行中");
    expect(error.textContent).not.toContain("refresh in progress"); // 固定人话文案
    expect((screen.getByTestId("dashboard-refresh") as HTMLButtonElement).disabled).toBe(false);
  });
});
