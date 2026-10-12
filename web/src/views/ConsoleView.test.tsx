// 控制台容器测试（wire-self-serve-launch 任务 4.4/4.6）：
// 登录配置未下发的阻塞态（不发起任何受保护请求）、匿名登录引导、
// 会话建立（POST /api/console/session）+ key_once 明文一次展示、
// 开户失败（502）如实呈现、顶栏登录态（客户/档位/身份/登出）。
// 个人偏好（wire-personal-preferences）：启动拉取与 locale 收敛/首登领养/
// 端点失败不阻塞；落地序（裸 #/console 才走偏好：置顶跳转=artifacts+展开
// 该看板 > landing_tab > datasets；显式页签直达不劫持）；用户切页签即写
// landing_tab、程序跳转经 suppress 不回写——落地用例经 App 壳走真实
// hash→tab 链路。
// fetch 一律走 testing.ts 的内存假后端（零网络）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { ConsoleView } from "./ConsoleView";
import { App } from "../App";
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
  it("启动 loading 期渲染可见加载指示（居中 spinner + 文案，不再空白）", () => {
    // auth/config 永不返回：bootstrap 停在 loading 态，验证启动期有可见反馈。
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    render(<ConsoleView />);

    const loading = screen.getByTestId("console-boot-loading");
    // i18n 文案（zh）+ spinner 圆环（animate-spin）均在场。
    expect(loading.textContent).toContain("正在进入控制台…");
    expect(loading.querySelector(".animate-spin")).toBeTruthy();
  });

  it("登录配置未下发（configured=false）→ 阻塞态提示，不发起任何受保护请求", async () => {
    const backend = installConsoleBackend(CONVERSATIONS, {
      authConfig: { configured: false },
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<ConsoleView />);

    const blocked = await screen.findByTestId("console-blocked");
    expect(blocked.textContent).toContain("configured=false");
    // 居中修复（任务 1.3）：卡片水平居中。
    expect(blocked.className).toContain("mx-auto");
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
    const configError = await screen.findByTestId("console-config-error");
    expect(configError.className).toContain("mx-auto");
  });

  it("无会话 → 登录引导（不携带任何 Bearer 请求 /api/v1）", async () => {
    const backend = installConsoleBackend(CONVERSATIONS);
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<ConsoleView />);

    const signin = await screen.findByTestId("console-signin");
    expect(signin.className).toContain("mx-auto");
    const protectedCalls = backend.calls.filter((c) =>
      c.url.pathname.startsWith("/api/v1/"),
    );
    expect(protectedCalls).toEqual([]);
  });

  it("已登录：会话建立（POST /api/console/session 带 id_token）→ 默认落「我的数据」", async () => {
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

    // 进入控制台：顶栏客户/档位 + 默认 tab=datasets（我的数据，Bearer 头）
    expect(await screen.findByTestId("console-topbar")).toBeTruthy();
    expect(screen.getByTestId("console-org").textContent).toBe("上海壹座");
    expect(screen.getByTestId("console-plan").textContent).toBe("basic");
    expect(await screen.findByTestId("upload-section")).toBeTruthy();
    const listCall = backend.calls.find(
      (c) => c.url.pathname === "/api/v1/datasets",
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

    const sessionError = await screen.findByTestId("console-session-error");
    expect(sessionError.className).toContain("mx-auto");
    expect(
      screen.getByTestId("console-session-error-detail").textContent,
    ).toContain("cell-manager unreachable");
    // 失败态不渲染任何子页
    expect(screen.queryByTestId("console-nav")).toBeNull();
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
  it("demands tab 已转正：「我的需求」只读列表渲染（不再占位、无上线中徽标）", async () => {
    vi.stubGlobal(
      "fetch",
      installConsoleBackend([], {
        demands: [
          {
            id: 1,
            code: "DE-20261010-01",
            customer_id: "demo-customer",
            title: "煤价日度",
            intent: "煤价日度",
            contact_email: "buyer@acme.com",
            company: null,
            status: "submitted",
            status_history: [],
            rejection_reason: null,
            created_at: "2026-10-10T08:00:00",
            updated_at: "2026-10-10T08:00:00",
          },
        ],
      }).fetchImpl,
    );
    seedConsoleSession({ sub: "demo-customer", planCode: "basic" });
    const { rerender } = render(<ConsoleView tab="demands" />);

    // 只读列表渲染（任务 4.3）：占位卡与「上线中」徽标均退场
    const page = await screen.findByTestId("my-demands-page");
    expect(page.textContent).toContain("我的需求");
    expect(screen.getAllByTestId("my-demand-item").length).toBe(1);
    expect(screen.queryByTestId("console-placeholder")).toBeNull();
    const navDemands = screen.getByTestId("console-nav-demands");
    expect(navDemands.textContent).not.toContain("上线中");
    // usage：正式用量页（占位退位）——端点数据渲染
    rerender(<ConsoleView tab="usage" />);
    expect(await screen.findByTestId("usage-page")).toBeTruthy();
    // datasets：付费档正常渲染数据面
    rerender(<ConsoleView tab="datasets" />);
    expect(await screen.findByTestId("upload-section")).toBeTruthy();
    // artifacts tab 渲染产物页（空态可见；wire-artifacts-persistence 后
    // 草稿说明横幅退位，持久化产物列表空态取而代之）
    rerender(<ConsoleView tab="artifacts" />);
    expect(await screen.findByTestId("artifacts-empty")).toBeTruthy();
  });

  it("chat tab 显示名「AI 构建」（id 保持 chat）；旧 #/console/chat 深链仍落壹座引导卡", async () => {
    vi.stubGlobal("fetch", installConsoleBackend([]).fetchImpl);
    seedConsoleSession({ sub: "demo-customer", planCode: "basic" });
    render(<ConsoleView tab="chat" />);

    expect(await screen.findByTestId("chat-guide")).toBeTruthy();
    expect(screen.getByTestId("chat-guide-demo-cta").getAttribute("href")).toBe(
      "https://finddatatech.cloud/demo",
    );
    // 引导卡无测试账号明文
    expect(screen.getByTestId("chat-guide").textContent).not.toContain(
      "platform-test",
    );
    // tab id 保持 chat（路由兼容），显示名改为「AI 构建」
    const chatNav = screen.getByTestId("console-nav-chat");
    expect(chatNav.getAttribute("href")).toBe("#/console/chat");
    expect(chatNav.textContent).toContain("AI 构建");
  });
});

describe("ConsoleView（个人偏好：跨端同步语义）", () => {
  /** 偏好端点的 PUT 调用记录（landing_tab/locale 写回断言面）。 */
  const preferencePuts = (
    backend: ReturnType<typeof installConsoleBackend>,
  ) =>
    backend.calls.filter(
      (c) =>
        c.url.pathname === "/api/console/me/preferences" && c.method === "PUT",
    );

  /** 断言当前激活页签（侧栏高亮 = bg-slate-900）。 */
  const expectActiveTab = (tab: string) => {
    expect(
      screen.getByTestId(`console-nav-${tab}`).className.includes("bg-slate-900"),
    ).toBe(true);
  };

  /** 置顶落地用种子看板（id=11，published dashboard）。 */
  const seedDashboard = (backend: ReturnType<typeof installConsoleBackend>) => {
    backend.addLifecycleArtifact({
      id: 11,
      kind: "dashboard",
      title: "宏观仪表盘",
      status: "published",
      version: 1,
      origin_conversation_id: null,
      spec: {
        title: "宏观仪表盘",
        spec: { title: "宏观仪表盘", panels: [] },
      },
      created_at: "2026-10-09T09:00:00",
      updated_at: "2026-10-10T09:00:00",
    });
  };

  it("启动拉取偏好：server ui_locale=en → 覆盖本地 i18n（跨设备语言同步）", async () => {
    const backend = installConsoleBackend([], {
      preferences: { "demo-customer": { ui_locale: "en" } },
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    seedConsoleSession({ sub: "demo-customer" });
    window.location.hash = "#/console";
    render(<App />);

    await screen.findByTestId("console-topbar");
    await waitFor(() => {
      expect(i18n.language).toBe("en");
    });
    // 本地语言锚点同步（localStorage），顶栏 EN 按钮激活态。
    expect(localStorage.getItem("wire-web-lang")).toBe("en");
    expect(
      screen.getByText("EN").className.includes("bg-slate-200"),
    ).toBe(true);
    // server 已有 locale → 不触发领养 PUT。
    expect(preferencePuts(backend)).toEqual([]);
  });

  it("首登领养：GET 三键全空 → fire-and-forget PUT {ui_locale: 本地语言}", async () => {
    const backend = installConsoleBackend([]);
    vi.stubGlobal("fetch", backend.fetchImpl);
    seedConsoleSession({ sub: "demo-customer" });
    window.location.hash = "#/console";
    render(<App />);

    await screen.findByTestId("console-topbar");
    await waitFor(() => {
      expect(preferencePuts(backend)).toEqual([
        expect.objectContaining({ body: { ui_locale: "zh" } }),
      ]);
    });
    // 无偏好 → 落 datasets 兜底（无重定向）。
    expectActiveTab("datasets");
    expect(window.location.hash).toBe("#/console");
  });

  it("偏好端点故障 → 控制台照常启动（不阻塞、不领养、不重定向）", async () => {
    const backend = installConsoleBackend([], { failPreferencesStatus: 500 });
    vi.stubGlobal("fetch", backend.fetchImpl);
    seedConsoleSession({ sub: "demo-customer" });
    window.location.hash = "#/console";
    render(<App />);

    await screen.findByTestId("console-topbar");
    expectActiveTab("datasets");
    expect(i18n.language).toBe("zh");
    // GET 失败（非全空）→ 绝不触发领养 PUT。
    expect(preferencePuts(backend)).toEqual([]);
    expect(window.location.hash).toBe("#/console");
  });

  it("裸 #/console + 置顶看板 → 落 artifacts 并展开该看板；程序跳转不回写 landing_tab（suppress 消费后用户切页签照常即写）", async () => {
    const backend = installConsoleBackend([], {
      preferences: {
        "demo-customer": {
          ui_locale: "zh",
          landing_tab: "team",
          pinned_dashboard_id: 11,
        },
      },
    });
    seedDashboard(backend);
    vi.stubGlobal("fetch", backend.fetchImpl);
    seedConsoleSession({ sub: "demo-customer" });
    window.location.hash = "#/console";
    render(<App />);

    // 落 artifacts 页签（置顶优先于 landing_tab=team）+ 该看板视图直接展开。
    await screen.findByTestId("console-nav");
    await waitFor(() => expectActiveTab("artifacts"));
    expect(window.location.hash).toBe("#/console/artifacts");
    expect(await screen.findByTestId("dashboard-pane")).toBeTruthy();
    // 置顶行的「默认」徽标（偏好态下传产物页）。
    expect(screen.getByTestId("artifact-dashboard-default")).toBeTruthy();
    // 程序跳转不回写：无任何 landing_tab PUT。
    expect(
      preferencePuts(backend).filter(
        (c) => (c.body as Record<string, unknown> | undefined)?.landing_tab !== undefined,
      ),
    ).toEqual([]);

    // suppress 已被程序跳转消费：用户随后切页签照常即写 landing_tab。
    window.location.hash = "#/console/usage";
    await waitFor(() => {
      expect(
        preferencePuts(backend).find(
          (c) => (c.body as { landing_tab?: string })?.landing_tab === "usage",
        ),
      ).toBeTruthy();
    });
    expectActiveTab("usage");
  });

  it("帧序回归（生产实弹）：ready 首帧即已是程序跳转目标页签时，suppress 按目标消费，用户首次切页签照常即写", async () => {
    const backend = installConsoleBackend([], {
      preferences: {
        "demo-customer": {
          ui_locale: "zh",
          landing_tab: "team",
          pinned_dashboard_id: 11,
        },
      },
    });
    seedDashboard(backend);
    vi.stubGlobal("fetch", backend.fetchImpl);
    seedConsoleSession({ sub: "demo-customer" });
    window.location.hash = "#/console";
    // 真实浏览器合帧：hash 赋值的事件任务先于 React ready 提交，首帧 tab 直接
    // 已是跳转目标 artifacts（App 壳用例的 happy-dom 时序为两帧，覆盖不到）。
    const { rerender } = render(<ConsoleView tab="artifacts" />);

    await screen.findByTestId("console-nav");
    await waitFor(() =>
      expect(screen.getByTestId("artifact-dashboard-default")).toBeTruthy(),
    );
    // 程序跳转（含首帧即目标）不回写 landing_tab。
    expect(
      preferencePuts(backend).filter(
        (c) => (c.body as Record<string, unknown> | undefined)?.landing_tab !== undefined,
      ),
    ).toEqual([]);

    // 用户切页签 → 照常即写（旧实现此处被未消费的 suppress 吞掉——生产抓出）。
    rerender(<ConsoleView tab="usage" />);
    await waitFor(() => {
      expect(
        preferencePuts(backend).find(
          (c) => (c.body as { landing_tab?: string })?.landing_tab === "usage",
        ),
      ).toBeTruthy();
    });
  });

  it("裸 #/console 仅 landing_tab=team → 落 team；无置顶不展开、无任何 PUT", async () => {
    const backend = installConsoleBackend([], {
      preferences: { "demo-customer": { ui_locale: "zh", landing_tab: "team" } },
    });
    seedDashboard(backend);
    vi.stubGlobal("fetch", backend.fetchImpl);
    seedConsoleSession({ sub: "demo-customer" });
    window.location.hash = "#/console";
    render(<App />);

    await waitFor(() => expectActiveTab("team"));
    expect(window.location.hash).toBe("#/console/team");
    // landing_tab 跳转同样被 suppress：无任何偏好 PUT（含领养——三键非全空）。
    expect(preferencePuts(backend)).toEqual([]);
    expect(screen.queryByTestId("dashboard-pane")).toBeNull();
  });

  it("裸 #/console 无偏好 → 维持 datasets 兜底（领养仅 ui_locale，无重定向写）", async () => {
    const backend = installConsoleBackend([]);
    vi.stubGlobal("fetch", backend.fetchImpl);
    seedConsoleSession({ sub: "demo-customer" });
    window.location.hash = "#/console";
    render(<App />);

    await screen.findByTestId("console-topbar");
    await waitFor(() => {
      expect(preferencePuts(backend).length).toBe(1);
    });
    expectActiveTab("datasets");
    expect(window.location.hash).toBe("#/console");
    // 唯一的 PUT 是首登领养（ui_locale），绝无 landing_tab 写。
    expect(
      preferencePuts(backend).every(
        (c) => (c.body as Record<string, unknown> | undefined)?.landing_tab === undefined,
      ),
    ).toBe(true);
  });

  it("显式 #/console/usage 直达：偏好不劫持（不重定向、不展开置顶、不写 landing_tab）", async () => {
    const backend = installConsoleBackend([], {
      preferences: {
        "demo-customer": {
          ui_locale: "zh",
          landing_tab: "team",
          pinned_dashboard_id: 11,
        },
      },
    });
    seedDashboard(backend);
    vi.stubGlobal("fetch", backend.fetchImpl);
    seedConsoleSession({ sub: "demo-customer" });
    window.location.hash = "#/console/usage";
    render(<App />);

    await screen.findByTestId("console-topbar");
    expectActiveTab("usage");
    expect(window.location.hash).toBe("#/console/usage");
    expect(screen.queryByTestId("dashboard-pane")).toBeNull();
    expect(preferencePuts(backend)).toEqual([]);
  });
});
