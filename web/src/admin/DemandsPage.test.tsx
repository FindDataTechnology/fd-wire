// 需求单派发台组件测试（wire-ux-consolidation 任务 3.5 三态化）：全客户列表 +
// 状态筛选查询形状、派发操作调用形状（POST transition）、非法迁移项禁用、
// rejected 必填理由、终态不可派发、409 冲突如实回显；末尾钉死三态机镜像与
// 后端白名单（api 仓 fd_wire_api/demands/statemachine.py）一致。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { DemandsPage } from "./DemandsPage";
import { installAdminBackend, seedAdminSession } from "./testing";
import type { AdminDemand } from "./api";
import { ALL_DEMAND_STATUSES, ALLOWED_TRANSITIONS } from "./demandsMachine";

const TOKEN = "test-admin-token";

function demand(partial: Partial<AdminDemand> & { id: number; status: AdminDemand["status"] }): AdminDemand {
  return {
    code: `DE-20261004-0${partial.id}`,
    customer_id: `cust-${partial.id}`,
    title: `需求 ${partial.id}`,
    intent: "意图",
    status_history: [
      { status: "submitted", at: "2026-10-04T09:00:00+00:00", by: `customer:cust-${partial.id}`, note: "需求单提交" },
    ],
    evaluation_summary: null,
    rejection_reason: null,
    quote_amount: null,
    quote_note: null,
    pipeline_events: [],
    delivery_events: [],
    gate: null,
    scope_status: null,
    scope_name: null,
    created_at: "2026-10-04T09:00:00",
    updated_at: "2026-10-04T09:00:00",
    ...partial,
  };
}

const DEMANDS: AdminDemand[] = [
  demand({ id: 1, status: "submitted", customer_id: "cust-001", title: "煤价日度" }),
  demand({ id: 2, status: "in_progress", customer_id: "cust-002", title: "航运运价" }),
  demand({ id: 3, status: "delivered", customer_id: "cust-002", title: "光伏装机" }),
];

