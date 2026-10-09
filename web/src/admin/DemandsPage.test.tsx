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
