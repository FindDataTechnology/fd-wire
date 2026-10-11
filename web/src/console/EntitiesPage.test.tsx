// 「实体」页测试（wire-entity-layer 任务 3.4）：
// - 导航接线：ConsoleLayout entities tab（我的数据之后）+ parseHash +
//   ConsoleView 挂载；
// - 三区渲染：实体卡（业务名/数据集/主键徽标/tier 徽标/描述/关系计数）；
// - 创建流：数据集下拉 → 主键列勾选（随数据集切换重置）→ 业务名 → 提交
//   （请求体 camelCase 冻结契约）；前端先拦（至少一列）；422 逐条 / 409 如实；
// - 关系表单纪律：目标实体下拉=其他实体、源列=本集列、**目标列下拉仅目标
//   实体主键列**；添加/删除关系；服务端 422 纪律文案逐条呈现；
// - 删除级联：确认文案带关系数（0 条换零关系口径）；删除后级联关系消失；
// - SVG 小图谱：节点/边（data-from/to/kind）出现、节点点击滚动定位、空态；
// - 假后端信封对齐：GET {entities}、graph {nodes,edges}、POST 201 裸实体项
//   （snake_case）、关系建删响应形状——逐端点锁死生产信封（本仓教训）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { EntitiesPage } from "./EntitiesPage";
import { ConsoleLayout } from "./ConsoleLayout";
import { ConsoleView } from "../views/ConsoleView";
import { parseHash } from "../App";
import {
  installConsoleBackend,
  makeIdToken,
  seedConsoleSession,
  type FakeEntityRelationshipSeed,
  type FakeEntitySeed,
  type FakeResponse,
} from "./testing";
import type { Dataset } from "./api";

/** 数据集工厂（storage_tier 为免费档徽标容错字段——cast 进 Dataset）。 */
function makeDataset(
  overrides: Partial<Dataset> & { storage_tier?: string },
): Dataset {
  return {
    id: "ds-1",
    key: "ds_1",
    name: "数据集",
    source_kind: "upload",
    connector_id: null,
    source_ref: null,
    columns: [],
    row_count: 100,
    size_bytes: 2_400,
    sync_cron: null,
    sync_status: "ok",
    paused_reason: null,
    created_at: "2026-10-01T00:00:00",
    updated_at: "2026-10-01T00:00:00",
    ...overrides,
  } as Dataset;
}

const customersDataset = makeDataset({
  id: "ds-1",
  key: "customers",
  name: "客户表",
  columns: [
    { name: "id", type: "INTEGER" },
    { name: "name", type: "TEXT" },
    { name: "city", type: "TEXT" },
  ],
  row_count: 1_200,
  // tier 徽标来源（api = 免费档轻量存储）。
  storage_tier: "api",
});

const ordersDataset = makeDataset({
  id: "ds-2",
  key: "orders",
  name: "订单表",
  columns: [
    { name: "order_id", type: "INTEGER" },
    { name: "customer_id", type: "INTEGER" },
    { name: "amount", type: "REAL" },
  ],
  row_count: 9_800,
});

function seedEntities(): FakeEntitySeed[] {
  return [
    {
      id: 1,
      name: "客户",
      datasetId: "ds-1",
      pkColumns: ["id"],
      description: "下单主体",
    },
    { id: 2, name: "订单", datasetId: "ds-2", pkColumns: ["order_id"] },
  ];
}

function seedRelationships(): FakeEntityRelationshipSeed[] {
  return [
    {
      id: 11,
      fromEntityId: 2,
      fromColumn: "customer_id",
      toEntityId: 1,
      toColumn: "id",
      kind: "n:1",
      label: "下单客户",
    },
  ];
}

/** 按实体 id 取卡片上的指定 testid 元素（列表内多卡同 testid）。 */
function elementOf(testid: string, entityId: number): HTMLElement {
  return screen
    .getAllByTestId(testid)
    .find((el) => el.getAttribute("data-entity-id") === String(entityId))!;
}

/** 按实体 id 取整卡（卡内查询避免与图谱同名文本互撞）。 */
function cardOf(entityId: number): HTMLElement {
  return screen
    .getAllByTestId("entity-card")
    .find((el) => el.getAttribute("data-entity-id") === String(entityId))!;
}

