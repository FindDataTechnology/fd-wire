// 数据集详情行内编辑器测试（wire-dataset-form-editing 任务 2.1/2.2）：
// 模式切换与只读默认、双击改值/删行/加行入脏队列（Esc 取消）、保存按入队
// 顺序逐条提交与失败隔离（成功条目生效、失败带行上下文+服务端原因、不重试）、
// 未保存离开确认与放弃清队、保存成功后刷新预览与修正历史、cell/api 两档同 UI
// （mock 端点同契约）。编辑器纯逻辑（editQueue 队列归约/顺序保存）单测见文末。
// CSV 导出测试（wire-dataset-export 任务 2.2/2.3）：Bearer 下载触发、blob 下载
// 流程（createObjectURL 桩）、截断提示、失败如实、下载中防重复。
// fetch 为本文件内置契约假后端（零网络，不改 testing.ts——DatasetProvenance 手法）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { DatasetDetail } from "./DatasetDetail";
import {
  describeEditItem,
  enqueueEdit,
  saveEditQueue,
  type EditQueueItem,
} from "./editQueue";
import type {
  Correction,
  CorrectionInput,
  Dataset,
  DatasetColumn,
  ProvenanceOverview,
  ProvenanceStatus,
} from "./api";
import { makeIdToken } from "./testing";

const CUSTOMER = "demo-customer";
const NOW = "2026-10-05T10:00:00";
const KEY = "ds_key_1";
const ROWS_PATH = "/api/v1/datasets/ds-1/rows";
const CORRECTIONS_PATH = "/api/v1/datasets/ds-1/corrections";
const EXPORT_PATH = "/api/v1/datasets/ds-1/export";

const COLUMNS: DatasetColumn[] = [
  { name: "id", type: "INTEGER" },
  { name: "amount", type: "REAL" },
];

function makeDataset(partial: Partial<Dataset> = {}): Dataset {
  return {
    id: "ds-1",
    key: KEY,
    name: "门店销量",
    source_kind: "upload",
    connector_id: null,
    source_ref: null,
    columns: COLUMNS,
    row_count: 2,
    size_bytes: 64,
    sync_cron: null,
    sync_status: "ok",
    paused_reason: null,
    created_at: NOW,
    updated_at: NOW,
    customer_id: CUSTOMER,
    ...partial,
  };
}

function makeStatus(): ProvenanceStatus {
  return {
    tier: "chain_only",
    integrity: { ok: true, checked: 1 },
    anchored_through: { epoch: null, backend: null },
    first_event_ts: null,
    note: null,
  };
}

function makeOverview(): ProvenanceOverview {
  return {
    ledger: "wire-provenance-v1",
    last_seq: 1,
    integrity: { ok: true, checked: 1 },
    anchoring: { backend: null, last_sealed_epoch: null, lag_events: 0 },
  };
}

type FetchCall = {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: unknown;
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  } as unknown as Response;
}

/** CSV 导出响应（wire-dataset-export 契约：text/csv + BOM、
 * Content-Disposition 文件名、可选 X-Export-Truncated: true）。 */
function csvResponse(options: { truncated?: boolean } = {}): Response {
  const headers = new Headers({
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${KEY}.csv"`,
  });
  if (options.truncated) headers.set("x-export-truncated", "true");
  return {
    ok: true,
    status: 200,
    json: () => Promise.reject(new Error("csv body")),
    blob: () =>
      Promise.resolve(new Blob(["\uFEFFid,amount\n1,10\n"], { type: "text/csv" })),
    headers,
  } as unknown as Response;
}

/** 契约假后端：数据集详情常规路由 + 修正三件套（POST 落层并应用，语义对齐
 * testing.ts）+ 可注入第 N 条 POST 失败（失败隔离测试）。 */
