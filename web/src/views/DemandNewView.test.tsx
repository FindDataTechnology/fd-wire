// 需求单提交表单测试（wire-ux-consolidation 任务 4.1/4.2，自占位转正）：
// - 空必填逐字段提示（不发请求）；
// - 锚点预填：描述区以「指标 {code}：」开头、客户可编辑、indicator_code 入参；
// - 提交走 POST /api/v1/demands 四入参 + Bearer；成功确认态（1 个工作日承诺
//   + 返回目录/查看我的需求）；
// - 未登录（无会话）提交 → 401 如实回显并引导登录。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { DemandNewView } from "./DemandNewView";
import { installConsoleBackend, seedConsoleSession } from "../console/testing";

beforeEach(() => {
  i18n.changeLanguage("zh");
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

function fillForm(opts: { description?: string; email?: string; company?: string } = {}) {
  fireEvent.change(screen.getByTestId("demand-description"), {
    target: { value: opts.description ?? "需要煤炭日度价格指标" },
  });
  fireEvent.change(screen.getByTestId("demand-email"), {
    target: { value: opts.email ?? "buyer@acme.com" },
  });
  if (opts.company !== undefined) {
    fireEvent.change(screen.getByTestId("demand-company"), {
      target: { value: opts.company },
    });
  }
}

describe("DemandNewView（需求单提交表单）", () => {
  it("空必填逐字段提示：不发请求，两个错误各自可见", async () => {
    const backend = installConsoleBackend([]);
    vi.stubGlobal("fetch", backend.fetchImpl);
    seedConsoleSession();
    render(<DemandNewView indicator={null} />);

    fireEvent.click(screen.getByTestId("demand-submit"));
    expect(await screen.findByTestId("demand-description-error")).toBeTruthy();
    expect(screen.getByTestId("demand-email-error")).toBeTruthy();
    // 校验失败不发任何请求
    expect(backend.calls.length).toBe(0);
  });

  it("邮箱格式校验：非空但形态不合法仍拒绝", async () => {
    const backend = installConsoleBackend([]);
    vi.stubGlobal("fetch", backend.fetchImpl);
    seedConsoleSession();
    render(<DemandNewView indicator={null} />);

    fillForm({ email: "not-an-email" });
    fireEvent.click(screen.getByTestId("demand-submit"));
    expect(await screen.findByTestId("demand-email-error")).toBeTruthy();
    expect(backend.calls.length).toBe(0);
  });

  it("提交走真实端点：四入参形状 + Bearer，成功确认态含 1 个工作日承诺与两入口", async () => {
    const backend = installConsoleBackend([]);
    vi.stubGlobal("fetch", backend.fetchImpl);
    const session = seedConsoleSession();
    render(<DemandNewView indicator="CN_COAL" />);

    // 锚点预填在描述区开头（任务 4.2），客户在预填后继续补充
    const textarea = screen.getByTestId("demand-description") as HTMLTextAreaElement;
    expect(textarea.value).toBe("指标 CN_COAL：");
    expect(screen.getByTestId("demand-prefilled-code").textContent).toBe("CN_COAL");

    fireEvent.change(textarea, {
      target: { value: `${textarea.value}需要煤炭日度价格指标` },
    });
    fireEvent.change(screen.getByTestId("demand-email"), {
      target: { value: "buyer@acme.com" },
    });
    fireEvent.change(screen.getByTestId("demand-company"), {
      target: { value: "上海壹座" },
    });
    fireEvent.click(screen.getByTestId("demand-submit"));

    const success = await screen.findByTestId("demand-success");
    expect(success.textContent).toContain("已收到你的需求单");
    expect(success.textContent).toContain("1 个工作日");
    expect(
      screen.getByTestId("demand-success-view-mine").getAttribute("href"),
    ).toBe("#/console/demands");

    const call = backend.calls.find((c) => c.method === "POST")!;
    expect(call.url.pathname).toBe("/api/v1/demands");
    expect(call.headers["authorization"]).toBe(`Bearer ${session.idToken}`);
    expect(call.body).toEqual({
      description: "指标 CN_COAL：需要煤炭日度价格指标",
      contact_email: "buyer@acme.com",
      company: "上海壹座",
      indicator_code: "CN_COAL",
    });
  });

  it("无锚点入口（定价页）：不带 indicator_code 入参，描述区不预填", async () => {
    const backend = installConsoleBackend([]);
    vi.stubGlobal("fetch", backend.fetchImpl);
    seedConsoleSession();
    render(<DemandNewView indicator={null} />);

    expect(screen.queryByTestId("demand-prefilled-code")).toBeNull();
    fillForm();
    fireEvent.click(screen.getByTestId("demand-submit"));
    await screen.findByTestId("demand-success");

    const call = backend.calls.find((c) => c.method === "POST")!;
    expect(call.body).toEqual({
      description: "需要煤炭日度价格指标",
      contact_email: "buyer@acme.com",
    });
  });

  it("未登录提交：401 如实回显并引导登录（不静默假登录）", async () => {
    const backend = installConsoleBackend([]);
    vi.stubGlobal("fetch", backend.fetchImpl);
    // 不 seed 会话：请求层直接以 401 抛出
    render(<DemandNewView indicator={null} />);

    fillForm();
    fireEvent.click(screen.getByTestId("demand-submit"));

    const gate = await screen.findByTestId("demand-signin-required");
    expect(gate.textContent).toContain("登录");
    expect(screen.queryByTestId("demand-success")).toBeNull();
    expect(screen.getByText("前往登录").getAttribute("href")).toBe("#/login");
  });

  it("服务端 422 校验回显：错误文案如实呈现、可重试", async () => {
    const backend = installConsoleBackend([], { failDemandCreateStatus: 422 });
    vi.stubGlobal("fetch", backend.fetchImpl);
    seedConsoleSession();
    render(<DemandNewView indicator={null} />);

    fillForm();
    fireEvent.click(screen.getByTestId("demand-submit"));

    const error = await screen.findByTestId("demand-submit-error");
    expect(error.textContent).toContain("422");
    await waitFor(() => {
      expect((screen.getByTestId("demand-submit") as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
  });
});
