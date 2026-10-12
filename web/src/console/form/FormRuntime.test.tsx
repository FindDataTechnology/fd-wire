// 表单运行时组件测试（wire-form-builder 任务 4.2）：
// console 态提交走 corrections 端点（op=insert 归一后整行 values、带登录
// Bearer、成功显示 successMessage/缺省文案并清空重填）；必填/类型前端先拦
// （逐字段错误、零请求）；未绑数据集诚实态（不可提交）；public 态走公开
// submit 端点（t/v 透传、免登录绝不携带 Authorization、响应 message 呈现、
// 422/429 detail 如实呈现）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "../../i18n";
import i18n from "../../i18n";
import { FormRuntime } from "./FormRuntime";
import type { FormSpecBody } from "./formSpec";
import { installConsoleBackend, seedConsoleSession } from "../testing";
import type { ConsoleBackendOptions } from "../testing";

/** 种子数据集（corrections 端点需要数据集在场）。 */
const DATASET = {
  id: "ds-form-1",
  key: "ds_form_1",
  name: "门店日报",
  source_kind: "upload" as const,
  connector_id: null,
  source_ref: null,
  columns: [
    { name: "city", type: "TEXT" },
    { name: "amount", type: "REAL" },
    { name: "reported_on", type: "DATE" },
  ],
  row_count: 3,
  size_bytes: 96,
  sync_cron: null,
  sync_status: "ok" as const,
  paused_reason: null,
  created_at: "2026-10-01T08:00:00",
  updated_at: "2026-10-01T08:00:00",
};

