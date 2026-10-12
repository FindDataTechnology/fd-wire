// AI 构建引导卡测试（wire-ux-consolidation 任务 2.1）：旧对话页退役——
// 两链接（壹座 demo / 直达壹座平台，均新窗口）、卡片无任何测试账号明文、
// 无会话列表/消息窗口/输入框、零网络请求。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { ChatPage } from "./ChatPage";

beforeEach(() => {
  i18n.changeLanguage("zh");
  sessionStorage.clear();
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.location.hash = "";
});

describe("ChatPage（壹座试用引导卡）", () => {
  it("主按钮「去壹座试用」直落壹座平台首页（同 IdP 免中转，新窗口，无次级链接）", () => {
    render(<ChatPage />);

    const demo = screen.getByTestId("chat-guide-demo-cta");
    expect(demo.getAttribute("href")).toBe("https://platform.finddatatech.cloud");
    expect(demo.getAttribute("target")).toBe("_blank");
    expect(demo.getAttribute("rel")).toContain("noopener");
    expect(demo.textContent).toContain("去壹座试用");

    // 同一 IdP 直达后，原「已有壹座账号？直接进入」次级链接已无意义，移除。
    expect(screen.queryByTestId("chat-guide-enter-link")).toBeNull();
  });

  it("卡片不出现任何测试账号的邮箱/口令明文", () => {
    const { container } = render(<ChatPage />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("platform-test");
    expect(text).not.toContain("@");
    expect(text).not.toMatch(/密码|口令|password/i);
  });

  it("旧对话页构件全部退场：无会话列表、无消息窗口、无输入框，且零网络请求", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<ChatPage />);

    expect(screen.getByTestId("chat-guide")).toBeTruthy();
    expect(screen.queryByTestId("conversation-list")).toBeNull();
    expect(screen.queryByTestId("message-list")).toBeNull();
    expect(screen.queryByTestId("chat-input")).toBeNull();
    expect(screen.queryByTestId("chat-send")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("英文文案同为引导卡（AI Build）", () => {
    i18n.changeLanguage("en");
    render(<ChatPage />);
    expect(screen.getByTestId("chat-guide-demo-cta").textContent).toContain(
      "Try it on Base",
    );
  });
});