beforeEach(() => {
  i18n.changeLanguage("zh");
  localStorage.clear();
  sessionStorage.clear();
  seedConsoleSession();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe("EntitiesPage 导航接线（ConsoleLayout tab + hash 路由 + 挂载）", () => {
  it("左侧栏含「实体」tab（顺序：我的数据之后、源包之前），href 指向 #/console/entities", () => {
    render(
      <ConsoleLayout
        tab="entities"
        customerName="演示客户"
        planCode="free"
        identity="demo@test"
        onLogout={() => {}}
      >
        <EntitiesPage />
      </ConsoleLayout>,
    );
    const nav = screen.getByTestId("console-nav");
    const ids = [...nav.querySelectorAll("a")].map((a) =>
      a.getAttribute("data-testid"),
    );
    expect(ids.indexOf("console-nav-datasets")).toBeLessThan(
      ids.indexOf("console-nav-entities"),
    );
    expect(ids.indexOf("console-nav-entities")).toBeLessThan(
      ids.indexOf("console-nav-packs"),
    );
    expect(screen.getByTestId("console-nav-entities").getAttribute("href")).toBe(
      "#/console/entities",
    );
    expect(screen.getByTestId("console-nav-entities").textContent).toContain(
      "实体",
    );
  });

  it("parseHash：#/console/entities 解析为 entities tab", () => {
    expect(parseHash("#/console/entities")).toEqual({
      name: "console",
      tab: "entities",
    });
  });

  it("ConsoleView：entities tab 挂载实体页（三端点自动拉取）", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
      entities: seedEntities(),
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<ConsoleView tab="entities" />);
    expect(await screen.findByTestId("entities-page")).toBeTruthy();
    expect(
      backend.calls.some((c) => c.url.pathname === "/api/v1/entities"),
    ).toBe(true);
    expect(
      backend.calls.some((c) => c.url.pathname === "/api/v1/entities/graph"),
    ).toBe(true);
  });
});

describe("EntitiesPage 三区渲染（实体卡 + 关系行 + SVG 图谱）", () => {
  it("实体卡：业务名/数据集名/行数/tier 徽标/主键徽标/描述/关系计数", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
      entities: seedEntities(),
      entityRelationships: seedRelationships(),
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<EntitiesPage />);

    const cards = await screen.findAllByTestId("entity-card");
    expect(cards).toHaveLength(2);
    // 业务名 / 数据集名（卡内查询——图谱节点含同名文本）。
    expect(within(cardOf(1)).getByTestId("entity-name").textContent).toBe(
      "客户",
    );
    expect(within(cardOf(2)).getByTestId("entity-name").textContent).toBe(
      "订单",
    );
    expect(within(cardOf(1)).getByTestId("entity-dataset").textContent).toBe(
      "客户表",
    );
    expect(within(cardOf(2)).getByTestId("entity-dataset").textContent).toBe(
      "订单表",
    );
    expect(screen.getByText("1200 行")).toBeTruthy();
    const tierBadge = screen.getByTestId("entity-tier-badge");
    expect(tierBadge.getAttribute("data-tier")).toBe("api");
    expect(tierBadge.textContent).toContain("轻量存储");
    // 主键徽标组。
    const pkBadges = screen.getAllByTestId("entity-pk-badge");
    expect(pkBadges.map((el) => el.getAttribute("data-column"))).toEqual([
      "id",
      "order_id",
    ]);
    // 描述（客户有、订单无）。
    expect(screen.getByTestId("entity-desc").textContent).toBe("下单主体");
    // 关系计数（两端各 1 条端点关系）。
    expect(elementOf("entity-toggle-relationships", 1).textContent).toContain(
      "1",
    );
    expect(elementOf("entity-toggle-relationships", 2).textContent).toContain(
      "1",
    );
  });

  it("他企实体不可见（customer_id 隔离 → 不渲染）", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
      entities: [
        ...seedEntities(),
        {
          id: 9,
          name: "他企实体",
          datasetId: "ds-1",
          pkColumns: ["id"],
          customer_id: "other-customer",
        },
      ],
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<EntitiesPage />);

    await screen.findAllByTestId("entity-card");
    expect(screen.queryByText("他企实体")).toBeNull();
  });

  it("空态：无实体时如实呈现空卡片 + 图谱空文案", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset],
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<EntitiesPage />);

    expect(await screen.findByTestId("entities-empty")).toBeTruthy();
    expect(screen.getByTestId("entity-graph-empty").textContent).toContain(
      "图谱为空",
    );
    expect(screen.queryByTestId("entity-graph")).toBeNull();
  });

  it("加载失败：错误如实呈现 + 重试恢复", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
      entities: seedEntities(),
      failEntitiesStatus: 503,
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<EntitiesPage />);

    const error = await screen.findByTestId("entities-error");
    expect(error.textContent).toContain("实体加载失败");
    // 重试：换健康后端恢复。
    vi.stubGlobal(
      "fetch",
      installConsoleBackend([], {
        datasets: [customersDataset, ordersDataset],
        entities: seedEntities(),
      }).fetchImpl,
    );
    fireEvent.click(screen.getByTestId("entities-retry"));
    expect(await screen.findAllByTestId("entity-card")).toHaveLength(2);
  });
});

