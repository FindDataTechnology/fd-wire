// AI 助手浮层测试（wire-assistant-panel）：开合与 Esc、档位分轨、问答轨调用
// 形状、失败保留输入、壹座深链不内嵌。
//
// 网络一律 stub：这里验的是交互契约，不碰真后端。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "../../i18n";
import i18n from "../../i18n";
import { seedConsoleSession } from "../testing";
import { AssistantPanel } from "./AssistantPanel";

interface Recorded {
  url: string;
  method: string;
  body: unknown;
}

function installBackend(answerText = "「我的数据」页可以上传表格。"): {
  calls: Recorded[];
  fetchImpl: typeof fetch;
} {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });
    if (url.includes("/v1/ai/answer")) {
      return new Response(
        JSON.stringify({
          conversation_id: 42,
          messages: [
            { id: 1, conversation_id: 42, role: "user", content: body.content, created_at: "2026-10-20T00:00:00" },
            { id: 2, conversation_id: 42, role: "assistant", content: answerText, created_at: "2026-10-20T00:00:01" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/v1/ai/conversations")) {
      return new Response(JSON.stringify({ id: 42, customer_id: "c", title: "新对话", created_at: "2026-10-20T00:00:00", messages: [] }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

beforeEach(() => {
  i18n.changeLanguage("zh");
  // 会话注入：api.ts 的 bearerHeaders 在无会话时直接抛 401（真实行为），
  // 测试必须先有登录态才能走到网络层。
  sessionStorage.clear();
  seedConsoleSession({ sub: "demo-customer", planCode: "basic" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("AssistantPanel（开合）", () => {
  it("初始收起：入口可见、面板隐藏", () => {
    vi.stubGlobal("fetch", installBackend().fetchImpl);
    render(<AssistantPanel tab="datasets" planCode="basic" />);

    expect(screen.getByTestId("assistant-launcher")).toBeTruthy();
    expect(screen.getByTestId("assistant-panel").getAttribute("data-open")).toBe(
      "off",
    );
  });

  it("点击入口展开面板", () => {
    vi.stubGlobal("fetch", installBackend().fetchImpl);
    render(<AssistantPanel tab="datasets" planCode="basic" />);

    fireEvent.click(screen.getByTestId("assistant-launcher"));
    expect(screen.getByTestId("assistant-panel").getAttribute("data-open")).toBe(
      "on",
    );
  });

  it("Esc 收起，且已输入草稿保留", async () => {
    vi.stubGlobal("fetch", installBackend().fetchImpl);
    render(<AssistantPanel tab="datasets" planCode="basic" />);

    fireEvent.click(screen.getByTestId("assistant-launcher"));
    const input = screen.getByTestId("assistant-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "还没发出去的话" } });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("assistant-panel").getAttribute("data-open")).toBe(
      "off",
    );

    // 再展开：草稿仍在（外壳常驻挂载、只切可见性）
    fireEvent.click(screen.getByTestId("assistant-launcher"));
    expect(
      (screen.getByTestId("assistant-input") as HTMLTextAreaElement).value,
    ).toBe("还没发出去的话");
  });
});

describe("AssistantPanel（档位分轨）", () => {
  it("免费档：标出问答模式，无构建入口", () => {
    vi.stubGlobal("fetch", installBackend().fetchImpl);
    render(<AssistantPanel tab="datasets" planCode="free" />);
    fireEvent.click(screen.getByTestId("assistant-launcher"));

    expect(screen.getByTestId("assistant-free-badge")).toBeTruthy();
    expect(screen.queryByTestId("assistant-mode-switch")).toBeNull();
    expect(screen.queryByTestId("assistant-mode-build")).toBeNull();
  });

  it("付费档：有问/做切换", () => {
    vi.stubGlobal("fetch", installBackend().fetchImpl);
    render(<AssistantPanel tab="datasets" planCode="basic" />);
    fireEvent.click(screen.getByTestId("assistant-launcher"));

    expect(screen.getByTestId("assistant-mode-switch")).toBeTruthy();
    expect(screen.queryByTestId("assistant-free-badge")).toBeNull();
  });
});

describe("AssistantPanel（问答）", () => {
  it("免费档提问走问答轨，并带当前页签上下文", async () => {
    const backend = installBackend("「我的数据」页可以上传表格。");
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<AssistantPanel tab="datasets" planCode="free" />);
    fireEvent.click(screen.getByTestId("assistant-launcher"));

    fireEvent.change(screen.getByTestId("assistant-input"), {
      target: { value: "这页能干嘛" },
    });
    fireEvent.click(screen.getByTestId("assistant-send"));

    await waitFor(() => {
      expect(
        screen.getByTestId("assistant-entry-assistant").textContent,
      ).toContain("可以上传表格");
    });

    const answerCall = backend.calls.find((call) =>
      call.url.includes("/v1/ai/answer"),
    );
    expect(answerCall).toBeDefined();
    expect((answerCall?.body as { context: { tab: string } }).context.tab).toBe(
      "datasets",
    );
  });

  it("失败如实展示且保留输入以便重试", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ detail: "AI 服务调用失败，本轮问答未产生回复。" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);
    render(<AssistantPanel tab="datasets" planCode="free" />);
    fireEvent.click(screen.getByTestId("assistant-launcher"));

    fireEvent.change(screen.getByTestId("assistant-input"), {
      target: { value: "这页能干嘛" },
    });
    fireEvent.click(screen.getByTestId("assistant-send"));

    await waitFor(() => {
      expect(screen.getByTestId("assistant-error")).toBeTruthy();
    });
    // 输入被回填，客户可改后重发
    expect(
      (screen.getByTestId("assistant-input") as HTMLTextAreaElement).value,
    ).toBe("这页能干嘛");
  });
});

describe("AssistantPanel（壹座深链）", () => {
  it("新窗口打开且不内嵌 iframe", () => {
    vi.stubGlobal("fetch", installBackend().fetchImpl);
    const { container } = render(
      <AssistantPanel tab="datasets" planCode="basic" />,
    );
    fireEvent.click(screen.getByTestId("assistant-launcher"));

    const link = screen.getByTestId("assistant-base-link");
    expect(link.getAttribute("href")).toBe("https://platform.finddatatech.cloud");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(container.querySelector("iframe")).toBeNull();
  });
});