beforeEach(() => {
  i18n.changeLanguage("zh");
  localStorage.clear();
  sessionStorage.clear();
  // admin 双闸（web 半边）：登录会话持 wire-admin 角色，idToken 与假后端
  // 的期望 Bearer 一致（X-Admin-Token 由 nginx 服务端注入，前端不持）。
  seedAdminSession();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

function openPanel(itemId: number) {
  const item = screen
    .getAllByTestId("admin-demand-item")
    .find((el) => el.textContent!.includes(`DE-20261004-0${itemId}`))!;
  fireEvent.click(
    screen.getAllByTestId("admin-demand-dispatch-toggle")[
      screen.getAllByTestId("admin-demand-item").indexOf(item)
    ]!,
  );
  return item;
}

/** 展开某单的编排进度面（wire-demand-visibility 任务 2.2）。 */
function expandProgress(itemId: number) {
  const items = screen.getAllByTestId("admin-demand-item");
  const item = items.find((el) =>
    el.textContent!.includes(`DE-20261004-0${itemId}`),
  )!;
  fireEvent.click(
    screen.getAllByTestId("admin-demand-progress-toggle")[
      items.indexOf(item)
    ]!,
  );
  return item;
}

describe("DemandsPage（需求单派发台）", () => {
  it("全客户列表渲染 + 状态筛选的查询形状（?status=）", async () => {
    const backend = installAdminBackend({ demands: DEMANDS, bearerToken: TOKEN });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<DemandsPage />);

    const items = await screen.findAllByTestId("admin-demand-item");
    expect(items.length).toBe(3);
    // 两家客户的单都在（全客户视图）
    const allText = items.map((el) => el.textContent!).join("\n");
    expect(allText).toContain("煤价日度");
    expect(allText).toContain("航运运价");
    expect(allText).toContain("光伏装机");
    expect(allText).toContain("cust-001");
    expect(allText).toContain("cust-002");

    fireEvent.change(screen.getByTestId("demand-status-filter"), {
      target: { value: "in_progress" },
    });
    await waitFor(() => {
      expect(screen.getAllByTestId("admin-demand-item").length).toBe(1);
    });
    const filterCall = backend.calls.filter((c) => c.url.pathname === "/internal/admin/demands").pop()!;
    expect(filterCall.url.searchParams.get("status")).toBe("in_progress");
  });

  it("派发操作：非法迁移项禁用，合法迁移的调用形状（target/by/note）与刷新", async () => {
    const backend = installAdminBackend({ demands: [DEMANDS[0]!], bearerToken: TOKEN });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<DemandsPage />);
    await screen.findAllByTestId("admin-demand-item");

    openPanel(1);
    const select = screen.getByTestId("admin-dispatch-target") as HTMLSelectElement;
    // submitted 只允许 in_progress / rejected：其余终态禁用
    const options = Array.from(select.options);
    expect(options.length).toBe(4);
    expect(options.find((o) => o.value === "in_progress")!.disabled).toBe(false);
    expect(options.find((o) => o.value === "rejected")!.disabled).toBe(false);
    for (const illegal of ["submitted", "delivered"]) {
      expect(options.find((o) => o.value === illegal)!.disabled).toBe(true);
    }

    fireEvent.change(screen.getByTestId("admin-dispatch-note"), {
      target: { value: "派发台接单" },
    });
    fireEvent.click(screen.getByTestId("admin-dispatch-submit"));

    await waitFor(() => {
      expect(
        screen.getByTestId("admin-demand-status").getAttribute("data-status"),
      ).toBe("in_progress");
    });

    const call = backend.calls.find((c) => c.method === "POST")!;
    expect(call.url.pathname).toBe("/internal/admin/demands/1/transition");
    expect(call.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(call.body).toEqual({
      target_status: "in_progress",
      by: "admin-console",
      note: "派发台接单",
    });
    // 时间线追加 admin-console 的派发记录
    expect(screen.getByTestId("admin-demand-last-event").textContent).toContain(
      "admin-console",
    );
  });

  it("rejected 必填理由：缺理由禁用提交，携带 reason 的调用形状", async () => {
    const backend = installAdminBackend({
      demands: [demand({ id: 2, status: "in_progress" })],
      bearerToken: TOKEN,
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<DemandsPage />);
    await screen.findAllByTestId("admin-demand-item");

    openPanel(2);
    fireEvent.change(screen.getByTestId("admin-dispatch-target"), {
      target: { value: "rejected" },
    });
    // 理由输入出现且提交禁用
    const submit = screen.getByTestId("admin-dispatch-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("admin-dispatch-reason"), {
      target: { value: "数据源不可达" },
    });
    expect((screen.getByTestId("admin-dispatch-submit") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("admin-dispatch-submit"));

    await waitFor(() => {
      expect(
        screen.getByTestId("admin-demand-status").getAttribute("data-status"),
      ).toBe("rejected");
    });
    const call = backend.calls.find((c) => c.method === "POST")!;
    expect(call.body).toEqual({
      target_status: "rejected",
      by: "admin-console",
      reason: "数据源不可达",
    });
  });

  it("终态（delivered）不可派发：按钮禁用且无面板", async () => {
    vi.stubGlobal(
      "fetch",
      installAdminBackend({ demands: [DEMANDS[2]!], bearerToken: TOKEN }).fetchImpl,
    );
    render(<DemandsPage />);
    await screen.findAllByTestId("admin-demand-item");
    const toggle = screen.getByTestId("admin-demand-dispatch-toggle") as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(screen.queryByTestId("admin-dispatch-panel")).toBeNull();
  });

  it("409 冲突如实回显（服务端是唯一裁决面）", async () => {
    // 假后端对迁移强制 409——面板提交后应出现冲突提示并保留原状态
    vi.stubGlobal(
      "fetch",
      installAdminBackend({
        demands: [DEMANDS[0]!],
        bearerToken: TOKEN,
        failTransitionStatus: 409,
      }).fetchImpl,
    );
    render(<DemandsPage />);
    await screen.findAllByTestId("admin-demand-item");

    openPanel(1);
    fireEvent.click(screen.getByTestId("admin-dispatch-submit"));
    const conflict = await screen.findByTestId("admin-dispatch-conflict");
    expect(conflict.textContent).toContain("不允许");
  });

  it("派发台文案不出现八个旧态名（三态 + rejected 为全集）", async () => {
    vi.stubGlobal(
      "fetch",
      installAdminBackend({ demands: DEMANDS, bearerToken: TOKEN }).fetchImpl,
    );
    render(<DemandsPage />);
    await screen.findAllByTestId("admin-demand-item");
    openPanel(1);

    const pageText = document.body.textContent ?? "";
    for (const legacy of [
      "evaluating",
      "quoted",
      "awaiting_confirm",
      "building",
      "delivery_acceptance",
      "评估中",
      "已报价",
      "待确认",
      "构建中",
      "交付验收",
    ]) {
      expect(pageText).not.toContain(legacy);
    }
  });

  it("转生成工单：仅 in_progress 单渲染出单区（submitted 面板无）", async () => {
    // 模块级 DEMANDS 会被前序用例的 transition 就地改状态（假后端共享
    // 引用）——这里自造新鲜数据，状态断言才可靠。
    vi.stubGlobal(
      "fetch",
      installAdminBackend(
        {
          demands: [
            demand({ id: 1, status: "submitted" }),
            demand({ id: 2, status: "in_progress" }),
          ],
          bearerToken: TOKEN,
        },
      ).fetchImpl,
    );
    render(<DemandsPage />);
    await screen.findAllByTestId("admin-demand-item");

    openPanel(2); // in_progress：出单区在场
    expect(screen.getByTestId("admin-workorder-section")).toBeDefined();
    expect(screen.getByTestId("admin-workorder-submit")).toBeDefined();

    openPanel(1); // submitted：派发面板在场但无出单区
    expect(screen.getByTestId("admin-dispatch-panel")).toBeDefined();
    expect(screen.queryByTestId("admin-workorder-section")).toBeNull();
  });

  it("出单成功：调用形状 + 路径/全文/未投递文案，无投递成功假象", async () => {
    const backend = installAdminBackend({
      demands: [DEMANDS[1]!],
      bearerToken: TOKEN,
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<DemandsPage />);
    await screen.findAllByTestId("admin-demand-item");

    openPanel(2);
    fireEvent.click(screen.getByTestId("admin-workorder-submit"));

    const result = await screen.findByTestId("admin-workorder-result");
    expect(result.textContent).toContain(
      "reports/health-tickets/20261004-wire-DE-20261004-02.yaml",
    );
    // 工单全文在场（人工推送降级红线）且形态正确
    expect(screen.getByTestId("admin-workorder-yaml").textContent).toContain(
      "kind: generate",
    );
    // 诚实降级：明示未投递，页面无任何投递成功字样
    expect(screen.getByTestId("admin-workorder-undelivered").textContent).toContain(
      "未投递",
    );
    expect(document.body.textContent ?? "").not.toContain("投递成功");

    const call = backend.calls
      .filter((c) => c.method === "POST")
      .find((c) => c.url.pathname === "/internal/admin/demands/2/workorder")!;
    expect(call).toBeDefined();
    expect(call.body).toBeUndefined(); // 无 slug 覆写：不带请求体
    expect(call.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
  });

  it("出单失败（422 无源地址）：琥珀框如实回显服务端 detail", async () => {
    vi.stubGlobal(
      "fetch",
      installAdminBackend({
        demands: [DEMANDS[1]!],
        bearerToken: TOKEN,
        failWorkorderStatus: 422,
      }).fetchImpl,
    );
    render(<DemandsPage />);
    await screen.findAllByTestId("admin-demand-item");

    openPanel(2);
    fireEvent.click(screen.getByTestId("admin-workorder-submit"));

    const conflict = await screen.findByTestId("admin-dispatch-conflict");
    expect(conflict.textContent).toContain("source_urls");
    // 失败不渲染任何成功面
    expect(screen.queryByTestId("admin-workorder-result")).toBeNull();
  });

  it("slug 探测 unverified：如实放行释义在场（free 文案不出现）", async () => {
    vi.stubGlobal(
      "fetch",
      installAdminBackend({
        demands: [DEMANDS[1]!],
        bearerToken: TOKEN,
        workorderResult: {
          ticket_yaml: "kind: generate\nunit: spiders/example-com/\n",
          ticket_path: "reports/health-tickets/20261004-wire-DE-20261004-02.yaml",
          delivered: false,
          queued_for_pull: true,
          slug_check: "unverified",
        },
      }).fetchImpl,
    );
    render(<DemandsPage />);
    await screen.findAllByTestId("admin-demand-item");

    openPanel(2);
    fireEvent.click(screen.getByTestId("admin-workorder-submit"));

    const slug = await screen.findByTestId("admin-workorder-slug");
    expect(slug.textContent).toContain("探测通道不可达");
    expect(slug.textContent).not.toContain("已确证空闲");
  });
});

describe("DemandsPage 编排进度面（wire-demand-visibility 任务 2.2）", () => {
  it("在途单：各阶段按序渲染 + 时间 + ticket_path + PR 链接", async () => {
    vi.stubGlobal(
      "fetch",
      installAdminBackend({
        demands: [
          demand({
            id: 2,
            status: "in_progress",
            pipeline_events: [
              {
                at: "2026-10-04T10:00:00+00:00",
                type: "workorder_exported",
                ticket_path: "reports/health-tickets/20261004-wire-DE-20261004-02.yaml",
                ticket_yaml: "kind: generate\n",
                sha256: "abc123",
              },
              {
                at: "2026-10-04T10:30:00+00:00",
                type: "pipeline_run",
                pipeline_run_id: "20261004-wire-DE-20261004-02.yaml",
                ticket_path: "reports/health-tickets/20261004-wire-DE-20261004-02.yaml",
                pr_url: null,
              },
              { at: "2026-10-04T11:00:00+00:00", type: "workorder_submitted" },
              {
                at: "2026-10-04T12:00:00+00:00",
                type: "pr_open",
                pr_url: "https://github.com/finddata/industry/pull/42",
              },
            ],
          }),
        ],
        bearerToken: TOKEN,
      }).fetchImpl,
    );
    render(<DemandsPage />);
    await screen.findAllByTestId("admin-demand-item");

    expandProgress(2);
    const entries = screen.getAllByTestId("admin-demand-progress-entry");
    expect(entries.map((el) => el.getAttribute("data-stage"))).toEqual([
      "workorder_exported",
      "pipeline_run",
      "workorder_submitted",
      "pr_open",
    ]);
    // 阶段文案 + 时间戳在场（顺序即事件顺序）
    const text = entries.map((el) => el.textContent!).join("\n");
    expect(text).toContain("已出单");
    expect(text).toContain("已投递（拉取器已落仓）");
    expect(text).toContain("已进入生成流水线");
    expect(text).toContain("爬虫已生成·待人工审核");
    expect(text).toContain(
      "reports/health-tickets/20261004-wire-DE-20261004-02.yaml",
    );
    expect(text).toContain("20261004-wire-DE-20261004-02.yaml");
    // 时间戳：本地化日期时间在场（格式断言避免时区脆弱）
    expect(text).toMatch(/\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}/);
    // PR 外链
    const pr = screen.getByTestId("admin-demand-progress-pr") as HTMLAnchorElement;
    expect(pr.getAttribute("href")).toBe(
      "https://github.com/finddata/industry/pull/42",
    );
    // 后续阶段未发生即不渲染
    expect(screen.queryByTestId("admin-demand-progress-empty")).toBeNull();
  });

  it("未出单：如实占位「尚未出单」，零阶段条目（不虚构进度）", async () => {
    vi.stubGlobal(
      "fetch",
      installAdminBackend({
        demands: [demand({ id: 1, status: "submitted" })],
        bearerToken: TOKEN,
      }).fetchImpl,
    );
    render(<DemandsPage />);
    await screen.findAllByTestId("admin-demand-item");

    expandProgress(1);
    expect(
      screen.getByTestId("admin-demand-progress-empty").textContent,
    ).toContain("尚未出单");
    expect(screen.queryAllByTestId("admin-demand-progress-entry").length).toBe(0);
  });

  it("merged + scope ok：点亮阶段与「私有数据面已就绪」+ scope 名", async () => {
    vi.stubGlobal(
      "fetch",
      installAdminBackend({
        demands: [
          demand({
            id: 3,
            status: "delivered",
            pipeline_events: [
              { at: "2026-10-04T10:00:00+00:00", type: "workorder_exported" },
              { at: "2026-10-04T12:00:00+00:00", type: "workorder_submitted" },
              { at: "2026-10-04T13:00:00+00:00", type: "pr_open" },
              {
                at: "2026-10-04T14:00:00+00:00",
                type: "merged",
                pr_url: "https://github.com/finddata/industry/pull/42",
              },
            ],
            scope_status: "ok",
            scope_name: "demand-DE-20261004-03",
          }),
        ],
        bearerToken: TOKEN,
      }).fetchImpl,
    );
    render(<DemandsPage />);
    await screen.findAllByTestId("admin-demand-item");

    expandProgress(3);
    const merged = screen
      .getAllByTestId("admin-demand-progress-entry")
      .find((el) => el.getAttribute("data-stage") === "merged")!;
    expect(merged.textContent).toContain("审核通过·部署点亮");
    // merged 绿点（客户面同款配色）
    expect(merged.querySelector(".bg-emerald-500")).not.toBeNull();
    const scope = screen.getByTestId("admin-demand-scope");
    expect(scope.getAttribute("data-scope-status")).toBe("ok");
    expect(scope.textContent).toContain("私有数据面已就绪");
    expect(scope.textContent).toContain("demand-DE-20261004-03");
  });

  it("scope pending：交付挂起·重试中", async () => {
    vi.stubGlobal(
      "fetch",
      installAdminBackend({
        demands: [
          demand({
            id: 3,
            status: "delivered",
            pipeline_events: [
              { at: "2026-10-04T10:00:00+00:00", type: "workorder_exported" },
            ],
            scope_status: "pending",
          }),
        ],
        bearerToken: TOKEN,
      }).fetchImpl,
    );
    render(<DemandsPage />);
    await screen.findAllByTestId("admin-demand-item");

    expandProgress(3);
    const scope = screen.getByTestId("admin-demand-scope");
    expect(scope.getAttribute("data-scope-status")).toBe("pending");
    expect(scope.textContent).toContain("交付挂起·重试中");
    expect(scope.textContent).not.toContain("已就绪");
  });

  it("blocked：红点受阻阶段渲染（运营跟进语义）", async () => {
    vi.stubGlobal(
      "fetch",
      installAdminBackend({
        demands: [
          demand({
            id: 2,
            status: "in_progress",
            pipeline_events: [
              { at: "2026-10-04T10:00:00+00:00", type: "workorder_exported" },
              {
                at: "2026-10-04T11:00:00+00:00",
                type: "blocked",
                note: "工单提交连续 3 次未成功",
              },
            ],
          }),
        ],
        bearerToken: TOKEN,
      }).fetchImpl,
    );
    render(<DemandsPage />);
    await screen.findAllByTestId("admin-demand-item");

    expandProgress(2);
    const blocked = screen
      .getAllByTestId("admin-demand-progress-entry")
      .find((el) => el.getAttribute("data-stage") === "blocked")!;
    expect(blocked.textContent).toContain("生成受阻·运营跟进中");
    expect(blocked.querySelector(".bg-rose-500")).not.toBeNull();
    // note 等内部字段不倾倒进进度面
    expect(blocked.textContent).not.toContain("工单提交连续 3 次未成功");
  });

  it("未知事件类型静默跳过：其余事件照常渲染、页面不崩", async () => {
    vi.stubGlobal(
      "fetch",
      installAdminBackend({
        demands: [
          demand({
            id: 2,
            status: "in_progress",
            pipeline_events: [
              { at: "2026-10-04T10:00:00+00:00", type: "workorder_exported" },
              { at: "2026-10-04T10:15:00+00:00", type: "some_future_event", foo: 1 },
              { at: "2026-10-04T10:30:00+00:00", type: "pipeline_run" },
              { at: "2026-10-04T10:45:00+00:00", type: "gate_result", passed: true },
            ],
          }),
        ],
        bearerToken: TOKEN,
      }).fetchImpl,
    );
    render(<DemandsPage />);
    await screen.findAllByTestId("admin-demand-item");

    expandProgress(2);
    const stages = screen
      .getAllByTestId("admin-demand-progress-entry")
      .map((el) => el.getAttribute("data-stage"));
    // 未知类型与 gate_result 均不进时间线；已知两类照常
    expect(stages).toEqual(["workorder_exported", "pipeline_run"]);
    expect(screen.getByTestId("admin-demand-progress")).toBeDefined();
  });

  it("gate 摘要：通过/未通过 + 尝试/流水线运行数（无 gate 则省略）", async () => {
    vi.stubGlobal(
      "fetch",
      installAdminBackend({
        demands: [
          demand({
            id: 2,
            status: "in_progress",
            pipeline_events: [
              { at: "2026-10-04T10:00:00+00:00", type: "pipeline_run" },
            ],
            gate: {
              passed: false,
              attempts: 2,
              pipeline_runs: 1,
              latest: { passed: false },
            },
          }),
        ],
        bearerToken: TOKEN,
      }).fetchImpl,
    );
    render(<DemandsPage />);
    await screen.findAllByTestId("admin-demand-item");

    expandProgress(2);
    const gate = screen.getByTestId("admin-demand-gate");
    expect(gate.getAttribute("data-passed")).toBe("false");
    expect(gate.textContent).toContain("门禁未通过");
    expect(gate.textContent).toContain("尝试 2 次");
    expect(gate.textContent).toContain("流水线运行 1 次");
  });
});

describe("demandsMachine 镜像（wire-ux-consolidation 任务 3.5）", () => {
  it("状态全集 = 三态 + rejected（旧五态不在全集）", () => {
    expect(ALL_DEMAND_STATUSES).toEqual([
      "submitted",
      "in_progress",
      "delivered",
      "rejected",
    ]);
  });

  it("白名单与后端 statemachine.py 一致：rejected 自 submitted/in_progress 均可达", () => {
    expect(ALLOWED_TRANSITIONS).toEqual({
      submitted: ["in_progress", "rejected"],
      in_progress: ["delivered", "rejected"],
      delivered: [],
      rejected: [],
    });
  });
});