describe("EntitiesPage 创建流（数据集下拉 → 主键勾选 → 业务名 → 描述）", () => {
  async function openForm() {
    fireEvent.click(screen.getByTestId("entity-create-open"));
    return screen.findByTestId("entity-create-form");
  }

  it("全流程：选数据集 → 勾主键列 → 起名 → 提交（camelCase 请求体 + 卡片入列 + 图谱节点出现）", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<EntitiesPage />);
    await screen.findByTestId("entities-empty");

    await openForm();
    // 未选数据集：主键勾选区为空态提示。
    expect(screen.getByTestId("entity-create-pk-empty")).toBeTruthy();

    fireEvent.change(screen.getByTestId("entity-create-dataset"), {
      target: { value: "ds-1" },
    });
    // 主键勾选源 = 该数据集列清单。
    const checks = await screen.findAllByTestId("entity-create-pk-check");
    expect(checks.map((el) => el.getAttribute("data-column"))).toEqual([
      "id",
      "name",
      "city",
    ]);
    fireEvent.click(
      checks.find((el) => el.getAttribute("data-column") === "id")!,
    );
    fireEvent.click(
      checks.find((el) => el.getAttribute("data-column") === "city")!,
    );
    fireEvent.change(screen.getByTestId("entity-create-name"), {
      target: { value: "客户" },
    });
    fireEvent.change(screen.getByTestId("entity-create-desc"), {
      target: { value: "下单主体" },
    });
    fireEvent.click(screen.getByTestId("entity-create-submit"));

    // 请求体冻结契约：camelCase + 列序随数据集列序。
    const call = await waitFor(() => {
      const found = backend.calls.find(
        (c) => c.url.pathname === "/api/v1/entities" && c.method === "POST",
      );
      expect(found).toBeTruthy();
      return found!;
    });
    expect(call.body).toEqual({
      name: "客户",
      dataset_id: "ds-1",
      pk_columns: ["id", "city"],
      description: "下单主体",
    });
    expect(call.headers["authorization"]).toMatch(/^Bearer /);
    // 成功：卡片入列 + 小图谱出现该节点。
    expect(await screen.findAllByTestId("entity-card")).toHaveLength(1);
    expect(screen.getAllByTestId("entity-graph-node")).toHaveLength(1);
    expect(screen.queryByTestId("entity-create-form")).toBeNull();
  });

  it("前端先拦：未勾主键列不发请求；换数据集重置勾选", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<EntitiesPage />);
    await screen.findByTestId("entities-empty");

    await openForm();
    fireEvent.change(screen.getByTestId("entity-create-dataset"), {
      target: { value: "ds-1" },
    });
    const checks = screen.getAllByTestId("entity-create-pk-check");
    fireEvent.click(
      checks.find((el) => el.getAttribute("data-column") === "id")!,
    );
    // 换数据集：勾选清空（列清单随集而变）。
    fireEvent.change(screen.getByTestId("entity-create-dataset"), {
      target: { value: "ds-2" },
    });
    expect(
      screen
        .getAllByTestId("entity-create-pk-check")
        .every((el) => (el as HTMLInputElement).checked === false),
    ).toBe(true);
    fireEvent.change(screen.getByTestId("entity-create-name"), {
      target: { value: "订单" },
    });
    fireEvent.click(screen.getByTestId("entity-create-submit"));
    // 未勾主键列：本地报错、零请求。
    const errors = screen.getByTestId("entity-create-errors");
    expect(errors.textContent).toContain("请至少勾选一个主键列");
    expect(
      backend.calls.some(
        (c) => c.url.pathname === "/api/v1/entities" && c.method === "POST",
      ),
    ).toBe(false);
  });

  it("422 逐条呈现：detail 数组每条 msg 各占一行（表单不关可改再试）", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset],
      failEntityCreateStatus: 422,
      failEntityCreateDetail: [
        {
          type: "value_error",
          loc: ["body", "pkColumns"],
          msg: "主键列不在数据集「客户表」的列清单中：foo",
        },
        {
          type: "too_short",
          loc: ["body", "name"],
          msg: "业务名不能为空（或全为空白字符）",
        },
      ],
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<EntitiesPage />);
    await screen.findByTestId("entities-empty");

    await openForm();
    fireEvent.change(screen.getByTestId("entity-create-dataset"), {
      target: { value: "ds-1" },
    });
    fireEvent.click(screen.getAllByTestId("entity-create-pk-check")[0]!);
    fireEvent.change(screen.getByTestId("entity-create-name"), {
      target: { value: "客户" },
    });
    fireEvent.click(screen.getByTestId("entity-create-submit"));

    const errors = await screen.findByTestId("entity-create-errors");
    const lines = [...errors.querySelectorAll("li")].map((li) => li.textContent);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("主键列不在数据集「客户表」的列清单中：foo");
    expect(lines[1]).toContain("业务名不能为空");
    // 表单保持打开。
    expect(screen.getByTestId("entity-create-form")).toBeTruthy();
  });

  it("409 冲突如实呈现（string detail 单行）", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset],
      failEntityCreateStatus: 409,
      failEntityCreateDetail: "业务名「客户」已存在——实体名在本企业内唯一",
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<EntitiesPage />);
    await screen.findByTestId("entities-empty");

    await openForm();
    fireEvent.change(screen.getByTestId("entity-create-dataset"), {
      target: { value: "ds-1" },
    });
    fireEvent.click(screen.getAllByTestId("entity-create-pk-check")[0]!);
    fireEvent.change(screen.getByTestId("entity-create-name"), {
      target: { value: "客户" },
    });
    fireEvent.click(screen.getByTestId("entity-create-submit"));

    const errors = await screen.findByTestId("entity-create-errors");
    expect(errors.textContent).toContain("业务名「客户」已存在");
  });
});

