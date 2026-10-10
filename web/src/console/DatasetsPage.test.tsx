// 「我的数据」组件测试（wire-customer-local-data 任务组 3：3.1-3.5）：
// 列表六态/空态、上传全流程载荷、预览网格改值/删行/加行载荷、漂移 resume 流、
// 悬空徽标与回滚、连接器在线离线与配对令牌一次性显示、白名单建档、路由接入。
// 免费档放行（wire-free-tier-data-gate 4.1-4.3）：完整渲染/配额条/存储徽标/
// 内联限额提示/连接器区付费标注 + 付费档零变化回归。
// fetch 一律走 testing.ts 的内存假后端（零网络）。
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
import { DatasetsPage } from "./DatasetsPage";
import { installConsoleBackend, seedConsoleSession, type FetchCall } from "./testing";
import type { Connector, Dataset } from "./api";
import { CONSOLE_TABS } from "./ConsoleLayout";
import { parseHash } from "../App";

const CUSTOMER = "demo-customer";
const NOW = "2026-10-05T10:00:00";

function makeDataset(
  partial: Partial<Dataset> &
    Pick<Dataset, "id" | "name"> & { storage_tier?: string },
): Dataset {
  return {
    key: partial.id.replace(/-/g, "_"),
    source_kind: "upload",
    connector_id: null,
    source_ref: null,
    columns: [
      { name: "id", type: "INTEGER" },
      { name: "amount", type: "REAL" },
    ],
    row_count: 120,
    size_bytes: 4096,
    sync_cron: null,
    sync_status: "ok",
    paused_reason: null,
    created_at: NOW,
    updated_at: NOW,
    customer_id: CUSTOMER,
    ...partial,
  };
}

function makeConnector(
  partial: Partial<Connector> & Pick<Connector, "id" | "name">,
): Connector {
  return {
    version: "v0.1.0",
    status: "online",
    last_heartbeat_at: NOW,
    revoked_at: null,
    created_at: NOW,
    customer_id: CUSTOMER,
    ...partial,
  };
}

function install(options?: Parameters<typeof installConsoleBackend>[1]) {
  const backend = installConsoleBackend([], options);
  vi.stubGlobal("fetch", backend.fetchImpl);
  return backend;
}

function postCalls(
  backend: ReturnType<typeof installConsoleBackend>,
  path: string,
): FetchCall[] {
  return backend.calls.filter(
    (call) => call.method === "POST" && call.url.pathname === path,
  );
}

