// 「我的需求」只读列表测试（wire-ux-consolidation 任务 4.3）：
// - 展示：三态徽章 + rejected「未承接」+ 理由摘要 + 提交时间 + 需求摘要；
//   无任何迁移操作控件；
// - 隔离口径：调用层带 Bearer 且不传任何他企参数（跨客户隔离由服务端
//   /api/v1/demands 列表端点按映射客户保证，本测试 mock 该端点响应）；
// - 空态/加载失败文案自然。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { MyDemandsPage } from "./MyDemandsPage";
import {
  consoleFailingBackend,
  installConsoleBackend,
  seedConsoleSession,
} from "./testing";
import type { CustomerDemand } from "./api";

function demand(
  partial: Partial<CustomerDemand> & { id: number; status: string },
): CustomerDemand {
  return {
    code: `DE-20261010-0${partial.id}`,
    customer_id: "demo-customer",
    title: `需求摘要 ${partial.id}`,
    intent: "需求全文",
    contact_email: "buyer@acme.com",
    company: null,
    status_history: [],
    rejection_reason: null,
    created_at: "2026-10-10T08:00:00",
    updated_at: "2026-10-10T08:00:00",
    ...partial,
  };
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

describe("MyDemandsPage（我的需求 · 只读列表）", () => {
  it("展示：三态徽章 + 未承接（含理由）+ 提交时间 + 摘要，且无迁移操作控件", async () => {
    const backend = installConsoleBackend(
      [],
      {
        demands: [
          demand({ id: 1, status: "submitted", title: "煤价日度指标" }),
          demand({ id: 2, status: "in_progress", title: "航运运价指标" }),
          demand({ id: 3, status: "delivered", title: "光伏装机指标" }),
          demand({
            id: 4,
            status: "rejected",
            title: "海关明细数据",
            rejection_reason: "数据源不公开，无法承接",
          }),
        ],
      },
    );
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<MyDemandsPage />);

    const items = await screen.findAllByTestId("my-demand-item");
    expect(items.length).toBe(4);

    const statuses = screen
      .getAllByTestId("my-demand-status")
      .map((el) => el.getAttribute("data-status"));
    expect(statuses).toEqual(["rejected", "delivered", "in_progress", "submitted"]);
    expect(screen.getAllByText("已收到").length).toBe(1);
    expect(screen.getAllByText("处理中").length).toBe(1);
    expect(screen.getAllByText("已交付").length).toBe(1);
    expect(screen.getAllByText("未承接").length).toBe(1);

    // rejected 展示理由摘要
    expect(
      screen.getByTestId("my-demand-rejection-reason").textContent,
    ).toContain("数据源不公开");

    // 摘要与提交时间
    expect(screen.getByText("煤价日度指标")).toBeTruthy();
    expect(screen.getAllByTestId("my-demand-time").length).toBe(4);
    expect(screen.getAllByTestId("my-demand-time")[0]!.textContent).toContain(
      "提交于",
    );

    // 只读：无任何迁移/派发操作控件
    expect(screen.queryByTestId("admin-demand-dispatch-toggle")).toBeNull();
    expect(screen.queryByTestId("admin-dispatch-panel")).toBeNull();
    expect(screen.queryByRole("button", { name: /派发|迁移|执行/ })).toBeNull();
  });

  it("跨客户隔离口径：调用层带 Bearer、不传任何他企参数（列表端点响应即全部）", async () => {
    const backend = installConsoleBackend(
      [],
      {
        demands: [
          demand({ id: 1, status: "submitted" }),
          // 他企的单：服务端（假后端按 customer_id 过滤）不会下发
          demand({ id: 2, status: "submitted", customer_id: "other-corp" }),
        ],
      },
    );
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<MyDemandsPage />);

    await screen.findAllByTestId("my-demand-item");
    const call = backend.calls.find((c) => c.url.pathname === "/api/v1/demands")!;
    expect(call.method).toBe("GET");
    expect(call.headers["authorization"]).toMatch(/^Bearer /);
    // 不携带任何客户过滤参数——归属过滤只在服务端
    expect(call.url.search).toBe("");
    // 只渲染本企业（服务端下发）的单
    expect(screen.getAllByTestId("my-demand-item").length).toBe(1);
    expect(screen.getAllByTestId("my-demand-item")[0]!.textContent).toContain(
      "DE-20261010-01",
    );
  });

  it("空态文案自然 + 提交入口", async () => {
    const backend = installConsoleBackend([], { demands: [] });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<MyDemandsPage />);

    const empty = await screen.findByTestId("my-demands-empty");
    expect(empty.textContent).toContain("还没有需求单");
    expect(screen.getByTestId("my-demands-new").getAttribute("href")).toBe(
      "#/console/demands/new",
    );
  });

  it("加载失败：错误如实呈现 + 重试", async () => {
    vi.stubGlobal("fetch", consoleFailingBackend(500, "demands down"));
    render(<MyDemandsPage />);

    const error = await screen.findByTestId("my-demands-error");
    expect(error.textContent).toContain("需求单加载失败");
    expect(error.textContent).toContain("demands down");
    expect(screen.getByTestId("my-demands-retry")).toBeTruthy();
  });
});