describe("EntitiesPage 关系管理（表单纪律 + 添加/删除）", () => {
  it("纪律：目标实体下拉=其他实体；源列=本集列；目标列下拉仅目标实体主键列", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
      entities: seedEntities(),
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<EntitiesPage />);
    await screen.findAllByTestId("entity-card");

    // 展开订单（id=2）的关系面板。
    fireEvent.click(elementOf("entity-toggle-relationships", 2));
    const panel = await screen.findByTestId("entity-relationships");
    expect(panel.getAttribute("data-entity-id")).toBe("2");
    // 新实体尚无关系。
    expect(screen.getByTestId("entity-relationships-empty")).toBeTruthy();

    const optionValues = (select: HTMLElement) =>
      [
        ...select.querySelectorAll("option"),
      ]
        .map((o) => o.getAttribute("value"))
        .filter((v): v is string => !!v);
    // 目标实体下拉：仅其他实体（客户 id=1），不含订单自身。
    const targetSelect = screen.getByTestId("entity-relationship-target");
    expect(optionValues(targetSelect)).toEqual(["1"]);
    // 源列下拉：订单表全部列。
    const fromSelect = screen.getByTestId("entity-relationship-from");
    expect(optionValues(fromSelect)).toEqual(["order_id", "customer_id", "amount"]);
    // 未选目标实体：目标列下拉禁用。
    const toSelect = screen.getByTestId(
      "entity-relationship-to",
    ) as HTMLSelectElement;
    expect(toSelect.disabled).toBe(true);

    // 选定目标实体「客户」→ 目标列下拉只有其主键列 id（不是数据集全部列）。
    fireEvent.change(targetSelect, { target: { value: "1" } });
    expect(toSelect.disabled).toBe(false);
    expect(optionValues(toSelect)).toEqual(["id"]);
    expect(optionValues(toSelect)).not.toContain("name");
    expect(optionValues(toSelect)).not.toContain("city");
  });

  it("添加关系：提交 camelCase 载荷 → 行入列（from →(kind) 目标.主键 + label）", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
      entities: seedEntities(),
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<EntitiesPage />);
    await screen.findAllByTestId("entity-card");

    fireEvent.click(elementOf("entity-toggle-relationships", 2));
    await screen.findByTestId("entity-relationships");

    fireEvent.change(screen.getByTestId("entity-relationship-target"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByTestId("entity-relationship-from"), {
      target: { value: "customer_id" },
    });
    fireEvent.change(screen.getByTestId("entity-relationship-to"), {
      target: { value: "id" },
    });
    fireEvent.change(screen.getByTestId("entity-relationship-label-input"), {
      target: { value: "下单客户" },
    });
    fireEvent.click(screen.getByTestId("entity-relationship-submit"));

    const call = await waitFor(() => {
      const found = backend.calls.find(
        (c) =>
          c.url.pathname === "/api/v1/entities/2/relationships" &&
          c.method === "POST",
      );
      expect(found).toBeTruthy();
      return found!;
    });
    expect(call.body).toEqual({
      to_entity_id: 1,
      from_column: "customer_id",
      to_column: "id",
      kind: "n:1",
      label: "下单客户",
    });
    expect(call.headers["authorization"]).toMatch(/^Bearer /);

    // 行入列：订单.customer_id →(n:1) 客户.id + label。
    const row = await screen.findByTestId("entity-relationship-row");
    expect(row.textContent).toContain("订单.customer_id");
    expect(row.textContent).toContain("→(n:1)");
    expect(row.textContent).toContain("客户.id");
    expect(screen.getByTestId("entity-relationship-label").textContent).toBe(
      "下单客户",
    );
    // 假后端状态落位。
    expect(backend.getEntityRelationships()).toHaveLength(1);
  });

  it("删除关系：DELETE /entities/{id}/relationships/{relId} → 行消失", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
      entities: seedEntities(),
      entityRelationships: seedRelationships(),
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<EntitiesPage />);
    await screen.findAllByTestId("entity-card");

    fireEvent.click(elementOf("entity-toggle-relationships", 2));
    expect(await screen.findByTestId("entity-relationship-row")).toBeTruthy();

    fireEvent.click(screen.getByTestId("entity-relationship-delete"));
    await waitFor(() => {
      expect(
        backend.calls.some(
          (c) =>
            c.url.pathname === "/api/v1/entities/2/relationships/11" &&
            c.method === "DELETE",
        ),
      ).toBe(true);
    });
    expect(await screen.findByTestId("entity-relationships-empty")).toBeTruthy();
    expect(backend.getEntityRelationships()).toHaveLength(0);
  });

  it("服务端 422 纪律文案逐条呈现（目标列必须是目标实体主键）", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
      entities: seedEntities(),
      failEntityRelationshipCreateStatus: 422,
      failEntityRelationshipCreateDetail: [
        {
          type: "value_error",
          loc: ["body", "toColumn"],
          msg: "关系目标必须是目标实体的主键列",
        },
      ],
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<EntitiesPage />);
    await screen.findAllByTestId("entity-card");

    fireEvent.click(elementOf("entity-toggle-relationships", 2));
    await screen.findByTestId("entity-relationships");
    fireEvent.change(screen.getByTestId("entity-relationship-target"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByTestId("entity-relationship-from"), {
      target: { value: "customer_id" },
    });
    fireEvent.change(screen.getByTestId("entity-relationship-to"), {
      target: { value: "id" },
    });
    fireEvent.click(screen.getByTestId("entity-relationship-submit"));

    const errors = await screen.findByTestId("entity-relationship-errors");
    expect(errors.textContent).toContain("关系目标必须是目标实体的主键列");
  });
});

