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
import type { ConsoleBackendOptions } from "./testing";
import { formatServerDate } from "./util";
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

function install(options: ConsoleBackendOptions = {}) {
  const backend = installConsoleBackend(CONVERSATIONS, options);
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

// ── 分享入口与弹层（wire-dashboard-share 任务 2.2/2.3）──────────────────────
// 端点 POST /api/v1/artifacts/{id}/share 未进通用假后端——本文件内联拦截
// （语义对齐 api：仅 published dashboard 发 {url, expires_at, version}，其余
// 403；可选强制状态注入测失败态）。展示链接须从响应自构：
// origin + /#/share/dashboard/{id}?t=…&v={version}（t 从数据端点 url 解出）。

/** 在 install() 三产物（11 dashboard draft / 12 alert published / 13 refresh
 *  archived）之上补两条：14 dashboard published（唯一合法分享对象）、
 *  15 dashboard archived——覆盖入口分发的全部组合。 */
function installShareRows() {
  const backend = install();
  backend.addLifecycleArtifact({
    id: 14,
    kind: "dashboard",
    title: "已发布看板",
    status: "published",
    version: 2,
    origin_conversation_id: 1,
    spec: V1_DASH,
    created_at: "2026-10-09T12:00:00",
    updated_at: "2026-10-10T12:00:00",
  });
  backend.addLifecycleArtifact({
    id: 15,
    kind: "dashboard",
    title: "已归档看板",
    status: "archived",
    version: 1,
    origin_conversation_id: null,
    spec: V1_DASH,
    created_at: "2026-10-09T13:00:00",
    updated_at: "2026-10-10T13:00:00",
  });
  return backend;
}

function localJson(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  };
}

/** 包装假后端：拦截 share POST（Bearer 断言 + 成功/403/强制态 + body 记录
 *  ——wire-share-ttl-options 的 ttl_days 断言依赖），其余透传。 */
function withShareEndpoint(
  backend: ReturnType<typeof installConsoleBackend>,
  force?: { status: number; detail: string },
): typeof fetch {
  const original = backend.fetchImpl;
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://console.test");
    const match = url.pathname.match(/^\/api\/v1\/artifacts\/(\d+)\/share$/);
    if (match && (init?.method ?? "GET").toUpperCase() === "POST") {
      const id = Number(match[1]);
      const headers: Record<string, string> = {};
      new Headers(init?.headers as HeadersInit | undefined).forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      backend.calls.push({
        method: "POST",
        url,
        headers,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (force) {
        return Promise.resolve(localJson({ detail: force.detail }, force.status));
      }
      // 语义对齐 api：仅已发布仪表盘可分享（本种子集中即 14），其余 403。
      if (id !== 14) {
        return Promise.resolve(
          localJson(
            { detail: `产物 ${id} 不允许生成分享链接（仅已发布仪表盘可分享）` },
            403,
          ),
        );
      }
      return Promise.resolve(
        localJson({
          url: `/api/v1/share/dashboard/14?t=share-token-14&v=2`,
          expires_at: "2026-11-10T08:00:00",
          version: 2,
        }),
      );
    }
    return original(input, init);
  }) as unknown as typeof fetch;
}

