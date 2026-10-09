// 产物草稿页组件测试（wire-platform-v1 任务 5.5）：
// 五类产物 kind 徽标、spec 摘要、来源会话链接、kind 筛选、
// spec 查看器（可编辑 textarea 保存 localStorage / 恢复原始）、空态。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { ArtifactsPage } from "./ArtifactsPage";
import { installConsoleBackend, seedConsoleSession } from "./testing";
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

/** 打开指定 kind 产物的 spec 查看器（列表按 id 倒序，靠 kind 定位行）。 */
function openViewerForKind(kind: string): void {
  const item = screen
    .getAllByTestId("artifact-item")
    .find(
      (el) =>
        within(el)
          .getByTestId("artifact-kind-badge")
          .getAttribute("data-kind") === kind,
    );
  fireEvent.click(within(item!).getByTestId("artifact-view"));
}

beforeEach(() => {
  i18n.changeLanguage("zh");
  localStorage.clear();
  sessionStorage.clear();
  // 登录会话种子：假后端以 Bearer 的 sub 为客户身份（demo-customer）。
  seedConsoleSession({ sub: "demo-customer" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

function install() {
  const backend = installConsoleBackend(CONVERSATIONS);
  backend.addArtifact({
    id: 11,
    conversation_id: 1,
    kind: "dashboard",
    spec: {
      title: "宏观仪表盘",
      spec: { indicators: ["CN_CPI_YOY", "CN_PMI"], layout: "2x2" },
    },
    created_at: "2026-10-04T09:10:00",
  });
  backend.addArtifact({
    id: 12,
    conversation_id: 2,
    kind: "alert_rule",
    spec: {
      title: "煤价周环比 >5% 告警",
      spec: { indicator: "CN_COAL_PRICE", threshold: 0.05 },
    },
    created_at: "2026-10-04T09:20:00",
  });
  backend.addArtifact({
    id: 13,
    conversation_id: 1,
    kind: "refresh_schedule",
    spec: {
      title: "每日 08:00 刷新",
      spec: { cron: "0 8 * * *", timezone: "Asia/Shanghai" },
    },
    created_at: "2026-10-04T09:30:00",
  });
  vi.stubGlobal("fetch", backend.fetchImpl);
  return backend;
}

describe("ArtifactsPage（产物草稿列表）", () => {
  it("三类产物渲染：kind 徽标语义分级、spec 摘要、来源会话链接、草稿标注", async () => {
    install();
    render(<ArtifactsPage />);

    const items = await screen.findAllByTestId("artifact-item");
    expect(items.length).toBe(3);

    const badges = screen
      .getAllByTestId("artifact-kind-badge")
      .map((el) => el.getAttribute("data-kind"));
    expect(badges.sort()).toEqual(["alert_rule", "dashboard", "refresh_schedule"]);
    // 徽标文案走 i18n（中文名）
    expect(
      screen.getAllByTestId("artifact-kind-badge").map((el) => el.textContent),
    ).toEqual(expect.arrayContaining(["仪表盘", "告警", "定时刷新"]));
    // 草稿标注与说明
    expect(screen.getAllByTestId("artifact-draft-badge").length).toBe(3);
    expect(screen.getByTestId("artifacts-draft-note").textContent).toContain(
      "物化上线中",
    );
    // 标题与 spec 摘要（标题经 artifact-title 定位，避免与会话同名混淆）
    expect(
      screen.getAllByTestId("artifact-title").map((el) => el.textContent),
    ).toEqual(
      expect.arrayContaining(["宏观仪表盘", "煤价周环比 >5% 告警", "每日 08:00 刷新"]),
    );
    expect(
      screen.getAllByTestId("artifact-spec-summary").some((el) =>
        el.textContent?.includes("CN_CPI_YOY"),
      ),
    ).toBe(true);
    // 来源会话链接回跳 chat?c=
    const links = screen
      .getAllByTestId("artifact-source-link")
      .map((el) => el.getAttribute("href"));
    expect(links).toEqual(
      expect.arrayContaining(["#/console/chat?c=1", "#/console/chat?c=2"]),
    );
  });

  it("kind 筛选收窄列表", async () => {
    install();
    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");
    expect(screen.getAllByTestId("artifact-item").length).toBe(3);

    fireEvent.change(screen.getByTestId("artifact-kind-filter"), {
      target: { value: "dashboard" },
    });
    expect(screen.getAllByTestId("artifact-item").length).toBe(1);
    expect(
      screen.getByTestId("artifact-kind-badge").getAttribute("data-kind"),
    ).toBe("dashboard");
  });

  it("spec 查看器：格式化 JSON 展示，编辑保存 localStorage，恢复原始", async () => {
    install();
    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");

    openViewerForKind("dashboard");
    const editor = screen.getByTestId("spec-editor") as HTMLTextAreaElement;
    expect(editor.value).toContain('"CN_CPI_YOY"');
    expect(editor.value).toContain('"title": "宏观仪表盘"');
    // 如实标注：仅本地保存
    expect(screen.getByTestId("artifact-viewer").textContent).toContain(
      "编辑仅保存到本地浏览器",
    );

    // 非法 JSON：拒绝保存并提示
    fireEvent.change(editor, { target: { value: "{not json" } });
    fireEvent.click(screen.getByTestId("spec-save-local"));
    expect(screen.getByTestId("spec-invalid-json").textContent).toContain(
      "不是合法 JSON",
    );
    expect(localStorage.getItem("wire-web-artifact-spec-11")).toBeNull();

    // 合法 JSON：保存到 localStorage
    fireEvent.change(editor, {
      target: { value: '{"title":"宏观仪表盘","spec":{"indicators":["CN_PMI"]}}' },
    });
    fireEvent.click(screen.getByTestId("spec-save-local"));
    expect(screen.getByTestId("spec-saved-hint").textContent).toContain(
      "已保存到本地浏览器",
    );
    expect(localStorage.getItem("wire-web-artifact-spec-11")).toContain(
      "CN_PMI",
    );

    // 恢复原始：清除本地草稿并回到服务端 spec
    fireEvent.click(screen.getByTestId("spec-restore-original"));
    expect(localStorage.getItem("wire-web-artifact-spec-11")).toBeNull();
    expect((screen.getByTestId("spec-editor") as HTMLTextAreaElement).value).toContain(
      "CN_CPI_YOY",
    );
  });

  it("本地草稿重新打开查看器时加载 localStorage 中的版本", async () => {
    localStorage.setItem(
      "wire-web-artifact-spec-11",
      '{"title":"本地改过的仪表盘","spec":{}}',
    );
    install();
    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");
    openViewerForKind("dashboard");
    expect(
      (screen.getByTestId("spec-editor") as HTMLTextAreaElement).value,
    ).toContain("本地改过的仪表盘");
    expect(screen.getByTestId("local-draft-badge").textContent).toContain(
      "本地草稿",
    );
  });

  it("无产物显示空态", async () => {
    vi.stubGlobal(
      "fetch",
      installConsoleBackend(CONVERSATIONS).fetchImpl,
    );
    render(<ArtifactsPage />);
    expect(await screen.findByTestId("artifacts-empty")).toBeTruthy();
  });
});
