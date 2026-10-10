// 仪表盘编辑器组件测试（wire-dashboard-renderer 任务 3.3）：
// 面板增（选 type 出模板）/删/改标题/移序/span 切换、kpi 值+单位+副标题
// 表单编辑、实时预览复用渲染器、保存走 PUT（信封口径断言 + 新版本号提示）、
// 未保存离开 confirm、归档 409 如实呈现。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "../../i18n";
import i18n from "../../i18n";
import { DashboardEditor } from "./DashboardEditor";
import { installConsoleBackend, seedConsoleSession } from "../testing";
import type { DashboardSpecV1 } from "./spec";

const INITIAL: DashboardSpecV1 = {
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
  ],
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

/** 装假后端 + 种子 dashboard 产物（v1，spec 与 INITIAL 同步）。 */
function install() {
  const backend = installConsoleBackend([]);
  backend.addLifecycleArtifact({
    id: 21,
    kind: "dashboard",
    title: "宏观仪表盘",
    version: 1,
    spec: {
      title: "宏观仪表盘",
      spec: JSON.parse(JSON.stringify(INITIAL)) as DashboardSpecV1,
    },
  });
  vi.stubGlobal("fetch", backend.fetchImpl);
  return backend;
}

/** 按面板 id 定位编辑行。 */
function editorPanel(id: string): HTMLElement {
  return screen
    .getAllByTestId("editor-panel")
    .find((el) => el.getAttribute("data-panel-id") === id)!;
}

