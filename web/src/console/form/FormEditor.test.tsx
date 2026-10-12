// 表单构建器组件测试（wire-form-builder 任务 4.3）：
// 数据集下拉（tier/行数提示）→ 列勾选生成字段（默认 label=列名、input 按
// 列类型建议、顺序=数据集列序）→ 逐字段改 label/input/required/select
// options → submitLabel/successMessage 可配 → 保存走既有 PUT（信封口径
// 断言）；未绑数据集保存允许（构建中间态）；结构自检零请求拦截；未保存
// 离开 confirm。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "../../i18n";
import i18n from "../../i18n";
import { FormEditor } from "./FormEditor";
import type { FormSpecBody } from "./formSpec";
import { installConsoleBackend, seedConsoleSession } from "../testing";

const DATASETS = [
  {
    id: "ds-sales",
    key: "ds_sales",
    name: "门店销量",
    source_kind: "upload" as const,
    connector_id: null,
    source_ref: null,
    columns: [
      { name: "city", type: "TEXT" },
      { name: "amount", type: "REAL" },
      { name: "reported_on", type: "DATE" },
    ],
    row_count: 120,
    size_bytes: 2880,
    sync_cron: null,
    sync_status: "ok" as const,
    paused_reason: null,
    created_at: "2026-10-01T08:00:00",
    updated_at: "2026-10-01T08:00:00",
    customer_id: "demo-customer",
    // storage_tier 容错读取（免费档响应带才显示 tier 提示）。
    storage_tier: "api",
  },
  {
    id: "ds-visits",
    key: "ds_visits",
    name: "访客登记",
    source_kind: "upload" as const,
    connector_id: null,
    source_ref: null,
    columns: [{ name: "visitor", type: "TEXT" }],
    row_count: 12,
    size_bytes: 300,
    sync_cron: null,
    sync_status: "ok" as const,
    paused_reason: null,
    created_at: "2026-10-02T08:00:00",
    updated_at: "2026-10-02T08:00:00",
    customer_id: "demo-customer",
  },
];

const INITIAL_BODY: FormSpecBody = { datasetId: null, fields: [] };

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
  const backend = installConsoleBackend([], { datasets: DATASETS });
  backend.addLifecycleArtifact({
    id: 31,
    kind: "form",
    title: "门店日报表",
    version: 1,
    spec: { title: "门店日报表", spec: { title: "门店日报表", datasetId: null, fields: [] } },
  });
  vi.stubGlobal("fetch", backend.fetchImpl);
  return backend;
}

/** 打开编辑器（等待数据集列表就绪）。 */
async function openEditor() {
  const backend = install();
  render(
    <FormEditor
      artifactId={31}
      initial={{ title: "门店日报表", body: INITIAL_BODY }}
      onSaved={vi.fn()}
      onExit={vi.fn()}
    />,
  );
  const datasetSelect = (await screen.findByTestId(
    "editor-form-dataset",
  )) as HTMLSelectElement;
  await waitFor(() => {
    expect(datasetSelect.options.length).toBeGreaterThanOrEqual(3); // 占位 + 两数据集
  });
  return { backend, datasetSelect };
}

function columnCheckbox(name: string): HTMLInputElement {
  return screen
    .getAllByTestId("editor-form-column")
    .find((el) => el.getAttribute("data-column") === name)! as HTMLInputElement;
}

function fieldRow(column: string): HTMLElement {
  return screen
    .getAllByTestId("editor-field")
    .find((el) => el.getAttribute("data-column") === column)!;
}