function install(options: {
  dataset?: Dataset;
  rows?: Array<Record<string, unknown>>;
  correctionsSeed?: Correction[];
  failNthCorrectionPost?: { nth: number; status: number; detail: string };
  /** 导出端点强制失败（如 500 带原因）。 */
  failExportStatus?: number;
  failExportDetail?: string;
  /** 导出响应带 X-Export-Truncated: true。 */
  exportTruncated?: boolean;
  /** 导出请求悬挂至该 promise 完成（防重复点击测试）。 */
  holdExport?: Promise<void>;
}) {
  const dataset = options.dataset ?? makeDataset();
  let rows = (options.rows ?? [
    { id: 1, amount: 10 },
    { id: 2, amount: 20 },
  ]).map((row, i) => ({
    ...row,
    __row_id: row.__row_id ?? `hash:seed-${i + 1}`,
  }));
  const corrections: Correction[] = [...(options.correctionsSeed ?? [])];
  const calls: FetchCall[] = [];
  let nextCorrectionId = 1;
  let correctionPostCount = 0;

  const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(_input), "http://console.test");
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      new Headers(init.headers as HeadersInit).forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
    }
    calls.push({
      method,
      url,
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });

    const path = url.pathname;
    if (path === "/api/v1/datasets/ds-1" && method === "GET") {
      return jsonResponse(dataset);
    }
    if (path === ROWS_PATH && method === "GET") {
      return jsonResponse({ columns: COLUMNS, rows, total: rows.length });
    }
    if (path === "/api/v1/datasets/ds-1/syncs" && method === "GET") {
      return jsonResponse([]);
    }
    if (path === CORRECTIONS_PATH && method === "GET") {
      return jsonResponse(corrections);
    }
    if (path === CORRECTIONS_PATH && method === "POST") {
      correctionPostCount += 1;
      const payload = calls[calls.length - 1]!.body as CorrectionInput;
      const fail = options.failNthCorrectionPost;
      if (fail && correctionPostCount === fail.nth) {
        return jsonResponse({ detail: fail.detail }, fail.status);
      }
      const id = nextCorrectionId++;
      corrections.push({
        id,
        dataset_id: "ds-1",
        op: payload.op,
        row_id: "row_id" in payload ? payload.row_id : null,
        column: payload.op === "update" ? payload.column : null,
        value: payload.op === "update" ? payload.value : null,
        values: payload.op === "insert" ? payload.values : null,
        actor: "console-test",
        created_at: "2026-10-11T09:00:00",
        reverted_at: null,
        dangling_at: null,
        dangling_reason: null,
      });
      // 应用修正（假后端内存态，供保存后刷新断言）。
      if (payload.op === "update") {
        rows = rows.map((row) =>
          row.__row_id === payload.row_id
            ? { ...row, [payload.column]: payload.value }
            : row,
        );
      } else if (payload.op === "delete") {
        rows = rows.filter((row) => row.__row_id !== payload.row_id);
      } else {
        rows = [...rows, { ...payload.values, __row_id: `ins:${id}` }];
      }
      return jsonResponse({ correction_id: id }, 201);
    }
    if (path === EXPORT_PATH && method === "GET") {
      if (options.holdExport) {
        return options.holdExport.then(() =>
          csvResponse({ truncated: options.exportTruncated }),
        ) as unknown as Response;
      }
      if (options.failExportStatus) {
        return jsonResponse(
          { detail: options.failExportDetail ?? `export ${options.failExportStatus}` },
          options.failExportStatus,
        );
      }
      return csvResponse({ truncated: options.exportTruncated });
    }
    if (path === `/api/v1/provenance/datasets/${KEY}/status`) {
      return jsonResponse(makeStatus());
    }
    if (path === `/api/v1/provenance/datasets/${KEY}/events`) {
      return jsonResponse({ events: [], has_more: false });
    }
    if (path === "/api/v1/provenance/overview") {
      return jsonResponse(makeOverview());
    }
    return jsonResponse({ detail: "not found" }, 404);
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetchImpl);
  return {
    calls,
    getRows: () => rows,
    getCorrections: () => corrections,
  };
}

function callsOf(calls: FetchCall[], method: string, path: string): FetchCall[] {
  return calls.filter((call) => call.method === method && call.url.pathname === path);
}

/** 定位预览单元格（列名 + 行锚）。 */
function findCell(column: string, rowId: string) {
  return screen
    .getAllByTestId("preview-cell")
    .find(
      (el) =>
        el.getAttribute("data-column") === column &&
        el.getAttribute("data-row-id") === rowId,
    );
}