describe("EntitiesPage 删除实体（级联关系确认文案）", () => {
  it("有关系：确认文案带级联数，确认后实体与关系一并消失", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
      entities: seedEntities(),
      entityRelationships: seedRelationships(),
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<EntitiesPage />);
    await screen.findAllByTestId("entity-card");

    // 客户（id=1）是关系的 to 端：删除它级联 1 条。
    fireEvent.click(elementOf("entity-delete", 1));
    const warning = await screen.findByTestId("entity-delete-warning");
    expect(warning.textContent).toContain("客户");
    expect(warning.textContent).toContain("1");
    expect(warning.textContent).toContain("条关系");

    fireEvent.click(screen.getByTestId("entity-delete-confirm"));
    await waitFor(() => {
      expect(
        backend.calls.some(
          (c) =>
            c.url.pathname === "/api/v1/entities/1" && c.method === "DELETE",
        ),
      ).toBe(true);
    });
    // 卡片只剩订单；假后端级联删关系。
    await waitFor(() => {
      expect(screen.getAllByTestId("entity-card")).toHaveLength(1);
    });
    expect(backend.getEntityRelationships()).toHaveLength(0);
    // 订单面板里的关系行同步消失（图谱同源重载）。
    fireEvent.click(elementOf("entity-toggle-relationships", 2));
    expect(await screen.findByTestId("entity-relationships-empty")).toBeTruthy();
  });

  it("无关系：确认文案换零关系口径", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
      entities: seedEntities(),
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<EntitiesPage />);
    await screen.findAllByTestId("entity-card");

    fireEvent.click(elementOf("entity-delete", 2));
    const warning = await screen.findByTestId("entity-delete-warning");
    expect(warning.textContent).toContain("订单");
    expect(warning.textContent).not.toContain("将一并删除");

    fireEvent.click(screen.getByTestId("entity-delete-confirm"));
    await waitFor(() => {
      expect(screen.getAllByTestId("entity-card")).toHaveLength(1);
    });
  });
});