describe("FormEditor（构建器）", () => {
  it("数据集下拉带 tier/行数提示；选数据集后按列序呈现列勾选", async () => {
    const { datasetSelect } = await openEditor();

    // tier 提示（storage_tier 响应带）与行数；无 tier 的回退纯行数文案
    const optionTexts = [...datasetSelect.options].map((o) => o.textContent ?? "");
    expect(optionTexts.some((text) => text.includes("门店销量") && text.includes("轻量存储") && text.includes("120"))).toBe(true);
    expect(optionTexts.some((text) => text.includes("访客登记") && text.includes("12"))).toBe(true);

    fireEvent.change(datasetSelect, { target: { value: "ds-sales" } });
    expect(
      screen
        .getAllByTestId("editor-form-column")
        .map((el) => el.getAttribute("data-column")),
    ).toEqual(["city", "amount", "reported_on"]);
  });

  it("勾列成字段：默认 label=列名、input 按列类型建议、顺序=数据集列序（与勾选先后无关）", async () => {
    const { backend, datasetSelect } = await openEditor();
    fireEvent.change(datasetSelect, { target: { value: "ds-sales" } });

    // 反序勾选（先日期再城市再金额）：字段仍按数据集列序
    fireEvent.click(columnCheckbox("reported_on"));
    fireEvent.click(columnCheckbox("city"));
    fireEvent.click(columnCheckbox("amount"));

    expect(
      screen
        .getAllByTestId("editor-field")
        .map((el) => el.getAttribute("data-column")),
    ).toEqual(["city", "amount", "reported_on"]);
    expect(
      (within(fieldRow("amount")).getByTestId("editor-field-label") as HTMLInputElement)
        .value,
    ).toBe("amount");
    expect(
      (within(fieldRow("amount")).getByTestId("editor-field-input") as HTMLSelectElement)
        .value,
    ).toBe("number");
    expect(
      (within(fieldRow("reported_on")).getByTestId("editor-field-input") as HTMLSelectElement)
        .value,
    ).toBe("date");
    expect(
      (within(fieldRow("city")).getByTestId("editor-field-input") as HTMLSelectElement)
        .value,
    ).toBe("text");
    expect(backend.calls.filter((c) => c.method === "PUT")).toHaveLength(0);

    // 取消勾选即移除该字段
    fireEvent.click(columnCheckbox("amount"));
    expect(
      screen
        .getAllByTestId("editor-field")
        .map((el) => el.getAttribute("data-column")),
    ).toEqual(["city", "reported_on"]);
  });

  it("改配置 + 保存：PUT 信封口径请求体（label/input/required/options/文案/缺省键不落）", async () => {
    const { backend, datasetSelect } = await openEditor();
    fireEvent.change(datasetSelect, { target: { value: "ds-sales" } });
    fireEvent.click(columnCheckbox("city"));
    fireEvent.click(columnCheckbox("amount"));

    // city：改 label + 转 select + 配选项 + 必填
    fireEvent.change(within(fieldRow("city")).getByTestId("editor-field-label"), {
      target: { value: "门店城市" },
    });
    fireEvent.change(within(fieldRow("city")).getByTestId("editor-field-input"), {
      target: { value: "select" },
    });
    fireEvent.change(within(fieldRow("city")).getByTestId("editor-field-options"), {
      target: { value: "上海, 北京 ,  " },
    });
    fireEvent.click(within(fieldRow("city")).getByTestId("editor-field-required"));

    // amount：必填勾上（number 建议保留）
    fireEvent.click(within(fieldRow("amount")).getByTestId("editor-field-required"));

    // 文案：submitLabel 配置；successMessage 留空（缺省键不落）
    fireEvent.change(screen.getByTestId("editor-form-submit-label"), {
      target: { value: "上报" },
    });
    fireEvent.change(screen.getByTestId("editor-form-title"), {
      target: { value: "门店日报表（修订）" },
    });

    fireEvent.click(screen.getByTestId("editor-form-save"));
    expect(
      (await screen.findByTestId("editor-form-saved-version")).textContent,
    ).toContain("v2");

    const put = backend.calls.find((c) => c.method === "PUT");
    expect(put?.url.pathname).toBe("/api/v1/artifacts/31");
    expect(put?.body).toEqual({
      spec: {
        title: "门店日报表（修订）",
        spec: {
          datasetId: "ds-sales",
          fields: [
            {
              column: "city",
              label: "门店城市",
              input: "select",
              required: true,
              options: ["上海", "北京"],
            },
            {
              column: "amount",
              label: "amount",
              input: "number",
              required: true,
            },
          ],
          submitLabel: "上报",
        },
      },
    });
  });

  it("未绑数据集保存允许（构建中间态）：PUT 落 datasetId=null + 零字段", async () => {
    const { backend } = await openEditor();
    fireEvent.click(screen.getByTestId("editor-form-save"));
    expect(
      (await screen.findByTestId("editor-form-saved-version")).textContent,
    ).toContain("v2");
    const put = backend.calls.find((c) => c.method === "PUT");
    expect(put?.body).toEqual({
      spec: {
        title: "门店日报表",
        spec: { datasetId: null, fields: [] },
      },
    });
  });

  it("结构自检零请求拦截：select 无 options 时错误呈现、不发 PUT；配齐后可存", async () => {
    const { backend, datasetSelect } = await openEditor();
    fireEvent.change(datasetSelect, { target: { value: "ds-sales" } });
    fireEvent.click(columnCheckbox("city"));
    fireEvent.change(within(fieldRow("city")).getByTestId("editor-field-input"), {
      target: { value: "select" },
    });

    fireEvent.click(screen.getByTestId("editor-form-save"));
    expect(
      (await screen.findByTestId("editor-form-error")).textContent,
    ).toContain("下拉选择");
    expect(backend.calls.filter((c) => c.method === "PUT")).toHaveLength(0);

    // 配齐选项后保存通过、错误清空
    fireEvent.change(within(fieldRow("city")).getByTestId("editor-field-options"), {
      target: { value: "上海, 北京" },
    });
    fireEvent.click(screen.getByTestId("editor-form-save"));
    expect(
      await screen.findByTestId("editor-form-saved-version"),
    ).toBeTruthy();
    expect(screen.queryByTestId("editor-form-error")).toBeNull();
  });

  it("空标题：保存按钮禁用（前端先拦）", async () => {
    await openEditor();
    fireEvent.change(screen.getByTestId("editor-form-title"), {
      target: { value: "   " },
    });
    expect(
      (screen.getByTestId("editor-form-save") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("未保存离开 confirm：取消留在编辑，确认后 onExit；未改动直接退出不 confirm", async () => {
    install();
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm); // happy-dom 无原生 confirm：打桩
    const onExit = vi.fn();
    render(
      <FormEditor
        artifactId={31}
        initial={{ title: "门店日报表", body: INITIAL_BODY }}
        onSaved={vi.fn()}
        onExit={onExit}
      />,
    );
    await screen.findAllByTestId("editor-form-dataset");

    // 未改动：直接退出，不 confirm
    fireEvent.click(screen.getByTestId("editor-form-exit"));
    expect(confirm).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("有未保存改动：confirm 拦截（取消留在编辑、确认后 onExit）", async () => {
    install();
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);
    const onExit = vi.fn();
    render(
      <FormEditor
        artifactId={31}
        initial={{ title: "门店日报表", body: INITIAL_BODY }}
        onSaved={vi.fn()}
        onExit={onExit}
      />,
    );
    const select = (await screen.findByTestId(
      "editor-form-dataset",
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(select.options.length).toBeGreaterThanOrEqual(2);
    });

    fireEvent.change(select, { target: { value: "ds-sales" } });
    confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByTestId("editor-form-exit"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled(); // 仍停留在编辑

    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByTestId("editor-form-exit"));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("数据集列表加载失败如实呈现（detail），可重试", async () => {
    const backend = installConsoleBackend([], { datasets: DATASETS });
    backend.addLifecycleArtifact({
      id: 31,
      kind: "form",
      title: "门店日报表",
      spec: { title: "门店日报表", spec: { datasetId: null, fields: [] } },
    });
    const original = backend.fetchImpl;
    let failOnce = true;
    vi.stubGlobal(
      "fetch",
      ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://console.test");
        if (failOnce && url.pathname === "/api/v1/datasets") {
          failOnce = false;
          return Promise.resolve({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ detail: "数据集服务暂不可用" }),
          });
        }
        return original(input, init);
      }) as unknown as typeof fetch,
    );

    render(
      <FormEditor
        artifactId={31}
        initial={{ title: "门店日报表", body: INITIAL_BODY }}
        onSaved={vi.fn()}
        onExit={vi.fn()}
      />,
    );
    expect(
      await screen.findByText("数据集服务暂不可用"),
    ).toBeTruthy();
    // 重试成功：下拉出数据集
    fireEvent.click(screen.getByTestId("editor-form-datasets-retry"));
    const select = (await screen.findByTestId(
      "editor-form-dataset",
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(select.options.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// ------------------------------------- 显隐条件编辑（wire-form-field-linkage）

describe("FormEditor（显隐条件编辑）", () => {
  /** 字段卡条件区的查询域（每次现查——重渲染后不持旧 DOM 引用）。 */
  function conditionArea(column: string): ReturnType<typeof within> {
    return within(fieldRow(column));
  }

  /** 勾 city+amount 两字段并配 amount 的显隐条件（当字段=city、算子、值）。 */
  async function openWithTwoFields(op: string, value?: string) {
    const { backend, datasetSelect } = await openEditor();
    fireEvent.change(datasetSelect, { target: { value: "ds-sales" } });
    fireEvent.click(columnCheckbox("city"));
    fireEvent.click(columnCheckbox("amount"));

    // 开关打开：默认条件=当字段取首个其他字段（city）、算子等于、值空
    fireEvent.click(
      within(fieldRow("amount")).getByTestId("editor-field-condition-toggle"),
    );
    expect(
      (conditionArea("amount").getByTestId(
        "editor-field-condition-field",
      ) as HTMLSelectElement).value,
    ).toBe("city");
    fireEvent.change(
      conditionArea("amount").getByTestId("editor-field-condition-op"),
      { target: { value: op } },
    );
    if (value !== undefined) {
      fireEvent.change(
        conditionArea("amount").getByTestId("editor-field-condition-value"),
        { target: { value } },
      );
    }
    return { backend };
  }

  /** 最近一次 PUT 的 spec.spec。 */
  function lastSavedSpec(backend: ReturnType<typeof install>): {
    datasetId: string | null;
    fields: Array<{ column: string; visibleWhen?: unknown }>;
  } {
    const puts = backend.calls.filter((c) => c.method === "PUT");
    return (puts[puts.length - 1]?.body as {
      spec: { spec: { datasetId: string | null; fields: Array<{ column: string; visibleWhen?: unknown }> } };
    }).spec.spec;
  }

  it("配条件往返保存：spec 里 visibleWhen 落形（当字段/算子/值）", async () => {
    const { backend } = await openWithTwoFields("eq", "上海");
    fireEvent.click(screen.getByTestId("editor-form-save"));
    expect(
      await screen.findByTestId("editor-form-saved-version"),
    ).toBeTruthy();

    const spec = lastSavedSpec(backend);
    expect(spec.fields.find((f) => f.column === "amount")?.visibleWhen).toEqual(
      { field: "city", op: "eq", value: "上海" },
    );
  });

  it("清除条件：一键回无条件（visibleWhen 键不落、开关回关）", async () => {
    const { backend } = await openWithTwoFields("eq", "上海");
    fireEvent.click(screen.getByTestId("editor-form-save"));
    expect(
      await screen.findByTestId("editor-form-saved-version"),
    ).toBeTruthy();

    // 清除条件：条件区收起、开关回关，保存后 PUT 载荷零 visibleWhen 键
    fireEvent.click(
      within(fieldRow("amount")).getByTestId("editor-field-condition-clear"),
    );
    expect(
      within(fieldRow("amount")).queryByTestId("editor-field-condition"),
    ).toBeNull();
    expect(
      (within(fieldRow("amount")).getByTestId("editor-field-condition-toggle") as HTMLInputElement)
        .checked,
    ).toBe(false);

    fireEvent.click(screen.getByTestId("editor-form-save"));
    expect(
      await screen.findByTestId("editor-form-saved-version"),
    ).toBeTruthy();
    const spec = lastSavedSpec(backend);
    expect(JSON.stringify(spec).includes("visibleWhen")).toBe(false);
    expect(spec.fields.find((f) => f.column === "amount")?.visibleWhen).toBeUndefined();
  });

  it("empty 算子无值控件；保存落 {field, op} 不带 value 键", async () => {
    const { backend } = await openWithTwoFields("empty");
    // 值控件随 empty 算子隐藏
    expect(
      conditionArea("amount").queryByTestId("editor-field-condition-value"),
    ).toBeNull();

    fireEvent.click(screen.getByTestId("editor-form-save"));
    expect(
      await screen.findByTestId("editor-form-saved-version"),
    ).toBeTruthy();
    const spec = lastSavedSpec(backend);
    expect(spec.fields.find((f) => f.column === "amount")?.visibleWhen).toEqual(
      { field: "city", op: "empty" },
    );
  });

  it("存量零变化：未开条件时字段卡不渲染条件区，保存载荷零 visibleWhen 键", async () => {
    const { backend, datasetSelect } = await openEditor();
    fireEvent.change(datasetSelect, { target: { value: "ds-sales" } });
    fireEvent.click(columnCheckbox("city"));
    expect(
      within(fieldRow("city")).queryByTestId("editor-field-condition"),
    ).toBeNull();
    expect(
      (within(fieldRow("city")).getByTestId("editor-field-condition-toggle") as HTMLInputElement)
        .checked,
    ).toBe(false);

    fireEvent.click(screen.getByTestId("editor-form-save"));
    expect(
      await screen.findByTestId("editor-form-saved-version"),
    ).toBeTruthy();
    expect(
      JSON.stringify(lastSavedSpec(backend)).includes("visibleWhen"),
    ).toBe(false);
  });
});