describe("ArtifactsPage 分享入口（wire-dashboard-share 2.2/2.3）", () => {
  beforeEach(() => {
    i18n.changeLanguage("zh");
    localStorage.clear();
    sessionStorage.clear();
    seedConsoleSession({ sub: "demo-customer" });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("入口按 kind+status 分发：仅 published dashboard 出「生成分享链接」", async () => {
    const backend = installShareRows();
    vi.stubGlobal("fetch", withShareEndpoint(backend));

    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");

    // 唯一合法对象：14（dashboard × published）
    expect(
      within(rowOf(14)).getByTestId("artifact-share").textContent,
    ).toContain("生成分享链接");
    // draft dashboard（11）/ published 非 dashboard（12）/ archived 非
    // dashboard（13）/ archived dashboard（15）一律无入口
    expect(within(rowOf(11)).queryByTestId("artifact-share")).toBeNull();
    expect(within(rowOf(12)).queryByTestId("artifact-share")).toBeNull();
    expect(within(rowOf(13)).queryByTestId("artifact-share")).toBeNull();
    expect(within(rowOf(15)).queryByTestId("artifact-share")).toBeNull();
  });

  it("弹层：POST share → 展示自构公开页链接（origin+hash 路由+t/v）+ 到期时间 + 复制", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const backend = installShareRows();
    vi.stubGlobal("fetch", withShareEndpoint(backend));

    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");

    fireEvent.click(within(rowOf(14)).getByTestId("artifact-share"));
    expect(await screen.findByTestId("share-dialog")).toBeTruthy();

    // 请求：POST /api/v1/artifacts/14/share，带登录 Bearer
    const post = backend.calls.find(
      (c) =>
        c.method === "POST" &&
        /^\/api\/v1\/artifacts\/14\/share$/.test(c.url.pathname),
    );
    expect(post).toBeTruthy();
    expect(post?.headers["authorization"]).toMatch(/^Bearer /);

    // 展示链接 = origin + #/share/dashboard/14?t=<响应 url 解出的 t>&v=<响应 version>
    const expectedUrl = `${window.location.origin}/#/share/dashboard/14?t=share-token-14&v=2`;
    expect(
      (await screen.findByTestId("share-url") as HTMLInputElement).value,
    ).toBe(expectedUrl);
    // 到期时间如实呈现（同 formatServerDate 口径）
    expect(screen.getByTestId("share-expires").textContent).toContain(
      formatServerDate("2026-11-10T08:00:00"),
    );
    expect(screen.getByTestId("share-expires").textContent).toContain("到期时间");

    // 复制按钮：完整公开页链接进剪贴板
    fireEvent.click(screen.getByTestId("share-copy"));
    expect(await screen.findByTestId("share-copied")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(expectedUrl);

    // 关闭弹层
    fireEvent.click(screen.getByTestId("share-dialog-close"));
    expect(screen.queryByTestId("share-dialog")).toBeNull();
  });

  it("失败态：服务端拒绝（如 503 未配置 secret）时后端 detail 如实呈现", async () => {
    const backend = installShareRows();
    vi.stubGlobal(
      "fetch",
      withShareEndpoint(backend, {
        status: 503,
        detail: "分享功能未配置（FD_WIRE_SHARE_SECRET 为空）",
      }),
    );

    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");

    fireEvent.click(within(rowOf(14)).getByTestId("artifact-share"));
    expect(await screen.findByTestId("share-error")).toBeTruthy();
    expect(screen.getByTestId("share-error").textContent).toContain(
      "分享功能未配置",
    );
    expect(screen.queryByTestId("share-url")).toBeNull();
  });

  // wire-share-ttl-options 任务 2.1：有效期三选一（7/30/90，缺省 30）——
  // 默认 POST body 带 ttl_days=30；改选 90 天即重新生成，body 带 ttl_days=90；
  // 到期时间生成中为本地预览、响应到达后以 expires_at 覆盖。
  it("有效期三选一：默认 30 天 body；改选 90 天重新生成，body 带 ttl_days=90", async () => {
    const backend = installShareRows();
    vi.stubGlobal("fetch", withShareEndpoint(backend));

    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");
    fireEvent.click(within(rowOf(14)).getByTestId("artifact-share"));
    expect(await screen.findByTestId("share-url")).toBeTruthy();

    // 三档单选（7/30/90）且默认选中 30
    const options = screen.getAllByTestId("share-ttl-option");
    expect(options.map((el) => el.getAttribute("data-days"))).toEqual([
      "7",
      "30",
      "90",
    ]);
    expect(options.map((el) => (el as HTMLInputElement).checked)).toEqual([
      false,
      true,
      false,
    ]);

    // 默认创建请求：POST body 携带 ttl_days=30
    const sharePosts = () =>
      backend.calls.filter(
        (c) =>
          c.method === "POST" && /\/artifacts\/14\/share$/.test(c.url.pathname),
      );
    expect(sharePosts()).toHaveLength(1);
    expect(sharePosts()[0]!.body).toEqual({ ttl_days: 30 });

    // 改选 90 天：触发重新生成（第二个 POST），body 带 ttl_days=90
    fireEvent.click(
      options.find((el) => el.getAttribute("data-days") === "90")!,
    );
    await waitFor(() => expect(sharePosts()).toHaveLength(2));
    expect(sharePosts()[1]!.body).toEqual({ ttl_days: 90 });
    // 到期时间以响应 expires_at 覆盖本地预览；链接来自新响应
    expect(
      (await screen.findByTestId("share-url") as HTMLInputElement).value,
    ).toContain("share-token-14");
    expect(screen.getByTestId("share-expires").textContent).toContain(
      formatServerDate("2026-11-10T08:00:00"),
    );
  });
});

// ── 新建看板（wire-dashboard-blank-create 任务 1.2）──────────────────────
// 契约：POST /api/v1/artifacts body {kind:"dashboard", title} → 201
// ArtifactDetail（draft v1，最小空板 spec）；成功后新行置顶并走既有行展开
// 直接进编辑器（startEditing）；422 detail 如实呈现；空标题前端先拦不发；
// 创建中禁用防重复提交。

describe("ArtifactsPage 新建看板（wire-dashboard-blank-create 1.2）", () => {
  beforeEach(() => {
    i18n.changeLanguage("zh");
    localStorage.clear();
    sessionStorage.clear();
    seedConsoleSession({ sub: "demo-customer" });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  /** 打开新建表单（列表就绪后）。 */
  async function openCreateForm() {
    render(<ArtifactsPage />);
    await screen.findAllByTestId("artifact-item");
    fireEvent.click(screen.getByTestId("create-dashboard-open"));
    expect(screen.getByTestId("create-dashboard-form")).toBeTruthy();
  }

  it("创建流：标题输入 → POST {kind:'dashboard', title} → 新行置顶 + 直接进编辑器", async () => {
    const backend = install();
    await openCreateForm();

    fireEvent.change(screen.getByTestId("create-dashboard-title"), {
      target: { value: "免费档第一块板" },
    });
    fireEvent.click(screen.getByTestId("create-dashboard-submit"));

    // 创建即跳编辑器：既有行展开路径（dashboardFor）+ startEditing——
    // 编辑器直接可见，标题回填，空板提示在。
    expect(await screen.findByTestId("dashboard-editor")).toBeTruthy();
    expect(
      (screen.getByTestId("editor-dashboard-title") as HTMLInputElement).value,
    ).toBe("免费档第一块板");
    expect(screen.getByTestId("editor-empty-panels").textContent).toContain(
      "还没有面板",
    );

    // POST 载荷断言：kind 白名单 + 标题 + 登录 Bearer
    const post = backend.calls.find(
      (c) => c.method === "POST" && c.url.pathname === "/api/v1/artifacts",
    );
    expect(post).toBeTruthy();
    expect(post?.body).toEqual({ kind: "dashboard", title: "免费档第一块板" });
    expect(post?.headers["authorization"]).toMatch(/^Bearer /);

    // 新行置顶：draft 徽标 + v1 + 直接创建（无来源会话指针）；表单收起
    const items = screen.getAllByTestId("artifact-item");
    expect(items.length).toBe(4);
    const newRow = items[0]!;
    expect(newRow.getAttribute("data-artifact-id")).toBe("14");
    expect(
      within(newRow).getByTestId("artifact-status-badge").getAttribute("data-status"),
    ).toBe("draft");
    expect(within(newRow).getByTestId("artifact-version").textContent).toBe("v1");
    expect(
      within(newRow).getByTestId("artifact-source-none").textContent,
    ).toContain("直接创建");
    expect(screen.queryByTestId("create-dashboard-form")).toBeNull();
  });

  it("422 呈现：后端 detail 如实显示，表单保留可重试", async () => {
    install({
      failArtifactCreateStatus: 422,
      failArtifactCreateDetail: "产物数量已达上限（10 个）",
    });
    await openCreateForm();

    fireEvent.change(screen.getByTestId("create-dashboard-title"), {
      target: { value: "超限板" },
    });
    fireEvent.click(screen.getByTestId("create-dashboard-submit"));

    expect(
      (await screen.findByTestId("create-dashboard-error")).textContent,
    ).toContain("产物数量已达上限");
    // 表单不关、无新行、按钮恢复可重试
    expect(screen.getByTestId("create-dashboard-form")).toBeTruthy();
    expect(screen.getAllByTestId("artifact-item").length).toBe(3);
    expect(
      (screen.getByTestId("create-dashboard-submit") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("空标题前端校验：空/纯空白不发 POST，提示后可修正再创建", async () => {
    const backend = install();
    await openCreateForm();

    // 空标题：前端先拦
    fireEvent.click(screen.getByTestId("create-dashboard-submit"));
    expect(screen.getByTestId("create-dashboard-error").textContent).toContain(
      "请输入看板标题",
    );
    // 纯空白标题：同样不发
    fireEvent.change(screen.getByTestId("create-dashboard-title"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByTestId("create-dashboard-submit"));
    expect(screen.getByTestId("create-dashboard-error").textContent).toContain(
      "请输入看板标题",
    );
    expect(
      backend.calls.filter(
        (c) => c.method === "POST" && c.url.pathname === "/api/v1/artifacts",
      ),
    ).toHaveLength(0);
    expect(screen.getAllByTestId("artifact-item").length).toBe(3);

    // 修正为合法标题后可正常创建（前端校验不阻塞后续流程）
    fireEvent.change(screen.getByTestId("create-dashboard-title"), {
      target: { value: "修正后的板" },
    });
    fireEvent.click(screen.getByTestId("create-dashboard-submit"));
    expect(await screen.findByTestId("dashboard-editor")).toBeTruthy();
  });

  it("防重复提交：创建中按钮禁用 + 仅一发；成功后表单收起进编辑器", async () => {
    const backend = install();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const posts: string[] = [];
    const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://console.test");
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.pathname === "/api/v1/artifacts" && method === "POST") {
        posts.push(`${method} ${url.pathname}`);
        return gate.then(() => backend.fetchImpl(input, init));
      }
      return backend.fetchImpl(input, init);
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", wrapped);

    await openCreateForm();
    fireEvent.change(screen.getByTestId("create-dashboard-title"), {
      target: { value: "防重复板" },
    });
    fireEvent.click(screen.getByTestId("create-dashboard-submit"));

    // 创建中：loading 文案 + 禁用，再点不产生第二个 POST
    expect(posts).toEqual(["POST /api/v1/artifacts"]);
    const submit = screen.getByTestId("create-dashboard-submit");
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(submit.textContent).toContain("创建中");
    fireEvent.click(submit);
    expect(posts).toEqual(["POST /api/v1/artifacts"]);

    // 放行后：单次创建成功 → 表单收起、直接进编辑器
    release();
    expect(await screen.findByTestId("dashboard-editor")).toBeTruthy();
    expect(screen.queryByTestId("create-dashboard-form")).toBeNull();
  });
});