describe("DashboardEditor（基础编辑器 v1）", () => {
  it("渲染初态 + 实时预览复用渲染器", () => {
    install();
    render(
      <DashboardEditor artifactId={21} initial={INITIAL} onSaved={vi.fn()} onExit={vi.fn()} />,
    );
    expect(screen.getAllByTestId("editor-panel")).toHaveLength(2);
    expect((screen.getByTestId("editor-dashboard-title") as HTMLInputElement).value).toBe(
      "宏观仪表盘",
    );
    // 预览即渲染器
    expect(screen.getByTestId("dashboard-renderer")).toBeTruthy();
    expect(screen.getByTestId("dashboard-kpi-value").textContent).toBe("2.1");
  });

  it("增（选 type 出模板）/删面板，预览同步", () => {
    install();
    render(
      <DashboardEditor artifactId={21} initial={INITIAL} onSaved={vi.fn()} onExit={vi.fn()} />,
    );

    // 添加 table 面板：模板带两列空表 → 预览「无数据」如实呈现
    fireEvent.change(screen.getByTestId("editor-add-type"), {
      target: { value: "table" },
    });
    fireEvent.click(screen.getByTestId("editor-add-panel"));
    expect(screen.getAllByTestId("editor-panel")).toHaveLength(3);
    const added = screen
      .getAllByTestId("editor-panel")
      .find((el) => el.getAttribute("data-panel-type") === "table")!;
    expect(added.getAttribute("data-panel-id")).toBe("p1"); // id 生成器避开既有 id
    expect(screen.getAllByTestId("dashboard-panel")).toHaveLength(3);
    expect(screen.getAllByTestId("dashboard-no-data").length).toBeGreaterThanOrEqual(1);

    // 删除 kpi 面板
    fireEvent.click(within(editorPanel("k1")).getByTestId("editor-panel-remove"));
    expect(screen.getAllByTestId("editor-panel")).toHaveLength(2);
    expect(screen.queryByTestId("dashboard-kpi-value")).toBeNull();
  });

  it("改面板标题：预览实时更新", async () => {
    install();
    render(
      <DashboardEditor artifactId={21} initial={INITIAL} onSaved={vi.fn()} onExit={vi.fn()} />,
    );
    fireEvent.change(within(editorPanel("k1")).getByTestId("editor-panel-title"), {
      target: { value: "CPI 环比" },
    });
    await waitFor(() => {
      expect(
        screen
          .getAllByTestId("dashboard-panel-title")
          .some((el) => el.textContent === "CPI 环比"),
      ).toBe(true);
    });
  });

  it("移序（左移/右移）与 span 三档切换", async () => {
    install();
    render(
      <DashboardEditor artifactId={21} initial={INITIAL} onSaved={vi.fn()} onExit={vi.fn()} />,
    );

    // 左移第二个面板（PMI）到首位
    fireEvent.click(within(editorPanel("l1")).getByTestId("editor-panel-move-left"));
    await waitFor(() => {
      expect(
        screen.getAllByTestId("editor-panel").map((el) => el.getAttribute("data-panel-id")),
      ).toEqual(["l1", "k1"]);
    });
    // 右移回去
    fireEvent.click(within(editorPanel("l1")).getByTestId("editor-panel-move-right"));
    await waitFor(() => {
      expect(
        screen.getAllByTestId("editor-panel").map((el) => el.getAttribute("data-panel-id")),
      ).toEqual(["k1", "l1"]);
    });

    // kpi 面板 span 切到 3：预览栅格类同步
    fireEvent.click(
      within(editorPanel("k1"))
        .getAllByTestId("editor-panel-span")
        .find((el) => el.getAttribute("data-span") === "3")!,
    );
    await waitFor(() => {
      const previewPanel = screen
        .getAllByTestId("dashboard-panel")
        .find((el) => el.getAttribute("data-panel-id") === "k1")!;
      expect(previewPanel.className).toContain("md:col-span-3");
    });
  });

  it("kpi 表单编辑：值（数字进 snapshot.rows[0][0]）/单位/副标题实时进预览", async () => {
    install();
    render(
      <DashboardEditor artifactId={21} initial={INITIAL} onSaved={vi.fn()} onExit={vi.fn()} />,
    );
    const panel = editorPanel("k1");
    fireEvent.change(within(panel).getByTestId("editor-kpi-value"), {
      target: { value: "3.4" },
    });
    fireEvent.change(within(panel).getByTestId("editor-kpi-unit"), {
      target: { value: "‰" },
    });
    fireEvent.change(within(panel).getByTestId("editor-kpi-subtitle"), {
      target: { value: "2026-10" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("dashboard-kpi-value").textContent).toBe("3.4");
      expect(screen.getByTestId("dashboard-kpi-unit").textContent).toBe("‰");
      expect(screen.getByTestId("dashboard-kpi-subtitle").textContent).toBe("2026-10");
    });
  });

  it("保存走既有 PUT：信封口径请求体 + 新版本号提示 + 基线推进（再退出不 confirm）", async () => {
    const backend = install();
    const onSaved = vi.fn();
    render(
      <DashboardEditor artifactId={21} initial={INITIAL} onSaved={onSaved} onExit={vi.fn()} />,
    );

    // 改标题 + kpi 值，保存
    fireEvent.change(screen.getByTestId("editor-dashboard-title"), {
      target: { value: "宏观仪表盘（修订）" },
    });
    fireEvent.change(within(editorPanel("k1")).getByTestId("editor-kpi-value"), {
      target: { value: "3.4" },
    });
    fireEvent.click(screen.getByTestId("editor-save"));

    expect((await screen.findByTestId("editor-saved-version")).textContent).toContain("v2");
    const put = backend.calls.find((c) => c.method === "PUT");
    expect(put?.url.pathname).toBe("/api/v1/artifacts/21");
    // 请求体是信封口径：title + spec 内层 v1 本体（值已数字进 rows[0][0]）
    expect(put?.body).toEqual({
      spec: {
        title: "宏观仪表盘（修订）",
        spec: {
          title: "宏观仪表盘（修订）",
          panels: [
            expect.objectContaining({
              id: "k1",
              snapshot: { columns: ["value"], rows: [[3.4]] },
            }),
            INITIAL.panels[1],
          ],
        },
      },
    });
    expect(onSaved).toHaveBeenCalledTimes(1);

    // 保存后基线推进：退出不再 confirm
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm); // happy-dom 无原生 confirm：打桩
    fireEvent.click(screen.getByTestId("editor-exit"));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("未保存离开 confirm：取消留在编辑，确认后 onExit", () => {
    install();
    const onExit = vi.fn();
    render(
      <DashboardEditor artifactId={21} initial={INITIAL} onSaved={vi.fn()} onExit={onExit} />,
    );

    // 未改动：直接退出，不 confirm
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm); // happy-dom 无原生 confirm：打桩
    fireEvent.click(screen.getByTestId("editor-exit"));
    expect(confirm).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledTimes(1);

    // 有未保存改动：confirm 拦截
    fireEvent.change(within(editorPanel("k1")).getByTestId("editor-panel-title"), {
      target: { value: "改了" },
    });
    confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByTestId("editor-exit"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1); // 仍停留在编辑

    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByTestId("editor-exit"));
    expect(onExit).toHaveBeenCalledTimes(2);
  });

  it("保存失败如实呈现服务端错误（如归档 409）", async () => {
    const backend = installConsoleBackend([]);
    backend.addLifecycleArtifact({
      id: 22,
      kind: "dashboard",
      title: "已归档看板",
      status: "archived",
      spec: {
        title: "已归档看板",
        spec: JSON.parse(JSON.stringify(INITIAL)) as DashboardSpecV1,
      },
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(
      <DashboardEditor artifactId={22} initial={INITIAL} onSaved={vi.fn()} onExit={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("editor-save"));
    expect((await screen.findByTestId("editor-server-error")).textContent).toContain(
      "已归档",
    );
  });
});

describe("DashboardEditor v2（wire-dashboard-editor-v2 任务 1.2/1.3）", () => {
  /** PUT 请求体里指定面板（信封口径内层）。 */
  function savedPanel(backend: ReturnType<typeof installConsoleBackend>, id: string) {
    const put = backend.calls.find((c) => c.method === "PUT");
    const body = put?.body as { spec: { spec: { panels: DashboardSpecV1["panels"] } } };
    return body.spec.spec.panels.find((p) => p.id === id);
  }

  it("类型互转保数据：折线→表格零损失（图表类互转不 confirm），保存后 snapshot 原样", async () => {
    const backend = install();
    render(
      <DashboardEditor artifactId={21} initial={INITIAL} onSaved={vi.fn()} onExit={vi.fn()} />,
    );
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm); // happy-dom 无原生 confirm：打桩

    fireEvent.change(within(editorPanel("l1")).getByTestId("editor-panel-convert"), {
      target: { value: "table" },
    });
    await waitFor(() => {
      expect(editorPanel("l1").getAttribute("data-panel-type")).toBe("table");
    });
    expect(confirm).not.toHaveBeenCalled(); // line→table 无信息取舍，不确认
    // 预览：同一快照以表格呈现（2 行）
    expect(screen.getByTestId("dashboard-table").querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.queryByTestId("dashboard-chart")).toBeNull();

    // 保存：PUT 里 type 已换、snapshot 逐字保留
    fireEvent.click(screen.getByTestId("editor-save"));
    await screen.findByTestId("editor-saved-version");
    const saved = savedPanel(backend, "l1");
    expect(saved?.type).toBe("table");
    expect(saved?.snapshot).toEqual(INITIAL.panels[1]!.snapshot);
  });

  it("kpi↔图表互转需确认：取消不动，确认后落地", async () => {
    install();
    render(
      <DashboardEditor artifactId={21} initial={INITIAL} onSaved={vi.fn()} onExit={vi.fn()} />,
    );
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);

    // 第一次：取消 → 面板仍是 kpi
    confirm.mockReturnValueOnce(false);
    fireEvent.change(within(editorPanel("k1")).getByTestId("editor-panel-convert"), {
      target: { value: "bar" },
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(editorPanel("k1").getAttribute("data-panel-type")).toBe("kpi");

    // 第二次：确认 → 转为 bar
    confirm.mockReturnValueOnce(true);
    fireEvent.change(within(editorPanel("k1")).getByTestId("editor-panel-convert"), {
      target: { value: "bar" },
    });
    await waitFor(() => {
      expect(editorPanel("k1").getAttribute("data-panel-type")).toBe("bar");
    });
    // kpi 表单退场（值/单位/副标题不再呈现——config 表单按新 type 分发）
    expect(within(editorPanel("k1")).queryByTestId("editor-kpi-value")).toBeNull();
  });

  it("面板复制：新 id + 副本标题 + 深拷贝数据，独立编辑不波及原件", async () => {
    install();
    render(
      <DashboardEditor artifactId={21} initial={INITIAL} onSaved={vi.fn()} onExit={vi.fn()} />,
    );

    fireEvent.click(within(editorPanel("k1")).getByTestId("editor-panel-duplicate"));
    await waitFor(() => {
      expect(screen.getAllByTestId("editor-panel")).toHaveLength(3);
    });
    const copy = screen
      .getAllByTestId("editor-panel")
      .find((el) => el.getAttribute("data-panel-id") === "p1")!;
    expect(copy).toBeTruthy(); // 新 id 避开 k1/l1 占用
    expect(
      (within(copy).getByTestId("editor-panel-title") as HTMLInputElement).value,
    ).toBe("CPI 同比副本");
    // 预览两份 kpi 同值（深拷贝生效）
    expect(screen.getAllByTestId("dashboard-kpi-value").map((el) => el.textContent)).toEqual([
      "2.1",
      "2.1",
    ]);

    // 独立编辑：改副本值，原件不动
    fireEvent.change(within(copy).getByTestId("editor-kpi-value"), {
      target: { value: "9.9" },
    });
    await waitFor(() => {
      expect(screen.getAllByTestId("dashboard-kpi-value").map((el) => el.textContent)).toEqual([
        "2.1",
        "9.9",
      ]);
    });
  });

  it("config 表单按 type 分发：kpi=值/单位/副标题，line/bar=x/y 轴名，table 均无", () => {
    install();
    render(
      <DashboardEditor artifactId={21} initial={INITIAL} onSaved={vi.fn()} onExit={vi.fn()} />,
    );

    const k1 = editorPanel("k1");
    expect(within(k1).getByTestId("editor-kpi-unit")).toBeTruthy();
    expect(within(k1).queryByTestId("editor-panel-xname")).toBeNull();

    const l1 = editorPanel("l1");
    expect(within(l1).queryByTestId("editor-kpi-unit")).toBeNull();
    expect((within(l1).getByTestId("editor-panel-xname") as HTMLInputElement).value).toBe("");
    expect((within(l1).getByTestId("editor-panel-yname") as HTMLInputElement).value).toBe("");

    // 新增 table 面板：无任何 config 表单（source 输入仍在）
    fireEvent.change(screen.getByTestId("editor-add-type"), { target: { value: "table" } });
    fireEvent.click(screen.getByTestId("editor-add-panel"));
    const added = screen
      .getAllByTestId("editor-panel")
      .find((el) => el.getAttribute("data-panel-type") === "table")!;
    expect(within(added).queryByTestId("editor-kpi-unit")).toBeNull();
    expect(within(added).queryByTestId("editor-panel-xname")).toBeNull();
    expect(within(added).getByTestId("editor-panel-source")).toBeTruthy();
  });

  it("source 编辑（placeholder=刷新依赖标注）+ 轴名写回：保存 PUT 断言落盘", async () => {
    const backend = install();
    render(
      <DashboardEditor artifactId={21} initial={INITIAL} onSaved={vi.fn()} onExit={vi.fn()} />,
    );

    const l1 = editorPanel("l1");
    expect(l1.querySelector('[data-testid="editor-panel-source"]')?.getAttribute("placeholder")).toContain(
      "指标 code",
    );
    fireEvent.change(within(l1).getByTestId("editor-panel-source"), {
      target: { value: "CN_PMI_OFFICIAL" },
    });
    fireEvent.change(within(l1).getByTestId("editor-panel-xname"), {
      target: { value: "月份" },
    });
    fireEvent.change(within(l1).getByTestId("editor-panel-yname"), {
      target: { value: "PMI 指数" },
    });

    fireEvent.click(screen.getByTestId("editor-save"));
    await screen.findByTestId("editor-saved-version");
    const saved = savedPanel(backend, "l1");
    expect(saved?.source).toBe("CN_PMI_OFFICIAL");
    expect(saved?.config).toEqual({ xName: "月份", yName: "PMI 指数" });
  });

  it("未保存计数：按差异面板数如实（改/增/删各计 1），保存后归零", async () => {
    install();
    render(
      <DashboardEditor artifactId={21} initial={INITIAL} onSaved={vi.fn()} onExit={vi.fn()} />,
    );
    expect(screen.queryByTestId("editor-unsaved-count")).toBeNull(); // 初态：无差异

    // 改 1 个面板 → 1 处未保存
    fireEvent.change(within(editorPanel("k1")).getByTestId("editor-panel-title"), {
      target: { value: "CPI 环比" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("editor-unsaved-count").textContent).toBe("1 处未保存");
    });

    // 再改第二个面板（span 属面板内差异）→ 2 处
    fireEvent.click(
      within(editorPanel("l1"))
        .getAllByTestId("editor-panel-span")
        .find((el) => el.getAttribute("data-span") === "3")!,
    );
    await waitFor(() => {
      expect(screen.getByTestId("editor-unsaved-count").textContent).toBe("2 处未保存");
    });

    // 删除已改的 k1：差异面板 = l1（改）+ k1（删）→ 仍 2 处
    fireEvent.click(within(editorPanel("k1")).getByTestId("editor-panel-remove"));
    await waitFor(() => {
      expect(screen.getAllByTestId("editor-panel")).toHaveLength(1);
    });
    expect(screen.getByTestId("editor-unsaved-count").textContent).toBe("2 处未保存");

    // 保存：基线推进，计数归零
    fireEvent.click(screen.getByTestId("editor-save"));
    await screen.findByTestId("editor-saved-version");
    await waitFor(() => {
      expect(screen.queryByTestId("editor-unsaved-count")).toBeNull();
    });
  });
});
