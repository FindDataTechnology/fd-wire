// 控制台容器/布局测试（wire-platform-v1 任务 5.5）：
// 侧栏四 tab 导航、顶栏企业标识占位与 X-Customer-Id 可编辑（默认
// demo-customer、注明仅开发用）、登录占位、占位 tab 文案、
// 客户标识变更后随新身份发请求。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { ConsoleView } from "./ConsoleView";
import { CUSTOMER_ID_STORAGE_KEY } from "../console/customer";
import { installConsoleBackend } from "../console/testing";
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
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.location.hash = "";
});

describe("ConsoleView（控制台布局）", () => {
  it("默认 chat tab：侧栏导航 + 顶栏企业标识占位 + 登录占位 + 会话列表", async () => {
    vi.stubGlobal("fetch", installConsoleBackend(CONVERSATIONS).fetchImpl);
    render(<ConsoleView />);

    // 侧栏四项与路由目标
    expect(screen.getByTestId("console-nav-chat").getAttribute("href")).toBe(
      "#/console/chat",
    );
    expect(
      screen.getByTestId("console-nav-artifacts").getAttribute("href"),
    ).toBe("#/console/artifacts");
    expect(screen.getByTestId("console-nav-demands").getAttribute("href")).toBe(
      "#/console/demands",
    );
    expect(screen.getByTestId("console-nav-usage").getAttribute("href")).toBe(
      "#/console/usage",
    );

    // 顶栏：默认 demo-customer、开发占位注明、登录占位
    expect(
      (screen.getByTestId("customer-id-input") as HTMLInputElement).value,
    ).toBe("demo-customer");
    expect(screen.getByTestId("console-topbar").textContent).toContain(
      "仅开发用",
    );
    expect(screen.getByTestId("console-login-placeholder").textContent).toContain(
      "登录",
    );

    // 默认页为 AI 对话构建：新建引导 + 会话列表
    expect(await screen.findByTestId("chat-start")).toBeTruthy();
    expect(await screen.findAllByTestId("conversation-item")).toHaveLength(1);
  });

  it("X-Customer-Id 可编辑：保存后 localStorage 更新且后续请求携带新身份", async () => {
    const backend = installConsoleBackend(CONVERSATIONS);
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<ConsoleView />);
    await screen.findAllByTestId("conversation-item");

    fireEvent.change(screen.getByTestId("customer-id-input"), {
      target: { value: "cust-042" },
    });
    fireEvent.click(screen.getByTestId("customer-id-save"));

    expect(localStorage.getItem(CUSTOMER_ID_STORAGE_KEY)).toBe("cust-042");
    expect(screen.getByTestId("console-org").textContent).toBe("cust-042");
    // 重挂载后的会话列表请求携带新身份头
    await waitFor(() =>
      expect(
        backend.calls.some(
          (c) => c.headers["x-customer-id"] === "cust-042",
        ),
      ).toBe(true),
    );
  });

  it("demands / usage 占位 tab 如实标注建设中", () => {
    vi.stubGlobal("fetch", installConsoleBackend([]).fetchImpl);
    const { rerender } = render(<ConsoleView tab="demands" />);
    expect(screen.getByTestId("console-placeholder").textContent).toContain(
      "需求单管理建设中",
    );
    rerender(<ConsoleView tab="usage" />);
    expect(screen.getByTestId("console-placeholder").textContent).toContain(
      "用量视图建设中",
    );
    // artifacts tab 渲染产物页（空态可见）
    rerender(<ConsoleView tab="artifacts" />);
    expect(screen.getByTestId("artifacts-draft-note")).toBeTruthy();
  });
});