describe("EntitiesPage SVG 小图谱", () => {
  it("节点=实体（data-entity-id）、边=关系（data-from/to/kind + 标注）", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
      entities: seedEntities(),
      entityRelationships: seedRelationships(),
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<EntitiesPage />);
    await screen.findAllByTestId("entity-card");

    const nodes = await screen.findAllByTestId("entity-graph-node");
    expect(nodes.map((el) => el.getAttribute("data-entity-id"))).toEqual([
      "1",
      "2",
    ]);
    const edge = screen.getByTestId("entity-graph-edge");
    expect(edge.getAttribute("data-from")).toBe("2");
    expect(edge.getAttribute("data-to")).toBe("1");
    expect(edge.getAttribute("data-kind")).toBe("n:1");
    // kind + label 小标注（文本节点）。
    expect(edge.textContent).toContain("n:1");
    expect(edge.textContent).toContain("下单客户");
  });

  it("节点点击：滚动定位到对应实体卡", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
      entities: seedEntities(),
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<EntitiesPage />);
    await screen.findAllByTestId("entity-card");

    // jsdom 无 scrollIntoView 实现——注入 spy 断言调用后还原。
    const proto = Element.prototype as unknown as {
      scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
    };
    const spy = vi.fn();
    proto.scrollIntoView = spy;
    try {
      const node = screen
        .getAllByTestId("entity-graph-node")
        .find((el) => el.getAttribute("data-entity-id") === "2")!;
      fireEvent.click(node);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      delete proto.scrollIntoView;
    }
  });

  it("无关系只有实体：节点在、边零", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
      entities: seedEntities(),
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<EntitiesPage />);
    await screen.findAllByTestId("entity-card");
    expect(screen.getAllByTestId("entity-graph-node")).toHaveLength(2);
    expect(screen.queryByTestId("entity-graph-edge")).toBeNull();
  });
});