/** 进入编辑模式（等预览网格就绪后）。 */
async function enterEditMode() {
  await screen.findByTestId("preview-grid");
  fireEvent.click(screen.getByTestId("preview-edit-toggle"));
}

/** 双击改值并 Enter 入队。 */
function editCell(rowId: string, column: string, value: string) {
  fireEvent.doubleClick(findCell(column, rowId)!);
  const input = screen.getByTestId("preview-edit-input");
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

beforeEach(() => {
  i18n.changeLanguage("zh");
  localStorage.clear();
  sessionStorage.clear();
  // 登录会话种子：请求自动附 Authorization: Bearer（假后端不校验值）。
  sessionStorage.setItem(
    "wire.console.session",
    JSON.stringify({
      idToken: makeIdToken({ sub: CUSTOMER }),
      expiresAt: Date.now() + 3600_000,
      identity: CUSTOMER,
      roles: [],
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe("DatasetDetail 行内编辑器：模式切换与只读默认（任务 2.1）", () => {
  it("默认只读：无删行/加行/脏徽标控件，双击不开编辑框；切换进编辑后控件出现", async () => {
    install({});
    render(<DatasetDetail datasetId="ds-1" onBack={() => {}} />);

    await screen.findByTestId("preview-grid");
    const toggle = screen.getByTestId("preview-edit-toggle");
    expect(toggle.getAttribute("data-mode")).toBe("read");
    expect(toggle.textContent).toBe("编辑");
    // 只读态零编辑控件
    expect(screen.queryByTestId("preview-delete-row")).toBeNull();
    expect(screen.queryByTestId("preview-add-row")).toBeNull();
    expect(screen.queryByTestId("preview-dirty-badge")).toBeNull();
    fireEvent.doubleClick(findCell("amount", "hash:seed-1")!);
    expect(screen.queryByTestId("preview-edit-input")).toBeNull();

    // 切换进编辑：删行/加行出现，双击可开编辑框（Esc 取消）
    fireEvent.click(toggle);
    expect(toggle.getAttribute("data-mode")).toBe("edit");
    expect(screen.getAllByTestId("preview-delete-row").length).toBe(2);
    expect(screen.getByTestId("preview-add-row")).toBeTruthy();
    fireEvent.doubleClick(findCell("amount", "hash:seed-1")!);
    const input = screen.getByTestId("preview-edit-input");
    expect((input as HTMLInputElement).value).toBe("10");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("preview-edit-input")).toBeNull();
    expect(screen.queryByTestId("preview-dirty-badge")).toBeNull();
  });
});

describe("DatasetDetail 行内编辑器：脏队列入队（任务 2.1）", () => {
  it("双击改值 Enter 入队（Esc 取消不入队）；行删除与添加行入队——均不即时提交", async () => {
    const backend = install({});
    render(<DatasetDetail datasetId="ds-1" onBack={() => {}} />);
    await enterEditMode();

    // Esc 取消：不入队
    fireEvent.doubleClick(findCell("amount", "hash:seed-1")!);
    fireEvent.change(screen.getByTestId("preview-edit-input"), {
      target: { value: "77" },
    });
    fireEvent.keyDown(screen.getByTestId("preview-edit-input"), { key: "Escape" });
    expect(screen.queryByTestId("preview-dirty-badge")).toBeNull();

    // Enter 确认：update 入队（徽标 1，未发 POST）
    editCell("hash:seed-1", "amount", "99");
    expect(screen.getByTestId("preview-dirty-badge").textContent).toContain("1");
    expect(callsOf(backend.calls, "POST", CORRECTIONS_PATH).length).toBe(0);

    // 行删除：delete 入队（徽标 2）
    fireEvent.click(screen.getAllByTestId("preview-delete-row")[1]!);
    expect(screen.getByTestId("preview-dirty-badge").textContent).toContain("2");

    // 添加行：内联表单按列输入（可留空）→ insert 入队（徽标 3）
    fireEvent.click(screen.getByTestId("preview-add-row"));
    const amountInput = screen
      .getAllByTestId("preview-add-row-input")
      .find((el) => el.getAttribute("data-column") === "amount");
    fireEvent.change(amountInput!, { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("preview-add-row-submit"));
    expect(screen.getByTestId("preview-dirty-badge").textContent).toContain("3");
    expect(callsOf(backend.calls, "POST", CORRECTIONS_PATH).length).toBe(0);

    // 队列叠加可视化：待保存 update 单元格标注、delete 行划线
    expect(findCell("amount", "hash:seed-1")!.getAttribute("data-pending-edit")).toBe(
      "true",
    );
    expect(
      screen
        .getAllByTestId("preview-row")
        .find((el) => el.getAttribute("data-row-id") === "hash:seed-2")!
        .getAttribute("data-pending-delete"),
    ).toBe("true");
  });
});

describe("DatasetDetail 行内编辑器：保存顺序与失败隔离（任务 2.2）", () => {
  it("保存按入队顺序逐条提交；第 2 条 400：第 1 条已生效、失败条目带原因与行上下文、第 3 条仍提交", async () => {
    const backend = install({
      failNthCorrectionPost: {
        nth: 2,
        status: 400,
        detail: "未知列 nosuch（合法列：id, amount）",
      },
    });
    render(<DatasetDetail datasetId="ds-1" onBack={() => {}} />);
    await enterEditMode();

    editCell("hash:seed-1", "amount", "99"); // 1: update
    fireEvent.click(screen.getAllByTestId("preview-delete-row")[1]!); // 2: delete
    fireEvent.click(screen.getByTestId("preview-add-row"));
    const amountInput = screen
      .getAllByTestId("preview-add-row-input")
      .find((el) => el.getAttribute("data-column") === "amount");
    fireEvent.change(amountInput!, { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("preview-add-row-submit")); // 3: insert

    fireEvent.click(screen.getByTestId("preview-queue-save"));
    await waitFor(() =>
      expect(callsOf(backend.calls, "POST", CORRECTIONS_PATH).length).toBe(3),
    );
    const posts = callsOf(backend.calls, "POST", CORRECTIONS_PATH);
    // 按入队顺序逐条提交（载荷序 = 入队序）
    expect(posts.map((call) => call.body)).toEqual([
      { op: "update", row_id: "hash:seed-1", column: "amount", value: "99" },
      { op: "delete", row_id: "hash:seed-2" },
      { op: "insert", values: { amount: "5" } },
    ]);

    // 逐条结果：成功已生效；失败带行上下文与服务端原因（不自动重试——恰 3 次 POST）
    const results = await screen.findAllByTestId("preview-save-result");
    expect(results.length).toBe(3);
    expect(results.map((el) => el.getAttribute("data-ok"))).toEqual([
      "true",
      "false",
      "true",
    ]);
    const failed = screen
      .getAllByTestId("preview-save-result")
      .find((el) => el.getAttribute("data-ok") === "false")!;
    expect(failed.getAttribute("data-op")).toBe("delete");
    expect(failed.textContent).toContain("hash:seed-2");
    expect(failed.textContent).toContain("未知列 nosuch");

    // 保存后队列清空并刷新：update/insert 生效、delete 未生效（行仍在），
    // 修正历史刷新为 2 条（成功条目）。
    await waitFor(() =>
      expect(screen.queryByTestId("preview-dirty-badge")).toBeNull(),
    );
    await waitFor(() =>
      expect(findCell("amount", "hash:seed-1")!.textContent).toBe("99"),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("preview-row").length).toBe(3),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("correction-row").length).toBe(2),
    );
    // 预览与修正历史都重新拉取（两个 GET 各自再次调用）
    const rowsGets = callsOf(backend.calls, "GET", ROWS_PATH);
    const correctionsGets = callsOf(backend.calls, "GET", CORRECTIONS_PATH);
    expect(rowsGets.length).toBeGreaterThanOrEqual(2);
    expect(correctionsGets.length).toBeGreaterThanOrEqual(2);
  });

  it("保存成功后刷新行预览与修正历史（mock 两个 fetch），脏队列清空", async () => {
    const backend = install({});
    render(<DatasetDetail datasetId="ds-1" onBack={() => {}} />);
    await enterEditMode();

    const rowsGetsBefore = callsOf(backend.calls, "GET", ROWS_PATH).length;
    const correctionsGetsBefore = callsOf(
      backend.calls,
      "GET",
      CORRECTIONS_PATH,
    ).length;

    editCell("hash:seed-1", "amount", "42");
    fireEvent.click(screen.getByTestId("preview-queue-save"));
    await waitFor(() =>
      expect(
        callsOf(backend.calls, "POST", CORRECTIONS_PATH).length,
      ).toBe(1),
    );
    // 预览刷新：GET rows 再次调用并呈现新值
    await waitFor(() =>
      expect(
        callsOf(backend.calls, "GET", ROWS_PATH).length,
      ).toBeGreaterThan(rowsGetsBefore),
    );
    await waitFor(() =>
      expect(findCell("amount", "hash:seed-1")!.textContent).toBe("42"),
    );
    // 修正历史刷新：GET corrections 再次调用并出现 1 条
    await waitFor(() =>
      expect(
        callsOf(backend.calls, "GET", CORRECTIONS_PATH).length,
      ).toBeGreaterThan(correctionsGetsBefore),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("correction-row").length).toBe(1),
    );
    // 脏队列清空
    expect(screen.queryByTestId("preview-dirty-badge")).toBeNull();
    expect(
      screen.getByTestId("preview-save-result").getAttribute("data-ok"),
    ).toBe("true");
  });
});

describe("DatasetDetail 行内编辑器：未保存提示与放弃（任务 2.1/2.2）", () => {
  it("队列非空离开编辑模式先确认：取消留在编辑（队列保留）；确认丢弃退出", async () => {
    install({});
    render(<DatasetDetail datasetId="ds-1" onBack={() => {}} />);
    await enterEditMode();

    editCell("hash:seed-1", "amount", "99");
    fireEvent.click(screen.getByTestId("preview-edit-toggle"));
    // 确认弹窗出现；取消 → 仍在编辑态、队列保留
    const dialog = screen.getByTestId("preview-leave-dialog");
    expect(dialog.textContent).toContain("1");
    fireEvent.click(screen.getByTestId("preview-leave-cancel"));
    expect(screen.queryByTestId("preview-leave-dialog")).toBeNull();
    expect(screen.getAllByTestId("preview-delete-row").length).toBe(2);
    expect(screen.getByTestId("preview-dirty-badge").textContent).toContain("1");

    // 再次离开 → 确认 → 丢弃并退出编辑（队列清、编辑控件消失）
    fireEvent.click(screen.getByTestId("preview-edit-toggle"));
    fireEvent.click(screen.getByTestId("preview-leave-confirm"));
    expect(screen.getByTestId("preview-edit-toggle").getAttribute("data-mode")).toBe(
      "read",
    );
    expect(screen.queryByTestId("preview-dirty-badge")).toBeNull();
    expect(screen.queryByTestId("preview-delete-row")).toBeNull();
    expect(screen.queryByTestId("preview-leave-dialog")).toBeNull();
  });

  it("「放弃」直接清队（无弹窗），队列空时离开不再确认", async () => {
    install({});
    render(<DatasetDetail datasetId="ds-1" onBack={() => {}} />);
    await enterEditMode();

    editCell("hash:seed-1", "amount", "99");
    fireEvent.click(screen.getAllByTestId("preview-delete-row")[0]!);
    expect(screen.getByTestId("preview-dirty-badge").textContent).toContain("2");
    fireEvent.click(screen.getByTestId("preview-queue-discard"));
    expect(screen.queryByTestId("preview-dirty-badge")).toBeNull();
    expect(screen.queryByTestId("preview-save-result")).toBeNull();
    // 叠加标注随队列清空复原
    expect(findCell("amount", "hash:seed-1")!.getAttribute("data-pending-edit")).toBe(
      "false",
    );

    // 队列空 → 直接退出，不弹确认
    fireEvent.click(screen.getByTestId("preview-edit-toggle"));
    expect(screen.queryByTestId("preview-leave-dialog")).toBeNull();
    expect(screen.getByTestId("preview-edit-toggle").getAttribute("data-mode")).toBe(
      "read",
    );
  });
});

describe("DatasetDetail 行内编辑器：cell/api 两档同 UI（任务 2.2）", () => {
  it("响应带 storage_tier=api 与 cell 档（不带标记）走同一编辑流与同契约载荷", async () => {
    for (const tier of ["api", "cell"]) {
      cleanup();
      vi.unstubAllGlobals();
      const backend = install({
        dataset: makeDataset({
          ...(tier === "api" ? { storage_tier: "api" } : {}),
        } as Partial<Dataset>),
      });
      render(<DatasetDetail datasetId="ds-1" onBack={() => {}} />);
      await enterEditMode();

      // 两档同 UI：编辑控件与只读默认完全一致
      expect(screen.getByTestId("preview-edit-toggle").getAttribute("data-mode")).toBe(
        "edit",
      );
      expect(screen.getAllByTestId("preview-delete-row").length).toBe(2);
      editCell("hash:seed-1", "amount", "7");
      fireEvent.click(screen.getByTestId("preview-queue-save"));
      await waitFor(() =>
        expect(callsOf(backend.calls, "POST", CORRECTIONS_PATH).length).toBe(1),
      );
      const posts = callsOf(backend.calls, "POST", CORRECTIONS_PATH);
      // 同一端点契约（不因档位分叉）
      expect(posts[0]!.url.pathname).toBe(CORRECTIONS_PATH);
      expect(posts[0]!.body).toEqual({
        op: "update",
        row_id: "hash:seed-1",
        column: "amount",
        value: "7",
      });
    }
  });
});

describe("DatasetDetail 导出 CSV（wire-dataset-export 任务 2.2/2.3）", () => {
  /** 桩化 blob 下载（createObjectURL/revokeObjectURL）并捕获下载 a 标签。 */
  function stubDownload() {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:csv");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL, revokeObjectURL }),
    );
    const createElement = vi.spyOn(document, "createElement");
    return {
      createObjectURL,
      revokeObjectURL,
      anchor: () =>
        createElement.mock.results
          .map((result) => result.value as HTMLElement)
          .find((el) => el.tagName === "A") as HTMLAnchorElement | undefined,
    };
  }

  it("点击「导出 CSV」：带 Bearer 请求 export 端点，blob 经 createObjectURL 触发下载并回收；文件名取 Content-Disposition", async () => {
    const download = stubDownload();
    const backend = install({});
    render(<DatasetDetail datasetId="ds-1" onBack={() => {}} />);

    fireEvent.click(await screen.findByTestId("detail-export-csv"));
    await waitFor(() =>
      expect(download.createObjectURL).toHaveBeenCalledTimes(1),
    );
    const call = callsOf(backend.calls, "GET", EXPORT_PATH)[0]!;
    expect(call.url.pathname).toBe(EXPORT_PATH);
    expect(call.headers["authorization"]).toMatch(/^Bearer /);
    expect(call.headers["accept"]).toBe("text/csv");
    // blob（BOM CSV 全文）交给浏览器下载，object URL 即时回收
    expect(download.createObjectURL.mock.calls[0]![0]).toBeInstanceOf(Blob);
    const anchor = download.anchor();
    expect(anchor?.getAttribute("href")).toBe("blob:csv");
    expect(anchor?.download).toBe(`${KEY}.csv`);
    expect(download.revokeObjectURL).toHaveBeenCalledWith("blob:csv");
    // 成功且无截断头：零截断提示、零错误
    expect(screen.queryByTestId("export-csv-truncated")).toBeNull();
    expect(screen.queryByTestId("export-csv-error")).toBeNull();
  });

  it("X-Export-Truncated: true → 呈现「已截断至前 10,000 行」提示", async () => {
    const download = stubDownload();
    install({ exportTruncated: true });
    render(<DatasetDetail datasetId="ds-1" onBack={() => {}} />);

    fireEvent.click(await screen.findByTestId("detail-export-csv"));
    await waitFor(() =>
      expect(download.createObjectURL).toHaveBeenCalledTimes(1),
    );
    expect(screen.getByTestId("export-csv-truncated").textContent).toContain(
      "已截断至前 10,000 行",
    );
    expect(screen.queryByTestId("export-csv-error")).toBeNull();
  });

  it("失败如实呈现：500 的后端 detail 原样展示，按钮复位可重试", async () => {
    install({ failExportStatus: 500, failExportDetail: "导出暂时不可用" });
    render(<DatasetDetail datasetId="ds-1" onBack={() => {}} />);

    const button = await screen.findByTestId("detail-export-csv");
    fireEvent.click(button);
    const error = await screen.findByTestId("export-csv-error");
    expect(error.textContent).toContain("导出暂时不可用");
    expect(screen.queryByTestId("export-csv-truncated")).toBeNull();
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  });

  it("下载中禁用防重复：悬挂期间二次点击不再发请求，完成后恰 1 次", async () => {
    const download = stubDownload();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const backend = install({ holdExport: held });
    render(<DatasetDetail datasetId="ds-1" onBack={() => {}} />);

    const button = await screen.findByTestId("detail-export-csv");
    fireEvent.click(button);
    await waitFor(() =>
      expect(callsOf(backend.calls, "GET", EXPORT_PATH).length).toBe(1),
    );
    // 悬挂期间按钮禁用（文案切换「导出中…」）；再点不发第二次请求
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(true));
    expect(button.textContent).toContain("导出中");
    fireEvent.click(button);
    expect(callsOf(backend.calls, "GET", EXPORT_PATH).length).toBe(1);

    release();
    await waitFor(() =>
      expect(download.createObjectURL).toHaveBeenCalledTimes(1),
    );
    expect(callsOf(backend.calls, "GET", EXPORT_PATH).length).toBe(1);
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  });
});

describe("编辑器纯逻辑 editQueue（任务 2.1：队列归约/顺序保存）", () => {
  it("enqueueEdit：按入队顺序递增 seq、不改原数组", () => {
    const first = enqueueEdit([], { op: "delete", row_id: "hash:seed-2" });
    const second = enqueueEdit(first, {
      op: "update",
      row_id: "hash:seed-1",
      column: "amount",
      value: "99",
    });
    const third = enqueueEdit(second, { op: "insert", values: { amount: "5" } });
    expect(first.map((item) => item.seq)).toEqual([1]);
    expect(third.map((item) => [item.seq, item.payload.op])).toEqual([
      [1, "delete"],
      [2, "update"],
      [3, "insert"],
    ]);
    expect(second.length).toBe(2); // 原数组不动（追加式）
  });

  it("describeEditItem：三种操作各带行上下文（行锚/列=值/values）", () => {
    expect(
      describeEditItem({
        op: "update",
        row_id: "hash:seed-1",
        column: "amount",
        value: "99",
      }),
    ).toBe("hash:seed-1 · amount = 99");
    expect(describeEditItem({ op: "delete", row_id: "hash:seed-2" })).toBe(
      "hash:seed-2",
    );
    expect(describeEditItem({ op: "insert", values: { amount: "5" } })).toBe(
      '{"amount":"5"}',
    );
  });

  it("saveEditQueue：按序逐条提交；单条失败隔离（后续继续、不自动重试）", async () => {
    const items: EditQueueItem[] = [
      { seq: 1, payload: { op: "update", row_id: "r1", column: "c", value: "1" } },
      { seq: 2, payload: { op: "delete", row_id: "r2" } },
      { seq: 3, payload: { op: "insert", values: {} } },
    ];
    const submitted: CorrectionInput[] = [];
    const boom = new Error("server said no");
    const outcomes = await saveEditQueue(items, async (payload) => {
      submitted.push(payload);
      if (payload.op === "delete") throw boom;
    });
    // 顺序提交 + 每条恰一次（失败不重试、不断链）
    expect(submitted).toEqual(items.map((item) => item.payload));
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, false, true]);
    expect(outcomes[1]!.error).toBe(boom);
    expect(outcomes[0]!.error).toBeUndefined();
  });
});
