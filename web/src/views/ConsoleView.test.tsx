// 控制台容器测试（wire-self-serve-launch 任务 4.4/4.6）：
// 登录配置未下发的阻塞态（不发起任何受保护请求）、匿名登录引导、
// 会话建立（POST /api/console/session）+ key_once 明文一次展示、
// 开户失败（502）如实呈现、顶栏登录态（客户/档位/身份/登出）。
// fetch 一律走 testing.ts 的内存假后端（零网络）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { ConsoleView } from "./ConsoleView";
import {
  installConsoleBackend,
  seedConsoleSession,
  makeIdToken,
} from "../console/testing";
import type { Conversation } from "../console/api";

const CONVERSATIONS: Conversation[] = [
  {
    id: 1,
    customer_id: "demo-customer",
    title: "宏观仪表盘",
    created_at: "2026-10-04T08:00:00",
  },
];

beforeEach(() => {
  i18n.changeLanguage("zh");
  localStorage.clear();
  sessionStorage.clear();
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  window.location.hash = "";
});

describe("ConsoleView（登录引导 / 阻塞态 / 会话建立）", () => {
  it("登录配置未下发（configured=false）→ 阻塞态提示，不发起任何受保护请求", async () => {
    const backend = installConsoleBackend(CONVERSATIONS, {
      authConfig: { configured: false },
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<ConsoleView />);

    expect(await screen.findByTestId("console-blocked")).toBeTruthy();
    expect(screen.getByTestId("console-blocked").textContent).toContain(
      "configured=false",
    );
    // 绝不假登录：无登录跳转按钮、无 /api/v1 会话数据请求。
    expect(screen.queryByTestId("console-signin-button")).toBeNull();
    expect(
      backend.calls.filter((c) => c.url.pathname.startsWith("/api/v1/")),
    ).toEqual([]);
  });

  it("auth/config 端点故障 → 配置错误态可重试", async () => {
    vi.stubGlobal(
      "fetch",
      installConsoleBackend(CONVERSATIONS, { failAuthConfigStatus: 500 }).fetchImpl,
    );
    render(<ConsoleView />);
    expect(await screen.findByTestId("console-config-error")).toBeTruthy();
  });

  it("无会话 → 登录引导（不携带任何 Bearer 请求 /api/v1）", async () => {
    const backend = installConsoleBackend(CONVERSATIONS);
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<ConsoleView />);

    expect(await screen.findByTestId("console-signin")).toBeTruthy();
    const protectedCalls = backend.calls.filter((c) =>
      c.url.pathname.startsWith("/api/v1/"),
    );
    expect(protectedCalls).toEqual([]);
  });

  it("已登录：会话建立（POST /api/console/session 带 id_token）→ 进入默认 chat 页", async () => {
    const backend = installConsoleBackend(CONVERSATIONS, {
      customerName: "上海壹座",
      planCode: "basic",
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    seedConsoleSession({ sub: "demo-customer", planCode: "basic", customerName: "上海壹座" });
    render(<ConsoleView />);

    // 会话建立请求形状：POST body {id_token}
    await waitFor(() => {
      const call = backend.calls.find(
        (c) => c.url.pathname === "/api/console/session",
      );
      expect(call).toBeTruthy();
      expect(call!.method).toBe("POST");
      expect(call!.body).toEqual({ id_token: makeIdToken({ sub: "demo-customer" }) });
    });

    // 进入控制台：顶栏客户/档位 + 会话列表拉取（Bearer 头）
    expect(await screen.findByTestId("console-topbar")).toBeTruthy();
    expect(screen.getByTestId("console-org").textContent).toBe("上海壹座");
    expect(screen.getByTestId("console-plan").textContent).toBe("basic");
    expect(await screen.findAllByTestId("conversation-item")).toHaveLength(1);
    const listCall = backend.calls.find(
      (c) => c.url.pathname === "/api/v1/ai/conversations",
    );
    expect(listCall?.headers["authorization"]).toMatch(/^Bearer /);
    expect(listCall?.headers["x-customer-id"]).toBeUndefined();
  });

  it("首登开户：key_once 明文展示一次（data-testid=console-key-once）", async () => {
    vi.stubGlobal(
      "fetch",
      installConsoleBackend([], { keyOnce: "wgk-test-key-once" }).fetchImpl,
    );
    seedConsoleSession({ sub: "demo-customer" });
    render(<ConsoleView />);

    const banner = await screen.findByTestId("console-key-once");
    expect(banner.textContent).toContain("wgk-test-key-once");
    expect(banner.textContent).toContain("仅展示一次");
  });

  it("开户链路失败（502 failed + reason）→ 如实呈现原因，可重试", async () => {
    const backend = installConsoleBackend(CONVERSATIONS, {
      sessionFailReason: "cell-manager unreachable",
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    seedConsoleSession({ sub: "demo-customer" });
    render(<ConsoleView />);

    expect(await screen.findByTestId("console-session-error")).toBeTruthy();
    expect(
      screen.getByTestId("console-session-error-detail").textContent,
    ).toContain("cell-manager unreachable");
    // 失败态不渲染任何子页数据
    expect(screen.queryByTestId("chat-start")).toBeNull();
  });

  it("顶栏登出：清会话并回首页", async () => {
    vi.stubGlobal("fetch", installConsoleBackend(CONVERSATIONS).fetchImpl);
    seedConsoleSession({ sub: "demo-customer" });
    render(<ConsoleView />);
    await screen.findByTestId("console-topbar");

    fireEvent.click(screen.getByTestId("console-logout"));
    expect(sessionStorage.getItem("wire.console.session")).toBeNull();
    expect(window.location.hash).toBe("#/");
  });
});

describe("ConsoleView（tab 切换）", () => {
  it("demands 占位 tab 如实标注建设中；datasets/usage/正式页随 tab 渲染", async () => {
    vi.stubGlobal("fetch", installConsoleBackend([]).fetchImpl);
    seedConsoleSession({ sub: "demo-customer", planCode: "basic" });
    const { rerender } = render(<ConsoleView tab="demands" />);
    const placeholder = await screen.findByTestId("console-placeholder");
    expect(placeholder.textContent).toContain("需求单管理建设");
    // usage：正式用量页（占位退位）——端点数据渲染
    rerender(<ConsoleView tab="usage" />);
    expect(await screen.findByTestId("usage-page")).toBeTruthy();
    // datasets：付费档正常渲染数据面
    rerender(<ConsoleView tab="datasets" />);
    expect(await screen.findByTestId("upload-section")).toBeTruthy();
    // artifacts tab 渲染产物页（空态可见）
    rerender(<ConsoleView tab="artifacts" />);
    expect(screen.getByTestId("artifacts-draft-note")).toBeTruthy();
  });
});
