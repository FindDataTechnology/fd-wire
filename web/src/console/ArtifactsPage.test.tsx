// 产物页组件测试（wire-artifacts-persistence）：
// 列表接 GET /api/v1/artifacts（kind/状态徽标、版本号、来源会话指针、直接创建）、
// kind/status 筛选、spec 编辑保存走 PUT（新版本号提示、非法 JSON 拒存、本地
// 未保存缓冲与丢弃、归档只读）、发布/归档/恢复状态迁移四态、版本历史抽屉
// （列历史 + 查看任一版本 + 可复制）、空态。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const V1_DASH = {
  title: "宏观仪表盘",
  spec: { indicators: ["CN_CPI_YOY", "CN_PMI"], layout: "2x2" },
};
const ALERT_V1 = {
  title: "煤价周环比 >5% 告警",
  spec: { indicator: "CN_COAL_PRICE", threshold: 0.05 },
};
const ALERT_V2 = {
  title: "煤价周环比 >5% 告警（放宽到 8%）",
  spec: { indicator: "CN_COAL_PRICE", threshold: 0.08 },
};

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
  backend.addLifecycleArtifact({
    id: 11,
    kind: "dashboard",
    title: "宏观仪表盘",
    status: "draft",
    version: 1,
    origin_conversation_id: 1,
    spec: V1_DASH,
    created_at: "2026-10-09T09:00:00",
    updated_at: "2026-10-10T09:00:00",
  });
  backend.addLifecycleArtifact({
    id: 12,
    kind: "alert_rule",
    title: "煤价周环比 >5% 告警（放宽到 8%）",
    status: "published",
    version: 2,
    origin_conversation_id: 2,
    versions: [{ spec: ALERT_V1 }, { spec: ALERT_V2 }],
    created_at: "2026-10-09T10:00:00",
    updated_at: "2026-10-10T10:00:00",
  });
  backend.addLifecycleArtifact({
    id: 13,
    kind: "refresh_schedule",
    title: "每日 08:00 刷新",
    status: "archived",
    version: 1,
    origin_conversation_id: null,
    spec: { title: "每日 08:00 刷新", spec: { cron: "0 8 * * *", timezone: "Asia/Shanghai" } },
    created_at: "2026-10-09T11:00:00",
    updated_at: "2026-10-10T11:00:00",
  });
  vi.stubGlobal("fetch", backend.fetchImpl);
  return backend;
}

/** 定位指定产物 id 的列表行。 */
function rowOf(id: number): HTMLElement {
  return screen
    .getAllByTestId("artifact-item")
    .find((el) => el.getAttribute("data-artifact-id") === String(id))!;
}

/** 打开指定产物 id 的 spec 编辑器。 */
function openViewer(id: number): void {
  fireEvent.click(within(rowOf(id)).getByTestId("artifact-view"));
}