const SPEC: FormSpecBody = {
  datasetId: "ds-form-1",
  fields: [
    { column: "city", label: "城市", input: "text", required: true },
    { column: "amount", label: "金额", input: "number" },
    { column: "reported_on", label: "上报日期", input: "date" },
    {
      column: "level",
      label: "级别",
      input: "select",
      options: ["高", "低"],
    },
  ],
  submitLabel: "上报",
  successMessage: "门店数据已收到",
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

/** 按列名定位字段行。 */
function fieldOf(column: string): HTMLElement {
  return screen
    .getAllByTestId("form-field")
    .find((el) => el.getAttribute("data-column") === column)!;
}

function fill(column: string, value: string) {
  fireEvent.change(within(fieldOf(column)).getByTestId("form-field-input"), {
    target: { value },
  });
}

function install(options: ConsoleBackendOptions = {}) {
  const backend = installConsoleBackend([], { datasets: [DATASET], ...options });
  vi.stubGlobal("fetch", backend.fetchImpl);
  return backend;
}

describe("FormRuntime（console 态：corrections 提交）", () => {
  it("渲染字段（label/必填标/选项）与自定义提交文案", () => {
    install();
    render(<FormRuntime spec={SPEC} endpoint={{ kind: "console", datasetId: "ds-form-1" }} />);

    expect(screen.getAllByTestId("form-field").length).toBe(4);
    expect(fieldOf("city").textContent).toContain("城市");
    expect(within(fieldOf("city")).getByTestId("form-field-required")).toBeTruthy();
    expect(screen.getByTestId("form-submit").textContent).toContain("上报");
    const select = within(fieldOf("level")).getByTestId(
      "form-field-input",
    ) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["", "高", "低"]);
  });

  it("提交成功：op=insert + 归一后整行 values + 登录 Bearer；successMessage 呈现并清空重填", async () => {
    const backend = install();
    render(<FormRuntime spec={SPEC} endpoint={{ kind: "console", datasetId: "ds-form-1" }} />);

    fill("city", " 上海 ");
    fill("amount", "12.5");
    fill("reported_on", "2026-10-12");
    fireEvent.change(
      within(fieldOf("level")).getByTestId("form-field-input"),
      { target: { value: "高" } },
    );
    fireEvent.click(screen.getByTestId("form-submit"));

    expect(
      (await screen.findByTestId("form-success")).textContent,
    ).toBe("门店数据已收到");

    const post = backend.calls.find(
      (c) =>
        c.method === "POST" &&
        c.url.pathname === "/api/v1/datasets/ds-form-1/corrections",
    );
    expect(post).toBeTruthy();
    expect(post?.headers["authorization"]).toMatch(/^Bearer /);
    // 载荷：op=insert + 归一 values（number 数值化、text trim、未填的缺省键不写）
    expect(post?.body).toEqual({
      op: "insert",
      values: {
        city: "上海",
        amount: 12.5,
        reported_on: "2026-10-12",
        level: "高",
      },
    });
    // 修正层落账（假后端真实信封 {correction_id} 已解包）+ 表单清空可续填
    expect(backend.getCorrections("ds-form-1").length).toBe(1);
    expect(
      (within(fieldOf("city")).getByTestId("form-field-input") as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("必填缺失前端先拦：逐字段错误、零请求", async () => {
    const backend = install();
    render(<FormRuntime spec={SPEC} endpoint={{ kind: "console", datasetId: "ds-form-1" }} />);

    fireEvent.click(screen.getByTestId("form-submit"));
    expect(
      within(fieldOf("city")).getByTestId("form-field-error").textContent,
    ).toContain("必填");
    expect(
      backend.calls.filter(
        (c) => c.method === "POST" && c.url.pathname.includes("corrections"),
      ),
    ).toHaveLength(0);

    // 修正后错误随输入清除，再提交成功
    fill("city", "沪");
    expect(within(fieldOf("city")).queryByTestId("form-field-error")).toBeNull();
    fireEvent.click(screen.getByTestId("form-submit"));
    expect(await screen.findByTestId("form-success")).toBeTruthy();
  });

  it("类型错前端先拦：number 非数字 / date 带时间部分 / select 越选项", () => {
    const backend = install();
    render(<FormRuntime spec={SPEC} endpoint={{ kind: "console", datasetId: "ds-form-1" }} />);

    fill("city", "沪");
    fill("amount", "abc");
    fill("reported_on", "2026-10-12T09:00");
    fireEvent.click(screen.getByTestId("form-submit"));
    expect(
      within(fieldOf("amount")).getByTestId("form-field-error").textContent,
    ).toContain("数字");
    expect(
      within(fieldOf("reported_on")).getByTestId("form-field-error").textContent,
    ).toContain("YYYY-MM-DD");
    expect(
      backend.calls.filter(
        (c) => c.method === "POST" && c.url.pathname.includes("corrections"),
      ),
    ).toHaveLength(0);
  });

  it("未绑数据集诚实态：不可提交（无提交按钮、无字段）", () => {
    install();
    render(
      <FormRuntime
        spec={{ ...SPEC, datasetId: null }}
        endpoint={{ kind: "console", datasetId: null }}
      />,
    );
    expect(screen.getByTestId("form-runtime-unbound").textContent).toContain(
      "未绑定数据集",
    );
    expect(screen.queryByTestId("form-submit")).toBeNull();
    expect(screen.queryByTestId("form-field")).toBeNull();
  });

  it("服务端拒绝（429 行数闸等）：detail 如实呈现，表单不清空", async () => {
    // corrections 端点强制失败态：包装假后端拦截 POST corrections。
    const backend = install();
    const original = backend.fetchImpl;
    vi.stubGlobal(
      "fetch",
      ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://console.test");
        if (
          url.pathname === "/api/v1/datasets/ds-form-1/corrections" &&
          (init?.method ?? "GET").toUpperCase() === "POST"
        ) {
          return Promise.resolve({
            ok: false,
            status: 429,
            json: () =>
              Promise.resolve({
                detail: "免费档单数据集行数已达上限（500 行）",
              }),
          });
        }
        return original(input, init);
      }) as unknown as typeof fetch,
    );

    render(<FormRuntime spec={SPEC} endpoint={{ kind: "console", datasetId: "ds-form-1" }} />);
    fill("city", "沪");
    fireEvent.click(screen.getByTestId("form-submit"));
    expect(
      (await screen.findByTestId("form-submit-error")).textContent,
    ).toContain("行数已达上限");
    expect(
      (within(fieldOf("city")).getByTestId("form-field-input") as HTMLInputElement)
        .value,
    ).toBe("沪");
  });
});

describe("FormRuntime（public 态：公开 submit 端点）", () => {
  const SUBMIT_URL = "/api/v1/share/form/9/submit?t=tok-abc&v=2";

  type PublicCall = {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: unknown;
  };

  /** 打公开端点假 fetch：记录请求（断言无 Authorization），按入参回状态。 */
  function stubPublicFetch(
    status: number,
    body: unknown,
  ): PublicCall[] {
    const calls: PublicCall[] = [];
    vi.stubGlobal(
      "fetch",
      ((input: RequestInfo | URL, init?: RequestInit) => {
        const headers: Record<string, string> = {};
        new Headers(init?.headers as HeadersInit | undefined).forEach((v, k) => {
          headers[k.toLowerCase()] = v;
        });
        calls.push({
          url: String(input),
          method: (init?.method ?? "GET").toUpperCase(),
          headers,
          body:
            typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        });
        return Promise.resolve({
          ok: status < 400,
          status,
          json: () => Promise.resolve(body),
        } as unknown as Response);
      }) as unknown as typeof fetch,
    );
    return calls;
  }

  it("公开提交成功：POST 分享端点（t/v 透传、免登录）+ 响应 message 呈现", async () => {
    const calls = stubPublicFetch(201, {
      ok: true,
      message: "感谢上报，门店数据已收到",
    });
    render(<FormRuntime spec={SPEC} endpoint={{ kind: "public", url: SUBMIT_URL }} />);

    fill("city", "京");
    fill("amount", "8");
    fireEvent.click(screen.getByTestId("form-submit"));

    expect(
      (await screen.findByTestId("form-success")).textContent,
    ).toBe("感谢上报，门店数据已收到");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(SUBMIT_URL);
    expect(calls[0]?.method).toBe("POST");
    // 公开红线：绝不携带登录头
    expect(calls[0]?.headers["authorization"]).toBeUndefined();
    expect(calls[0]?.body).toEqual({
      values: { city: "京", amount: 8 },
    });
    // 提交后清空，可继续填写（周期性上报）
    expect(
      (within(fieldOf("city")).getByTestId("form-field-input") as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("公开提交 422（字段级原因）：detail 如实呈现、零清空", async () => {
    stubPublicFetch(422, { detail: "字段 amount：请输入数字" });
    render(<FormRuntime spec={SPEC} endpoint={{ kind: "public", url: SUBMIT_URL }} />);

    fill("city", "京");
    fireEvent.click(screen.getByTestId("form-submit"));
    expect(
      (await screen.findByTestId("form-submit-error")).textContent,
    ).toContain("字段 amount");
    expect(
      (within(fieldOf("city")).getByTestId("form-field-input") as HTMLInputElement)
        .value,
    ).toBe("京");
  });

  it("公开提交缺省文案：spec.successMessage 兜底（响应无 message 时）", async () => {
    stubPublicFetch(201, { ok: true });
    render(
      <FormRuntime
        spec={{ ...SPEC, submitLabel: undefined, successMessage: undefined }}
        endpoint={{ kind: "public", url: SUBMIT_URL }}
      />,
    );
    // 自定义 submitLabel 缺省回落「提交」
    expect(screen.getByTestId("form-submit").textContent).toContain("提交");
    fill("city", "京");
    fireEvent.click(screen.getByTestId("form-submit"));
    expect(
      (await screen.findByTestId("form-success")).textContent,
    ).toContain("已提交");
  });

  it("未绑数据集在 public 态同样落诚实态（不可提交）", () => {
    stubPublicFetch(200, {});
    render(
      <FormRuntime
        spec={{ ...SPEC, datasetId: null }}
        endpoint={{ kind: "public", url: SUBMIT_URL }}
      />,
    );
    expect(screen.getByTestId("form-runtime-unbound")).toBeTruthy();
    expect(screen.queryByTestId("form-submit")).toBeNull();
  });

  it("公开态显隐联动（wire-form-field-linkage）：隐藏字段不渲染、载荷排除", async () => {
    const calls = stubPublicFetch(201, { ok: true, message: "已收到" });
    render(
      <FormRuntime
        spec={{
          datasetId: "ds-form-1",
          fields: [
            { column: "city", label: "城市", input: "text", required: true },
            {
              column: "detail",
              label: "明细",
              input: "text",
              visibleWhen: { field: "city", op: "contains", value: "京" },
            },
          ],
        }}
        endpoint={{ kind: "public", url: SUBMIT_URL }}
      />,
    );

    // 控制字段空 → contains 条件假 → 明细隐藏（连 label 都不出）
    expect(
      screen
        .getAllByTestId("form-field")
        .some((el) => el.getAttribute("data-column") === "detail"),
    ).toBe(false);

    fill("city", "京");
    expect(
      screen
        .getAllByTestId("form-field")
        .some((el) => el.getAttribute("data-column") === "detail"),
    ).toBe(true);

    fireEvent.click(screen.getByTestId("form-submit"));
    expect(await screen.findByTestId("form-success")).toBeTruthy();
    // 载荷不含隐藏字段键（此处 detail 可见未填 → 非必填缺省不写键）
    expect(calls[0]?.body).toEqual({ values: { city: "京" } });
  });
});

// ------------------------------------- 显隐联动（wire-form-field-linkage）

describe("FormRuntime（显隐联动：条件渲染+隐藏即清+载荷排除）", () => {
  const LINKAGE_SPEC: FormSpecBody = {
    datasetId: "ds-form-1",
    fields: [
      { column: "city", label: "城市", input: "text", required: true },
      {
        column: "type",
        label: "类型",
        input: "select",
        options: ["其他", "标准"],
      },
      {
        column: "detail",
        label: "明细",
        input: "text",
        required: true, // 隐藏必填不拦——只在可见时强制
        visibleWhen: { field: "type", op: "eq", value: "其他" },
      },
    ],
  };

  function selectType(value: string) {
    fireEvent.change(within(fieldOf("type")).getByTestId("form-field-input"), {
      target: { value },
    });
  }

  function detailRow(): HTMLElement | undefined {
    return screen
      .getAllByTestId("form-field")
      .find((el) => el.getAttribute("data-column") === "detail");
  }

  it("显隐往返：选「其他」→明细出现；改选「标准」→消失且值被清；再选回从空开始", () => {
    install();
    render(
      <FormRuntime
        spec={LINKAGE_SPEC}
        endpoint={{ kind: "console", datasetId: "ds-form-1" }}
      />,
    );

    // 初态：控制字段空值 → 带值算子条件假 → 明细隐藏（连 label 都不出）
    expect(screen.getAllByTestId("form-field").length).toBe(2);
    expect(detailRow()).toBeUndefined();

    // 选「其他」→ 条件命中 → 明细出现（必填标随行）并可填
    selectType("其他");
    const detail = detailRow()!;
    expect(detail.textContent).toContain("明细");
    expect(within(detail).getByTestId("form-field-required")).toBeTruthy();
    const input = within(detail).getByTestId("form-field-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "备注X" } });
    expect(input.value).toBe("备注X");

    // 改选「标准」→ 明细消失且 state 值被清（隐藏即清）
    selectType("标准");
    expect(detailRow()).toBeUndefined();

    // 再选回「其他」→ 重新可见从空开始
    selectType("其他");
    expect(
      (within(detailRow()!).getByTestId("form-field-input") as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("隐藏必填不拦提交；提交载荷不含隐藏字段键（断言 fetch body）", async () => {
    const backend = install();
    render(
      <FormRuntime
        spec={LINKAGE_SPEC}
        endpoint={{ kind: "console", datasetId: "ds-form-1" }}
      />,
    );

    fill("city", "沪");
    selectType("标准"); // 明细隐藏（必填不查、键不落）
    fireEvent.click(screen.getByTestId("form-submit"));

    expect(await screen.findByTestId("form-success")).toBeTruthy();
    const post = backend.calls.find(
      (c) =>
        c.method === "POST" &&
        c.url.pathname === "/api/v1/datasets/ds-form-1/corrections",
    );
    expect(post?.body).toEqual({
      op: "insert",
      values: { city: "沪", type: "标准" }, // detail 键不落
    });
    expect(JSON.stringify(post?.body).includes("detail")).toBe(false);
  });
});