beforeEach(() => {
  i18n.changeLanguage("zh");
  localStorage.clear();
  sessionStorage.clear();
  // 登录会话种子：假后端以 Bearer 的 sub 为客户身份（demo-customer）。
  seedConsoleSession({ sub: "demo-customer" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe("DatasetsPage（我的数据列表与上传，任务 3.1/3.2）", () => {
  it("卡片渲染：来源徽标、六态同步状态、行数/大小/最近更新、暂停原因如实展示", async () => {
    install({
      datasets: [
        makeDataset({ id: "ds-1", name: "门店销量", sync_status: "ok" }),
        makeDataset({
          id: "ds-2",
          name: "ERP 订单",
          source_kind: "connector",
          source_ref: "erp_db",
          sync_status: "paused_drift",
          paused_reason: "drift: 列 price 缺失",
          row_count: 3000,
          size_bytes: 2 * 1024 * 1024,
        }),
        makeDataset({ id: "ds-3", name: "同步中", sync_status: "syncing" }),
        makeDataset({ id: "ds-4", name: "同步失败", sync_status: "failed" }),
        makeDataset({ id: "ds-5", name: "待同步", sync_status: "idle" }),
        makeDataset({ id: "ds-6", name: "配额暂停", sync_status: "paused_quota" }),
      ],
    });
    render(<DatasetsPage planCode="basic" />);

    const cards = await screen.findAllByTestId("dataset-card");
    expect(cards.length).toBe(6);
    expect(
      screen
        .getAllByTestId("dataset-sync-status")
        .map((el) => el.getAttribute("data-status"))
        .sort(),
    ).toEqual([
      "failed",
      "idle",
      "ok",
      "paused_drift",
      "paused_quota",
      "syncing",
    ]);
    expect(
      screen.getAllByTestId("dataset-source-badge").map((el) => el.getAttribute("data-kind")),
    ).toEqual(["upload", "connector", "upload", "upload", "upload", "upload"]);
    expect(screen.getByTestId("dataset-source-ref").textContent).toBe("erp_db");
    // 暂停态原因如实展示（连字符文案含 API 值）
    expect(screen.getByTestId("dataset-paused-reason").textContent).toContain(
      "drift: 列 price 缺失",
    );
    // 行数/大小/最近更新（数字来自 API，不写死）
    const rows = screen.getAllByTestId("dataset-rows").map((el) => el.textContent);
    expect(rows).toContain("120 行");
    expect(rows).toContain("3000 行");
    expect(
      screen.getAllByTestId("dataset-size").map((el) => el.textContent),
    ).toContain("大小 2.0 MB");
    expect(screen.getAllByTestId("dataset-updated")[0]!.textContent).toContain(
      "最近更新",
    );
    // 同步状态文案走 i18n（六态中文）
    expect(
      screen.getAllByTestId("dataset-sync-status").map((el) => el.textContent),
    ).toEqual(
      expect.arrayContaining([
        "同步正常",
        "已暂停 · 结构漂移",
        "已暂停 · 配额超限",
        "同步中",
        "同步失败",
        "待同步",
      ]),
    );
  });

  it("无数据集显示空态并引导上传", async () => {
    install({ datasets: [] });
    render(<DatasetsPage planCode="basic" />);

    const empty = await screen.findByTestId("datasets-empty");
    expect(empty.textContent).toContain("上传");
    expect(screen.getByTestId("upload-section")).toBeTruthy();
    expect(screen.getByTestId("connectors-section")).toBeTruthy();
  });

  it("上传全流程：multipart 载荷、列与类型预览、命名建档载荷与列表刷新", async () => {
    const backend = install({ datasets: [] });
    render(<DatasetsPage planCode="basic" />);
    await screen.findByTestId("datasets-empty");

    const file = new File(["id,amount\n1,2"], "sales.csv", {
      type: "text/csv",
    });
    fireEvent.change(screen.getByTestId("upload-file-input"), {
      target: { files: [file] },
    });

    await screen.findByTestId("upload-preview");
    const uploadCall = backend.calls.find(
      (call) => call.url.pathname === "/api/v1/datasets/uploads",
    );
    expect(uploadCall?.method).toBe("POST");
    expect(uploadCall?.headers["authorization"]).toMatch(/^Bearer /);
    expect((uploadCall?.formData?.get("file") as File).name).toBe("sales.csv");
    expect(screen.getByTestId("upload-preview-rows").textContent).toContain("120");
    expect(
      screen
        .getAllByTestId("upload-preview-column")
        .map((el) => [el.getAttribute("data-column"), el.getAttribute("data-type")]),
    ).toEqual([
      ["id", "INTEGER"],
      ["amount", "REAL"],
    ]);

    // 默认名称取自文件名，改为中文名后建档
    expect((screen.getByTestId("upload-name") as HTMLInputElement).value).toBe(
      "sales",
    );
    fireEvent.change(screen.getByTestId("upload-name"), {
      target: { value: "门店销量" },
    });
    fireEvent.click(screen.getByTestId("upload-create"));

    await waitFor(() =>
      expect(postCalls(backend, "/api/v1/datasets").length).toBe(1),
    );
    expect(postCalls(backend, "/api/v1/datasets")[0]!.body).toEqual({
      name: "门店销量",
      source: { kind: "upload", upload_id: "up-1" },
    });
    // 建档成功：预览收起、列表刷新出新卡片
    expect(screen.queryByTestId("upload-preview")).toBeNull();
    expect(await screen.findByTestId("upload-created")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getAllByTestId("dataset-card").length).toBe(1),
    );
    expect(screen.getByTestId("dataset-name").textContent).toBe("门店销量");
  });

  it("上传超限：within_limit=false 提示拒收并禁用建档", async () => {
    install({ datasets: [], uploadPreview: { within_limit: false } });
    render(<DatasetsPage planCode="basic" />);
    await screen.findByTestId("datasets-empty");

    fireEvent.change(screen.getByTestId("upload-file-input"), {
      target: { files: [new File(["x"], "big.csv")] },
    });
    await screen.findByTestId("upload-preview");
    expect(screen.getByTestId("upload-over-limit").textContent).toContain(
      "行数超出上限",
    );
    expect(
      (screen.getByTestId("upload-create") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("上传解析失败：4xx 的 detail 如实呈现", async () => {
    install({
      datasets: [],
      failUploadStatus: 400,
      failUploadDetail: "行数超出上限（上限 500000），已拒收",
    });
    render(<DatasetsPage planCode="basic" />);
    await screen.findByTestId("datasets-empty");

    fireEvent.change(screen.getByTestId("upload-file-input"), {
      target: { files: [new File(["x"], "broken.csv")] },
    });
    const error = await screen.findByTestId("upload-error");
    expect(error.textContent).toContain("行数超出上限（上限 500000），已拒收");
    expect(screen.queryByTestId("upload-preview")).toBeNull();
  });
});

describe("DatasetDetail（预览网格/修正/同步/悬空，任务 3.4）", () => {
  it("预览网格：双击改值、删行、加行分别提交 update/delete/insert 修正载荷", async () => {
    const backend = install({
      datasets: [makeDataset({ id: "ds-1", name: "门店销量" })],
      datasetRows: {
        "ds-1": {
          columns: [
            { name: "id", type: "INTEGER" },
            { name: "amount", type: "REAL" },
          ],
          rows: [
            { id: 1, amount: 10 },
            { id: 2, amount: 20 },
          ],
        },
      },
    });
    render(<DatasetsPage planCode="basic" />);
    fireEvent.click(await screen.findByTestId("dataset-open"));
    await screen.findByTestId("preview-grid");

    // 行锚来自引擎注入的 __row_id（假后端补 hash:seed-<n>）
    const cell = screen
      .getAllByTestId("preview-cell")
      .find(
        (el) =>
          el.getAttribute("data-column") === "amount" &&
          el.getAttribute("data-row-id") === "hash:seed-1",
      );
    expect(cell).toBeTruthy();
    fireEvent.doubleClick(cell!);
    fireEvent.change(screen.getByTestId("preview-edit-input"), {
      target: { value: "99" },
    });
    fireEvent.click(screen.getByTestId("preview-edit-save"));
    await waitFor(() =>
      expect(postCalls(backend, "/api/v1/datasets/ds-1/corrections").length).toBe(1),
    );
    expect(
      postCalls(backend, "/api/v1/datasets/ds-1/corrections")[0]!.body,
    ).toEqual({
      op: "update",
      row_id: "hash:seed-1",
      column: "amount",
      value: "99",
    });

    // 删行（第二行 → hash:seed-2）
    await waitFor(() =>
      expect(screen.getAllByTestId("preview-delete-row").length).toBe(2),
    );
    fireEvent.click(screen.getAllByTestId("preview-delete-row")[1]!);
    await waitFor(() =>
      expect(postCalls(backend, "/api/v1/datasets/ds-1/corrections").length).toBe(2),
    );
    expect(
      postCalls(backend, "/api/v1/datasets/ds-1/corrections")[1]!.body,
    ).toEqual({ op: "delete", row_id: "hash:seed-2" });

    // 加行（只填 amount 列）
    await waitFor(() => expect(screen.getByTestId("preview-add-row")).toBeTruthy());
    fireEvent.click(screen.getByTestId("preview-add-row"));
    const amountInput = screen
      .getAllByTestId("preview-add-row-input")
      .find((el) => el.getAttribute("data-column") === "amount");
    fireEvent.change(amountInput!, { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("preview-add-row-submit"));
    await waitFor(() =>
      expect(postCalls(backend, "/api/v1/datasets/ds-1/corrections").length).toBe(3),
    );
    expect(
      postCalls(backend, "/api/v1/datasets/ds-1/corrections")[2]!.body,
    ).toEqual({ op: "insert", values: { amount: "5" } });
  });

  it("漂移暂停：resume 确认弹窗展示被拒列，确认后提交 accept_columns 并恢复", async () => {
    const drift = "drift: 列 price 缺失，列 amount 类型变更";
    const backend = install({
      datasets: [
        makeDataset({
          id: "ds-1",
          name: "ERP 订单",
          source_kind: "connector",
          source_ref: "erp_db",
          sync_status: "paused_drift",
          paused_reason: drift,
        }),
      ],
      datasetRows: {
        "ds-1": { columns: [{ name: "id", type: "INTEGER" }], rows: [{ id: 1 }] },
      },
    });
    backend.addSync({
      id: "sy-1",
      dataset_id: "ds-1",
      started_at: NOW,
      finished_at: NOW,
      status: "drift",
      rows: 0,
      error: drift,
    });

    render(<DatasetsPage planCode="basic" />);
    fireEvent.click(await screen.findByTestId("dataset-open"));
    expect(await screen.findByTestId("drift-banner")).toBeTruthy();
    expect((await screen.findByTestId("sync-row")).getAttribute("data-status")).toBe(
      "drift",
    );

    fireEvent.click(screen.getByTestId("drift-resume"));
    expect(screen.getByTestId("resume-dialog")).toBeTruthy();
    expect(screen.getByTestId("resume-reason").textContent).toContain(drift);
    expect(
      screen.getAllByTestId("resume-column").map((el) => el.getAttribute("data-column")),
    ).toEqual(["price", "amount"]);

    fireEvent.click(screen.getByTestId("resume-confirm"));
    await waitFor(() =>
      expect(postCalls(backend, "/api/v1/datasets/ds-1/resume").length).toBe(1),
    );
    expect(postCalls(backend, "/api/v1/datasets/ds-1/resume")[0]!.body).toEqual({
      accept_columns: ["price", "amount"],
    });
    expect(await screen.findByTestId("resume-done")).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByTestId("detail-sync-status").getAttribute("data-status"),
      ).toBe("idle"),
    );
    expect(screen.queryByTestId("drift-banner")).toBeNull();
  });

  it("悬空：修正历史带悬空徽标，悬空清单逐条回滚后移出清单", async () => {
    const backend = install({
      datasets: [makeDataset({ id: "ds-1", name: "门店销量" })],
      datasetRows: {
        "ds-1": { columns: [{ name: "id", type: "INTEGER" }], rows: [{ id: 1 }] },
      },
    });
    backend.addCorrection({
      id: 1,
      dataset_id: "ds-1",
      op: "update",
      row_id: "hash:seed-1",
      column: "id",
      value: "9",
      values: null,
      actor: "demo",
      created_at: NOW,
      reverted_at: null,
      dangling_at: null,
      dangling_reason: null,
    });
    backend.addCorrection({
      id: 2,
      dataset_id: "ds-1",
      op: "delete",
      row_id: "hash:gone",
      column: null,
      value: null,
      values: null,
      actor: "demo",
      created_at: NOW,
      reverted_at: null,
      dangling_at: NOW,
      dangling_reason: "快照中无匹配行",
    });

    render(<DatasetsPage planCode="basic" />);
    fireEvent.click(await screen.findByTestId("dataset-open"));
    expect(await screen.findAllByTestId("correction-row")).toHaveLength(2);
    expect(screen.getAllByTestId("correction-dangling-badge")).toHaveLength(1);
    expect(screen.getByTestId("dangling-item")).toBeTruthy();

    fireEvent.click(screen.getByTestId("dangling-revert"));
    await waitFor(() =>
      expect(
        postCalls(backend, "/api/v1/datasets/ds-1/corrections/2/revert").length,
      ).toBe(1),
    );
    await waitFor(() => expect(screen.queryByTestId("dangling-item")).toBeNull());
    expect(screen.getByTestId("correction-reverted-badge")).toBeTruthy();
  });

  it("删除数据集：取消不动作；确认后发出 DELETE 并回列表刷新", async () => {
    const backend = install({
      datasets: [makeDataset({ id: "ds-1", name: "门店销量" })],
      datasetRows: {
        "ds-1": {
          columns: [{ name: "id", type: "INTEGER" }],
          rows: [{ id: 1 }],
        },
      },
    });
    render(<DatasetsPage planCode="basic" />);
    fireEvent.click(await screen.findByTestId("dataset-open"));
    await screen.findByTestId("preview-grid");

    fireEvent.click(screen.getByTestId("detail-delete"));
    const dialog = await screen.findByTestId("delete-dialog");
    // 文案如实：只删平台副本与修正记录，不碰客户源
    expect(dialog.textContent).toContain("客户源数据不受任何影响");

    // 取消：关弹窗、未发任何 DELETE、详情保持
    fireEvent.click(screen.getByTestId("delete-cancel"));
    expect(screen.queryByTestId("delete-dialog")).toBeNull();
    expect(backend.calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
    expect(screen.getByTestId("dataset-detail")).toBeTruthy();

    // 确认：DELETE /api/v1/datasets/ds-1，成功后回列表（fake 已删 → 空态）
    fireEvent.click(screen.getByTestId("detail-delete"));
    fireEvent.click(screen.getByTestId("delete-confirm"));
    await waitFor(() =>
      expect(
        backend.calls.filter(
          (call) =>
            call.method === "DELETE" &&
            call.url.pathname === "/api/v1/datasets/ds-1",
        ),
      ).toHaveLength(1),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("dataset-detail")).toBeNull(),
    );
    expect(await screen.findByTestId("datasets-empty")).toBeTruthy();
  });

  it("连接器来源的删除确认额外说明同步停止", async () => {
    install({
      datasets: [
        makeDataset({
          id: "ds-1",
          name: "ERP 订单",
          source_kind: "connector",
          source_ref: "erp_db",
        }),
      ],
    });
    render(<DatasetsPage planCode="basic" />);
    fireEvent.click(await screen.findByTestId("dataset-open"));
    await screen.findByTestId("dataset-detail");

    fireEvent.click(screen.getByTestId("detail-delete"));
    const dialog = await screen.findByTestId("delete-dialog");
    expect(
      screen.getByTestId("delete-connector-warning").textContent,
    ).toContain("同步停止");
    expect(dialog.textContent).toContain("客户源数据不受任何影响");
  });
});

describe("Connectors（任务 3.3）", () => {
  it("连接器列表：在线/离线/已吊销徽标、版本与最后心跳", async () => {
    install({
      datasets: [],
      connectors: [
        makeConnector({ id: "cn-1", name: "erp-connector" }),
        makeConnector({
          id: "cn-2",
          name: "offline-connector",
          status: "offline",
          last_heartbeat_at: null,
        }),
        makeConnector({ id: "cn-3", name: "revoked-connector", revoked_at: NOW }),
      ],
    });
    render(<DatasetsPage planCode="basic" />);

    const items = await screen.findAllByTestId("connector-item");
    expect(items.map((el) => el.getAttribute("data-status"))).toEqual([
      "online",
      "offline",
      "revoked",
    ]);
    expect(
      screen.getAllByTestId("connector-status").map((el) => el.textContent),
    ).toEqual(["在线", "离线", "已吊销"]);
    expect(
      screen.getAllByTestId("connector-heartbeat")[1]!.textContent,
    ).toContain("—");
    // 已吊销连接器不再提供吊销按钮
    expect(screen.getAllByTestId("connector-revoke")).toHaveLength(2);
  });

  it("配对向导：令牌仅显示一次，关闭后不再展示，重新生成得到新令牌", async () => {
    const backend = install({ datasets: [] });
    render(<DatasetsPage planCode="basic" />);
    await screen.findByTestId("connectors-empty");

    fireEvent.click(screen.getByTestId("pairing-generate"));
    const tokenEl = await screen.findByTestId("pairing-token");
    const firstToken = tokenEl.textContent!;
    expect(firstToken.startsWith("fwp_")).toBe(true);
    expect(screen.getByTestId("pairing-once-hint").textContent).toContain(
      "仅显示一次",
    );
    expect(screen.getByTestId("pairing-countdown").textContent).toContain(
      "剩余有效时间",
    );
    // 安装指引命令携带令牌与 api 地址
    expect(screen.getByTestId("pairing-command").textContent).toContain(
      `fd-wire-connector pair --token ${firstToken}`,
    );
    expect(
      screen.getByTestId("pairing-command").textContent,
    ).toContain("--api");
    expect(postCalls(backend, "/api/v1/connectors/pairing-tokens").length).toBe(1);

    // 一次性语义：关闭即不再展示（组件不持久化令牌）
    fireEvent.click(screen.getByTestId("pairing-dismiss"));
    expect(screen.queryByTestId("pairing-token")).toBeNull();

    fireEvent.click(screen.getByTestId("pairing-generate"));
    const secondToken = (await screen.findByTestId("pairing-token")).textContent;
    expect(secondToken).not.toBe(firstToken);
    expect(postCalls(backend, "/api/v1/connectors/pairing-tokens").length).toBe(2);
  });

  it("白名单配置：源名+源内表名双字段建档 → createDataset(connector) 载荷含 source_name", async () => {
    const backend = install({
      datasets: [],
      connectors: [makeConnector({ id: "cn-1", name: "erp-connector" })],
    });
    render(<DatasetsPage planCode="basic" />);
    await screen.findByTestId("connector-item");

    fireEvent.change(screen.getByTestId("whitelist-connector"), {
      target: { value: "cn-1" },
    });
    fireEvent.change(screen.getByTestId("whitelist-source-name"), {
      target: { value: "erp_db" },
    });
    fireEvent.change(screen.getByTestId("whitelist-source-ref"), {
      target: { value: "public.orders" },
    });
    fireEvent.change(screen.getByTestId("whitelist-name"), {
      target: { value: "ERP 订单" },
    });
    fireEvent.change(screen.getByTestId("whitelist-cron"), {
      target: { value: "0 3 * * *" },
    });
    fireEvent.submit(screen.getByTestId("whitelist-submit").closest("form")!);

    await waitFor(() =>
      expect(postCalls(backend, "/api/v1/datasets").length).toBe(1),
    );
    expect(postCalls(backend, "/api/v1/datasets")[0]!.body).toEqual({
      name: "ERP 订单",
      source: {
        kind: "connector",
        connector_id: "cn-1",
        source_name: "erp_db",
        source_ref: "public.orders",
        schedule_cron: "0 3 * * *",
      },
    });
    expect(await screen.findByTestId("whitelist-created")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getAllByTestId("dataset-card").length).toBe(1),
    );
    // 卡片来源展示「源名 · 源内表名」
    expect(screen.getByTestId("dataset-source-ref").textContent).toBe(
      "erp_db · public.orders",
    );
  });

  it("白名单校验：源名或源内表名缺一即禁用提交（必填提示可见）", async () => {
    install({
      datasets: [],
      connectors: [makeConnector({ id: "cn-1", name: "erp-connector" })],
    });
    render(<DatasetsPage planCode="basic" />);
    await screen.findByTestId("connector-item");

    const submit = () =>
      screen.getByTestId("whitelist-submit") as HTMLButtonElement;
    // 只选连接器：缺源名、缺源内表名
    fireEvent.change(screen.getByTestId("whitelist-connector"), {
      target: { value: "cn-1" },
    });
    expect(submit().disabled).toBe(true);
    expect(screen.getByTestId("whitelist-section").textContent).toContain(
      "均为必填",
    );

    // 补源名，仍缺源内表名 → 仍禁用
    fireEvent.change(screen.getByTestId("whitelist-source-name"), {
      target: { value: "erp_db" },
    });
    expect(submit().disabled).toBe(true);

    // 补齐源内表名（+名称）→ 解禁
    fireEvent.change(screen.getByTestId("whitelist-source-ref"), {
      target: { value: "public.orders" },
    });
    fireEvent.change(screen.getByTestId("whitelist-name"), {
      target: { value: "ERP 订单" },
    });
    expect(submit().disabled).toBe(false);
  });
});

describe("导航与路由接入（任务 3.1）", () => {
  it("ConsoleTab 加 datasets：CONSOLE_TABS 项与 /console/datasets 直达路由", () => {
    expect(CONSOLE_TABS).toContainEqual({
      id: "datasets",
      href: "#/console/datasets",
      labelKey: "console.nav.datasets",
    });
    expect(parseHash("#/console/datasets")).toEqual({
      name: "console",
      tab: "datasets",
    });
    // 模块文案全键化（中英键集合一致性由 i18nKeys.test.ts 全量守护）
    expect(i18n.t("console.nav.datasets")).toBe("我的数据");
    expect(i18n.t("console.datasets.title")).toBe("我的数据");
    expect(
      i18n.t("console.datasets.detail.pagination", {
        total: 3,
        page: 1,
        pages: 1,
      }),
    ).toContain("3");
  });
});

describe("DatasetsPage（免费档放行，wire-free-tier-data-gate 4.1-4.3）", () => {
  it("免费档完整渲染：标题/配额条/列表（含存储层徽标）/上传面；连接器区可见但标注付费且不发起连接器请求", async () => {
    const backend = install({
      planCode: "free",
      datasets: [
        makeDataset({ id: "ds-1", name: "轻量数据集", storage_tier: "api" }),
      ],
    });
    render(<DatasetsPage planCode="free" />);

    // 配额条内联（数值来自配额端点，不写死）：已用 1/3、每集 ≤10,000 行
    const quota = await screen.findByTestId("datasets-quota");
    expect(quota.getAttribute("data-exhausted")).toBe("false");
    expect(quota.textContent).toContain("1/3");
    expect(quota.textContent).toContain("10,000");
    // 列表卡片 + 存储层徽标（api 层数据集带 storage_tier；与 cell 层同列表）
    expect(await screen.findByTestId("dataset-card")).toBeTruthy();
    expect(
      screen.getByTestId("dataset-tier-badge").getAttribute("data-tier"),
    ).toBe("api");
    expect(screen.getByTestId("dataset-tier-badge").textContent).toBe(
      "轻量存储",
    );
    // 上传面照常渲染（免费通道 = CSV 上传）
    expect(screen.getByTestId("upload-section")).toBeTruthy();
    // 连接器区可见但标注付费：不渲染配对向导/白名单（不发起建集）
    expect(screen.getByTestId("connectors-section")).toBeTruthy();
    expect(screen.getByTestId("connectors-paid-badge").textContent).toBe(
      "付费档",
    );
    expect(screen.queryByTestId("pairing-wizard")).toBeNull();
    expect(screen.queryByTestId("whitelist-section")).toBeNull();
    // 免费档不发起任何连接器请求（连接器建集经引擎物化，属付费面）
    expect(
      backend.calls.filter((c) =>
        c.url.pathname.startsWith("/api/v1/connectors"),
      ),
    ).toEqual([]);
    // 点击付费徽标展开升档说明（mailto CTA）
    fireEvent.click(screen.getByTestId("connectors-paid-badge"));
    const note = await screen.findByTestId("connectors-paid-note");
    expect(note.textContent).toContain("付费档");
    expect(
      screen.getByTestId("connectors-paid-cta").getAttribute("href"),
    ).toMatch(/^mailto:/);
  });

  it("免费档上传建档：同接口列表刷新出新卡片（api 层带存储徽标），配额条同步 0/3 → 1/3", async () => {
    const backend = install({ planCode: "free", datasets: [] });
    render(<DatasetsPage planCode="free" />);
    await waitFor(() =>
      expect(screen.getByTestId("datasets-quota").textContent).toContain("0/3"),
    );

    fireEvent.change(
      screen.getByTestId("upload-file-input"),
      {
        target: {
          files: [
            new File(["id,amount\n1,2"], "sales.csv", { type: "text/csv" }),
          ],
        },
      },
    );
    await screen.findByTestId("upload-preview");
    fireEvent.click(screen.getByTestId("upload-create"));

    expect(await screen.findByTestId("upload-created")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getAllByTestId("dataset-card").length).toBe(1),
    );
    // api 层数据集与 cell 层同列表：响应带 storage_tier 即显徽标
    expect(
      screen.getByTestId("dataset-tier-badge").getAttribute("data-tier"),
    ).toBe("api");
    // 配额条随建档刷新
    await waitFor(() =>
      expect(screen.getByTestId("datasets-quota").textContent).toContain("1/3"),
    );
    expect(postCalls(backend, "/api/v1/datasets").length).toBe(1);
  });

  it("免费档建集触限：400 配额语义错误 → 错误如实 + 内联升档提示（amber），页面不退墙", async () => {
    install({
      planCode: "free",
      datasets: [],
      failCreateDatasetStatus: 400,
      failCreateDatasetDetail:
        "免费档数据集数量已达上限（3 个），升档可解锁更多",
    });
    render(<DatasetsPage planCode="free" />);
    await screen.findByTestId("datasets-quota");

    fireEvent.change(screen.getByTestId("upload-file-input"), {
      target: { files: [new File(["x"], "fourth.csv")] },
    });
    await screen.findByTestId("upload-preview");
    fireEvent.click(screen.getByTestId("upload-create"));

    // api 错误 detail 如实呈现
    const error = await screen.findByTestId("upload-error");
    expect(error.textContent).toContain("已达上限");
    // 内联升档提示（非整页墙）
    const hint = screen.getByTestId("upload-quota-hint");
    expect(hint.textContent).toContain("已达免费档限额");
    expect(
      screen.getByTestId("upload-quota-cta").getAttribute("href"),
    ).toMatch(/^mailto:/);
    expect(screen.getByTestId("upload-section")).toBeTruthy();
    expect(screen.getByTestId("connectors-section")).toBeTruthy();
  });

  it("免费档上传行数触限：错误如实 + 内联升档提示", async () => {
    install({
      planCode: "free",
      datasets: [],
      failUploadStatus: 400,
      failUploadDetail: "行数超出免费档单集上限（10,000 行），已拒收",
    });
    render(<DatasetsPage planCode="free" />);
    await screen.findByTestId("datasets-empty");

    fireEvent.change(screen.getByTestId("upload-file-input"), {
      target: { files: [new File(["x"], "big.csv")] },
    });
    expect(await screen.findByTestId("upload-error")).toBeTruthy();
    expect(screen.getByTestId("upload-quota-hint")).toBeTruthy();
  });

  it("配额端点未就绪：配额条静默隐藏，页面其余照常（不阻塞）", async () => {
    install({ planCode: "free", datasets: [], failQuotaStatus: 404 });
    render(<DatasetsPage planCode="free" />);

    expect(await screen.findByTestId("datasets-empty")).toBeTruthy();
    expect(screen.queryByTestId("datasets-quota")).toBeNull();
    expect(screen.getByTestId("upload-section")).toBeTruthy();
    expect(screen.getByTestId("connectors-section")).toBeTruthy();
  });

  it("配额触达上限态：配额条转 amber（exhausted）并附升档 CTA", async () => {
    install({
      planCode: "free",
      datasets: [
        makeDataset({ id: "ds-1", name: "集一" }),
        makeDataset({ id: "ds-2", name: "集二" }),
        makeDataset({ id: "ds-3", name: "集三" }),
      ],
    });
    render(<DatasetsPage planCode="free" />);

    const quota = await screen.findByTestId("datasets-quota");
    expect(quota.getAttribute("data-exhausted")).toBe("true");
    expect(quota.textContent).toContain("3/3");
    expect(
      screen.getByTestId("datasets-quota-upgrade").getAttribute("href"),
    ).toMatch(/^mailto:/);
  });

  it("付费档零变化：无配额条/付费徽标/存储徽标，连接器向导照常且不取配额", async () => {
    const backend = install({
      datasets: [makeDataset({ id: "ds-1", name: "门店销量" })],
      connectors: [makeConnector({ id: "cn-1", name: "erp-connector" })],
    });
    render(<DatasetsPage planCode="basic" />);

    expect(await screen.findByTestId("dataset-card")).toBeTruthy();
    expect(screen.queryByTestId("datasets-quota")).toBeNull();
    expect(screen.queryByTestId("dataset-tier-badge")).toBeNull();
    expect(screen.queryByTestId("connectors-paid-badge")).toBeNull();
    expect(screen.getByTestId("pairing-wizard")).toBeTruthy();
    expect(screen.getByTestId("whitelist-section")).toBeTruthy();
    expect(
      backend.calls.filter(
        (c) => c.url.pathname === "/api/v1/datasets/quota",
      ),
    ).toEqual([]);
  });

  it("plan_code 未下发（空串）→ 不按免费档阻塞，正常渲染数据面", async () => {
    install();
    render(<DatasetsPage planCode="" />);
    expect(await screen.findByTestId("upload-section")).toBeTruthy();
  });
});