describe("假后端信封对齐（逐端点锁死生产形状）", () => {
  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${makeIdToken()}`,
    Accept: "application/json",
  });
  const bodyOf = (res: FakeResponse) => res.json();

  it("GET /api/v1/entities → {entities:[…]} 信封；实体项 snake_case + dataset 摘要", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
      entities: seedEntities(),
    });
    const res = await backend.fetchImpl("/api/v1/entities", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await bodyOf(res)) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["entities"]);
    const first = (body.entities as Array<Record<string, unknown>>)[0]!;
    expect(Object.keys(first).sort()).toEqual(
      ["dataset", "description", "id", "name", "pk_columns"].sort(),
    );
    expect(first["pk_columns"]).toEqual(["id"]);
    expect(Object.keys(first["dataset"] as object).sort()).toEqual(
      ["id", "key", "name", "row_count", "storage_tier"].sort(),
    );
  });

  it("GET /api/v1/entities/graph → {nodes,edges}；边 snake_case 四元组 + kind", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
      entities: seedEntities(),
      entityRelationships: seedRelationships(),
    });
    const res = await backend.fetchImpl("/api/v1/entities/graph", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await bodyOf(res)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["edges", "nodes"]);
    expect(body["nodes"]).toHaveLength(2);
    const edge = (body["edges"] as Array<Record<string, unknown>>)[0]!;
    expect(Object.keys(edge).sort()).toEqual(
      [
        "from_column",
        "from_entity_id",
        "id",
        "kind",
        "label",
        "to_column",
        "to_entity_id",
      ].sort(),
    );
  });

  it("空图谱：{nodes:[],edges:[]}（200，非 404）", async () => {
    const backend = installConsoleBackend([], {});
    const res = await backend.fetchImpl("/api/v1/entities/graph", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ nodes: [], edges: [] });
  });

  it("POST /api/v1/entities → 201 裸实体项（非信封）；删除级联回带数量", async () => {
    const employeesDataset = makeDataset({
      id: "ds-3",
      key: "employees",
      name: "员工表",
      columns: [
        { name: "emp_id", type: "INTEGER" },
        { name: "manager_id", type: "INTEGER" },
      ],
      row_count: 60,
    });
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset, employeesDataset],
      entities: seedEntities(),
      entityRelationships: seedRelationships(),
    });
    const created = await backend.fetchImpl("/api/v1/entities", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "员工",
        dataset_id: "ds-3",
        pk_columns: ["emp_id"],
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await bodyOf(created)) as Record<string, unknown>;
    expect(createdBody["pk_columns"]).toEqual(["emp_id"]);
    expect(createdBody["entities"]).toBeUndefined();

    // 删除带关系的实体：级联数量如实回带。
    const deleted = await backend.fetchImpl("/api/v1/entities/1", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(deleted.status).toBe(200);
    expect(await bodyOf(deleted)).toEqual({
      deleted: true,
      deleted_relationships: 1,
    });
    expect(backend.getEntityRelationships()).toHaveLength(0);
  });

  it("POST 关系 → 201 裸关系项；目标列不在目标主键 → 422 纪律文案", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
      entities: seedEntities(),
    });
    // toColumn=name 不在目标实体（客户）主键集合 → 422。
    const rejected = await backend.fetchImpl(
      "/api/v1/entities/2/relationships",
      {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          to_entity_id: 1,
          from_column: "customer_id",
          to_column: "name",
          kind: "n:1",
        }),
      },
    );
    expect(rejected.status).toBe(422);
    const rejectedBody = (await bodyOf(rejected)) as { detail: unknown };
    expect(JSON.stringify(rejectedBody.detail)).toContain(
      "关系目标必须是目标实体的主键列",
    );

    // 合法关系 → 201 裸关系项（snake_case）。
    const created = await backend.fetchImpl(
      "/api/v1/entities/2/relationships",
      {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          to_entity_id: 1,
          from_column: "customer_id",
          to_column: "id",
          kind: "1:1",
        }),
      },
    );
    expect(created.status).toBe(201);
    const rel = (await bodyOf(created)) as Record<string, unknown>;
    expect(rel["from_entity_id"]).toBe(2);
    expect(rel["to_entity_id"]).toBe(1);
    expect(rel["kind"]).toBe("1:1");
    expect(rel["label"]).toBeNull();
  });

  it("重复业务名 / 重复绑定数据集 → 409", async () => {
    const backend = installConsoleBackend([], {
      datasets: [customersDataset, ordersDataset],
      entities: seedEntities(),
    });
    const dupName = await backend.fetchImpl("/api/v1/entities", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "客户",
        dataset_id: "ds-2",
        pk_columns: ["order_id"],
      }),
    });
    expect(dupName.status).toBe(409);
    const dupDataset = await backend.fetchImpl("/api/v1/entities", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "新实体",
        dataset_id: "ds-1",
        pk_columns: ["id"],
      }),
    });
    expect(dupDataset.status).toBe(409);
  });
});
