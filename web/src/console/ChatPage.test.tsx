// AI 对话构建页组件测试（wire-platform-v1 任务 5.5）：
// 消息流三类角色渲染（user/assistant 气泡 + tool_trace 折叠行）、
// 续聊 POST、新建对话 POST、429 每日限额错误态如实呈现。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { ChatPage } from "./ChatPage";
import { installConsoleBackend } from "./testing";
import type { Conversation } from "./api";

const CONVERSATIONS: Conversation[] = [
  {
    id: 1,
    customer_id: "demo-customer",
    title: "宏观仪表盘",
    created_at: "2026-10-04T08:00:00",
  },
  {
    id: 2,
    customer_id: "demo-customer",
    title: "煤价告警",
    created_at: "2026-10-03T08:00:00",
  },
];

beforeEach(() => {
  i18n.changeLanguage("zh");
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("ChatPage（消息流渲染）", () => {
  it("user/assistant 气泡 + tool_trace 折叠行（工具名+入参摘要），展开见完整入参与结果", async () => {
    const backend = installConsoleBackend(CONVERSATIONS);
    backend.addMessage(1, "user", "帮我建一个宏观仪表盘");
    backend.addMessage(
      1,
      "tool_trace",
      JSON.stringify({
        tool_call_id: "call-1",
        tool_name: "dashboard_spec_create",
        arguments: { title: "宏观仪表盘", spec: { indicators: ["CN_CPI_YOY", "CN_PMI"] } },
        result: { ok: true, artifact_id: 7, kind: "dashboard", status: "draft" },
      }),
    );
    backend.addMessage(1, "assistant", "已生成仪表盘草稿，可在产物页查看。");
    vi.stubGlobal("fetch", backend.fetchImpl);

    render(<ChatPage customerId="demo-customer" conversationId={1} />);

    // 三类角色齐全
    expect(await screen.findByText("帮我建一个宏观仪表盘")).toBeTruthy();
    expect(screen.getByText("已生成仪表盘草稿，可在产物页查看。")).toBeTruthy();
    const roles = screen
      .getAllByTestId("message-item")
      .map((el) => el.getAttribute("data-role"));
    expect(roles).toEqual(["user", "assistant"]);

    // tool_trace 折叠行：工具名 + 入参摘要 + 成功标记；默认收起
    const trace = screen.getByTestId("tool-trace");
    expect(trace.textContent).toContain("dashboard_spec_create");
    expect(trace.textContent).toContain("title=宏观仪表盘");
    expect(screen.getByTestId("tool-trace-ok").textContent).toContain("成功");
    expect(screen.queryByTestId("tool-trace-args")).toBeNull();

    // 展开：完整入参与结果 JSON
    fireEvent.click(screen.getByTestId("tool-trace-toggle"));
    expect(screen.getByTestId("tool-trace-args").textContent).toContain(
      "CN_CPI_YOY",
    );
    expect(screen.getByTestId("tool-trace-result").textContent).toContain(
      '"artifact_id": 7',
    );
  });

  it("会话列表渲染 + 点击选中会话链接；未选中显示新建引导", async () => {
    const backend = installConsoleBackend(CONVERSATIONS);
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<ChatPage customerId="demo-customer" conversationId={null} />);

    expect(await screen.findByTestId("chat-start")).toBeTruthy();
    const items = await screen.findAllByTestId("conversation-item");
    expect(items.length).toBe(2);
    expect(
      screen.getByRole("link", { name: /宏观仪表盘/ }).getAttribute("href"),
    ).toBe("#/console/chat?c=1");
  });

  it("续聊：输入发送 → POST .../messages，回复追加进消息流", async () => {
    const backend = installConsoleBackend(CONVERSATIONS);
    backend.addMessage(1, "user", "首轮消息");
    backend.addMessage(1, "assistant", "首轮回复");
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<ChatPage customerId="demo-customer" conversationId={1} />);
    await screen.findByText("首轮回复");

    fireEvent.change(screen.getByTestId("chat-input"), {
      target: { value: "再加一个 PMI 图" },
    });
    fireEvent.click(screen.getByTestId("chat-send"));

    await screen.findByText("收到，已按你的意图处理。");
    const post = backend.calls.find(
      (c) =>
        c.method === "POST" &&
        c.url.pathname === "/api/v1/ai/conversations/1/messages",
    );
    expect(post).toBeTruthy();
    expect(post!.body).toEqual({ content: "再加一个 PMI 图" });
    expect(post!.headers["x-customer-id"]).toBe("demo-customer");
    // 用户消息与回复都出现在流中
    expect(screen.getByText("再加一个 PMI 图")).toBeTruthy();
    // 输入框清空
    expect(screen.getByTestId("chat-input").textContent).toBe("");
  });

  it("新建对话：发送首条消息 → POST /ai/conversations 携带 message，成功后跳转 ?c=<id>", async () => {
    const backend = installConsoleBackend([]);
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<ChatPage customerId="demo-customer" conversationId={null} />);

    fireEvent.change(screen.getByTestId("chat-input"), {
      target: { value: "建一个煤价监控仪表盘" },
    });
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() =>
      expect(
        backend.calls.find(
          (c) =>
            c.method === "POST" && c.url.pathname === "/api/v1/ai/conversations",
        ),
      ).toBeTruthy(),
    );
    const create = backend.calls.find(
      (c) => c.method === "POST" && c.url.pathname === "/api/v1/ai/conversations",
    )!;
    expect(create.body).toEqual({ message: "建一个煤价监控仪表盘" });
    await waitFor(() =>
      expect(window.location.hash).toBe("#/console/chat?c=1"),
    );
  });

  it("429 每日限额：错误态如实呈现（标题+提示+后端 detail），不白屏", async () => {
    const backend = installConsoleBackend([], {
      failCreateStatus: 429,
      failCreateDetail:
        "企业 demo-customer 今日已新开 50 个对话，达到每日上限（AI_DAILY_CONVERSATION_LIMIT=50）。请明日再试或联系平台调整限额。",
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<ChatPage customerId="demo-customer" conversationId={null} />);

    fireEvent.change(screen.getByTestId("chat-input"), {
      target: { value: "再来一个" },
    });
    fireEvent.click(screen.getByTestId("chat-send"));

    const error = await screen.findByTestId("chat-error");
    expect(error.textContent).toContain("已达每日新建对话上限");
    expect(error.textContent).toContain("(429)");
    expect(error.textContent).toContain("请明日再试");
    expect(error.textContent).toContain("AI_DAILY_CONVERSATION_LIMIT=50");
    // 页面其余部分仍在（不白屏）
    expect(screen.getByTestId("chat-start")).toBeTruthy();
  });

  it("消息加载失败显示错误态与重试", async () => {
    vi.stubGlobal(
      "fetch",
      ((_input: RequestInfo | URL) =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ detail: "boom" }),
        })) as unknown as typeof fetch,
    );
    render(<ChatPage customerId="demo-customer" conversationId={1} />);
    expect(await screen.findByTestId("chat-messages-error")).toBeTruthy();
    expect(screen.getByTestId("chat-messages-error").textContent).toContain(
      "消息加载失败",
    );
  });
});