describe("ArtifactsPage（产物列表：持久化 + 版本 + 状态机）", () => {
  it("三产物渲染：kind/状态徽标、版本号、来源会话指针、直接创建标注", async () => {
    install();
    render(<ArtifactsPage />);

    const items = await screen.findAllByTestId("artifact-item");
    expect(items.length).toBe(3);

    const kindBadges = screen
      .getAllByTestId("artifact-kind-badge")
      .map((el) => el.getAttribute("data-kind"));
    expect(kindBadges.sort()).toEqual(["alert_rule", "dashboard", "refresh_schedule"]);
    // 徽标文案走 i18n（中文名）
    expect(
      screen.getAllByTestId("artifact-kind-badge").map((el) => el.textContent),
    ).toEqual(expect.arrayContaining(["仪表盘", "告警", "定时刷新"]));

    // 状态徽标语义分级：draft/published/archived 三态各一
    const statusBadges = screen
      .getAllByTestId("artifact-status-badge")
      .map((el) => el.getAttribute("data-status"));
    expect(statusBadges.sort()).toEqual(["archived", "draft", "published"]);
    expect(
      screen.getAllByTestId("artifact-status-badge").map((el) => el.textContent),
    ).toEqual(expect.arrayContaining(["草稿", "已发布", "已归档"]));

    // 版本号：published 产物已到 v2，其余 v1
    expect(
      within(rowOf(11)).getByTestId("artifact-version").textContent,
    ).toBe("v1");
    expect(
      within(rowOf(12)).getByTestId("artifact-version").textContent,
    ).toBe("v2");

    // 来源会话指针回跳 chat?c=；直接创建的产物如实标注
    const links = screen
      .getAllByTestId("artifact-source-link")
      .map((el) => el.getAttribute("href"));
    expect(links).toEqual(
      expect.arrayContaining(["#/console/chat?c=1", "#/console/chat?c=2"]),
    );
    expect(
      within(rowOf(13)).getByTestId("artifact-source-none").textContent,
    ).toContain("直接创建");
  });

  it("kind 与 status 筛选收窄列表", async () => {
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

    fireEvent.change(screen.getByTestId("artifact-kind-filter"), {
      target: { value: "all" },
    });
    fireEvent.change(screen.getByTestId("artifact-status-filter"), {
      target: { value: "archived" },
    });
    expect(screen.getAllByTestId("artifact-item").length).toBe(1);
    expect(
      screen.getByTestId("artifact-status-badge").getAttribute("data-status"),
    ).toBe("archived");
  });

  it("spec 编辑保存走 PUT：非法 JSON 拒存；合法保存提示新版本号并清缓冲", async () => {
    const backend = install();
    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");

    openViewer(11);
    const editor = (await screen.findByTestId("spec-editor")) as HTMLTextAreaElement;
    expect(editor.value).toContain('"CN_CPI_YOY"');

    // 非法 JSON：拒绝保存并提示，不发 PUT
    fireEvent.change(editor, { target: { value: "{not json" } });
    fireEvent.click(screen.getByTestId("spec-save-server"));
    expect(screen.getByTestId("spec-invalid-json").textContent).toContain(
      "不是合法 JSON",
    );
    expect(
      backend.calls.filter((c) => c.method === "PUT"),
    ).toHaveLength(0);

    // 合法 JSON：PUT 保存 → 服务端追加 v2，提示新版本号
    const nextSpec = {
      title: "宏观仪表盘（修订）",
      spec: { indicators: ["CN_PMI"], layout: "2x2" },
    };
    fireEvent.change(editor, { target: { value: JSON.stringify(nextSpec) } });
    fireEvent.click(screen.getByTestId("spec-save-server"));
    expect(
      (await screen.findByTestId("spec-saved-version")).textContent,
    ).toContain("v2");
    // 请求体即完整 spec（最小校验口径：title + spec 对象）
    const put = backend.calls.find((c) => c.method === "PUT");
    expect(put?.url.pathname).toBe("/api/v1/artifacts/11");
    expect(put?.body).toEqual({ spec: nextSpec });
    // 列表行版本号同步为 v2；本地缓冲已清
    expect(within(rowOf(11)).getByTestId("artifact-version").textContent).toBe("v2");
    expect(localStorage.getItem("wire-web-artifact-buffer-11")).toBeNull();
    // 编辑器回到服务端返回的 spec
    expect(
      ((await screen.findByTestId("spec-editor")) as HTMLTextAreaElement).value,
    ).toContain("CN_PMI");
  });

  it("本地缓冲：编辑自动暂存 localStorage（离开提示缓冲），丢弃后回到服务端 spec", async () => {
    install();
    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");

    openViewer(11);
    const editor = (await screen.findByTestId("spec-editor")) as HTMLTextAreaElement;
    fireEvent.change(editor, {
      target: { value: '{"title":"本地改过的仪表盘","spec":{"x":1}}' },
    });
    expect(localStorage.getItem("wire-web-artifact-buffer-11")).toContain(
      "本地改过的仪表盘",
    );
    expect(screen.getByTestId("spec-buffer-badge").textContent).toContain(
      "本地未保存编辑",
    );

    // 重新打开查看器：缓冲自动加载并带徽标（未保存离开提示的兜底）
    fireEvent.click(within(rowOf(11)).getByTestId("artifact-view"));
    openViewer(11);
    const reopened = (await screen.findByTestId("spec-editor")) as HTMLTextAreaElement;
    expect(reopened.value).toContain("本地改过的仪表盘");
    expect(screen.getByTestId("spec-buffer-badge").textContent).toContain(
      "本地未保存编辑",
    );

    // 丢弃本地编辑：清缓冲并回到服务端 spec
    fireEvent.click(screen.getByTestId("spec-discard-buffer"));
    expect(localStorage.getItem("wire-web-artifact-buffer-11")).toBeNull();
    expect(
      (screen.getByTestId("spec-editor") as HTMLTextAreaElement).value,
    ).toContain("CN_CPI_YOY");
    expect(screen.queryByTestId("spec-buffer-badge")).toBeNull();
  });

  it("归档产物 spec 只读：无保存按钮，提示先恢复", async () => {
    install();
    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");

    openViewer(13);
    const editor = (await screen.findByTestId("spec-editor")) as HTMLTextAreaElement;
    expect((editor as HTMLTextAreaElement & { readOnly: boolean }).readOnly).toBe(true);
    expect(screen.queryByTestId("spec-save-server")).toBeNull();
    expect(screen.getByTestId("artifact-viewer").textContent).toContain("已归档");
    expect(screen.getByTestId("artifact-viewer").textContent).toContain("恢复");
  });

  it("状态迁移四态：草稿发布 → 归档 → 恢复回草稿；按钮随态收窄", async () => {
    install();
    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");

    const row = rowOf(11);
    expect(within(row).getByTestId("artifact-publish")).toBeTruthy();
    expect(within(row).getByTestId("artifact-archive")).toBeTruthy();
    expect(within(row).queryByTestId("artifact-restore")).toBeNull();

    // 发布：draft → published
    fireEvent.click(within(row).getByTestId("artifact-publish"));
    await waitFor(() => {
      expect(
        within(rowOf(11)).getByTestId("artifact-status-badge").getAttribute("data-status"),
      ).toBe("published");
    });
    const badge = within(rowOf(11)).getByTestId("artifact-status-badge");
    expect(badge.textContent).toContain("已发布");
    // published 态：发布按钮退位，归档仍在
    expect(within(rowOf(11)).queryByTestId("artifact-publish")).toBeNull();
    expect(within(rowOf(11)).getByTestId("artifact-archive")).toBeTruthy();

    // 归档：published → archived
    fireEvent.click(within(rowOf(11)).getByTestId("artifact-archive"));
    await waitFor(() => {
      expect(
        within(rowOf(11)).getByTestId("artifact-status-badge").getAttribute("data-status"),
      ).toBe("archived");
    });
    // archived 态：只剩恢复
    expect(within(rowOf(11)).queryByTestId("artifact-archive")).toBeNull();
    expect(within(rowOf(11)).getByTestId("artifact-restore")).toBeTruthy();

    // 恢复：archived → draft
    fireEvent.click(within(rowOf(11)).getByTestId("artifact-restore"));
    await waitFor(() => {
      expect(
        within(rowOf(11)).getByTestId("artifact-status-badge").getAttribute("data-status"),
      ).toBe("draft");
    });
    expect(within(rowOf(11)).getByTestId("artifact-publish")).toBeTruthy();
  });

  it("版本历史抽屉：列历史（新在前）、查看任一版本 spec、可复制", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    install();
    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");

    fireEvent.click(within(rowOf(12)).getByTestId("artifact-history"));
    expect(await screen.findByTestId("version-drawer")).toBeTruthy();
    const entries = (await screen.findAllByTestId("version-item")).map((el) =>
      el.getAttribute("data-version"),
    );
    expect(entries).toEqual(["2", "1"]); // 新版本在前

    // 查看任一历史版本：v1 spec 快照如实呈现
    fireEvent.click(
      screen.getAllByTestId("version-item").find((el) => el.getAttribute("data-version") === "1")!,
    );
    const specText = (await screen.findByTestId("version-spec")).textContent ?? "";
    expect(specText).toContain("0.05");
    expect(specText).toContain("煤价周环比 >5% 告警");

    // 复制：整份 spec JSON 进剪贴板
    fireEvent.click(screen.getByTestId("version-copy"));
    expect(await screen.findByTestId("version-copied")).toBeTruthy();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0]?.[0])).toContain("CN_COAL_PRICE");

    // 关闭抽屉
    fireEvent.click(screen.getByTestId("version-drawer-close"));
    expect(screen.queryByTestId("version-drawer")).toBeNull();
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
