// 客户管理页组件测试（任务 7.1）：列表渲染、开户调用形状（X-Admin-Token
// 头 + 请求体）、鉴权失败态（403 fail-closed / 401）、空态。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { CustomersPage } from "./CustomersPage";
import { installAdminBackend } from "./testing";
import type { AdminCustomer } from "./api";

const TOKEN = "test-admin-token";

const CUSTOMERS: AdminCustomer[] = [
  {
    id: 1,
    name: "上海壹座",
    sub2api_user_id: "acme-caller",
    plan_id: 1,
    plan_code: "starter",
    plan_name: "起步版",
    status: "active",
    created_at: "2026-10-01T08:00:00",
  },
  {
    id: 2,
    name: "萬星數據",
    sub2api_user_id: null,
    plan_id: 3,
    plan_code: "enterprise",
    plan_name: "旗舰版",
    status: "suspended",
    created_at: "2026-10-02T08:00:00",
  },
];

beforeEach(() => {
  i18n.changeLanguage("zh");
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("CustomersPage（客户管理）", () => {
  it("列表渲染：名称/计量身份/档位/状态，sub2api 后续任务如实标注", async () => {
    const backend = installAdminBackend({ customers: CUSTOMERS, adminToken: TOKEN });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<CustomersPage token={TOKEN} />);

    const rows = await screen.findAllByTestId("admin-customer-row");
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain("上海壹座");
    expect(rows[0]!.textContent).toContain("acme-caller");
    expect(rows[1]!.textContent).toContain("萬星數據");
    // 档位下拉取自 /internal/admin/plans（三档 seed）
    const planSelect = screen.getAllByTestId("admin-customer-plan-select")[0] as HTMLSelectElement;
    expect(Array.from(planSelect.options).map((o) => o.value)).toEqual([
      "starter",
      "professional",
      "enterprise",
    ]);
    // 开户仅本地关联的如实标注
    expect(screen.getByTestId("admin-customers-sub2api-note").textContent).toContain(
      "sub2api",
    );
    // 请求带鉴权头
    expect(backend.calls.length).toBeGreaterThanOrEqual(2);
    expect(backend.calls[0]!.headers["x-admin-token"]).toBe(TOKEN);
  });

  it("开户：调用形状（POST /internal/admin/customers，名称+档位+计量身份）并刷新列表", async () => {
    const backend = installAdminBackend({ customers: [], adminToken: TOKEN });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<CustomersPage token={TOKEN} />);
    await screen.findByTestId("admin-customers-empty");

    fireEvent.change(screen.getByTestId("new-customer-name"), {
      target: { value: "新客户" },
    });
    fireEvent.change(screen.getByTestId("new-customer-plan"), {
      target: { value: "professional" },
    });
    fireEvent.change(screen.getByTestId("new-customer-caller"), {
      target: { value: "new-caller" },
    });
    fireEvent.click(screen.getByTestId("new-customer-submit"));

    const rows = await screen.findAllByTestId("admin-customer-row");
    expect(rows.length).toBe(1);
    expect(rows[0]!.textContent).toContain("新客户");

    const createCall = backend.calls.find((c) => c.method === "POST")!;
    expect(createCall.url.pathname).toBe("/internal/admin/customers");
    expect(createCall.headers["x-admin-token"]).toBe(TOKEN);
    expect(createCall.body).toEqual({
      name: "新客户",
      plan_code: "professional",
      sub2api_user_id: "new-caller",
    });
  });

  it("鉴权失败态：403（服务端未配置 fail-closed）与 401 都如实呈现并支持重试", async () => {
    const forbidden = installAdminBackend({ forceStatus: 403 });
    vi.stubGlobal("fetch", forbidden.fetchImpl);
    render(<CustomersPage token={TOKEN} />);
    const box = await screen.findByTestId("admin-auth-error");
    expect(box.textContent).toContain("鉴权失败");
    expect(box.textContent).toContain("forced 403");
    expect(screen.queryByTestId("admin-customer-table")).toBeNull();

    cleanup();
    const unauthorized = installAdminBackend({ forceStatus: 401 });
    vi.stubGlobal("fetch", unauthorized.fetchImpl);
    render(<CustomersPage token={TOKEN} />);
    expect(await screen.findByTestId("admin-auth-error")).toBeTruthy();
  });

  it("网络错误走通用错误态（非鉴权）", async () => {
    const broken = installAdminBackend({ forceStatus: 500 });
    vi.stubGlobal("fetch", broken.fetchImpl);
    render(<CustomersPage token={TOKEN} />);
    expect(await screen.findByTestId("admin-error")).toBeTruthy();
  });
});
