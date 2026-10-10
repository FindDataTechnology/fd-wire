// 公开分享页组件测试（wire-dashboard-share 任务 2.1/2.3）：
// 三态——正常渲染（复用 DashboardRenderer + 页脚版本）/ 令牌坏 404 落
// 「链接无效或已过期」/ 503 未配置 secret 落「分享功能未开通」；
// 红线——noindex meta 注入与卸载移除、document.title 前缀「分享 · 」、
// 公开端点请求绝不携带 Authorization（免登录接收者直接打开）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { ShareView } from "./ShareView";

/** v1 信封 spec（产物详情原样形状）：单 kpi 面板。 */
const DASH_SPEC = {
  title: "宏观仪表盘",
  spec: {
    title: "宏观仪表盘",
    panels: [
      {
        id: "p1",
        type: "kpi",
        title: "CPI 同比",
        span: 1,
        snapshot: { columns: ["value"], rows: [[2.3]] },
        config: { unit: "%" },
      },
    ],
  },
};

/** 公开端点成功响应（proposal 冻结形状 {title, spec, version, shared_at}）。 */
const SHARE_BODY = {
  title: "宏观仪表盘",
  spec: DASH_SPEC,
  version: 3,
  shared_at: "2026-10-11T08:00:00",
};

type FetchRecord = { url: string; headers: Record<string, string> }[];

/** 打公开端点假 fetch：记录请求（断言无 Authorization），按入参回状态。 */
function stubShareFetch(status: number, body: unknown): FetchRecord {
  const calls: FetchRecord = [];
  vi.stubGlobal(
    "fetch",
    ((input: RequestInfo | URL, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers as HeadersInit | undefined).forEach(
        (v, k) => {
          headers[k.toLowerCase()] = v;
        },
      );
      calls.push({ url: String(input), headers });
      return Promise.resolve({
        ok: status < 400,
        status,
        json: () => Promise.resolve(body),
      } as unknown as Response);
    }) as unknown as typeof fetch,
  );
  return calls;
}

function robotsMeta(): HTMLMetaElement | null {
  return document.querySelector('meta[name="robots"]');
}

beforeEach(() => {
  i18n.changeLanguage("zh");
  localStorage.clear();
  sessionStorage.clear();
  document.title = "柏讯 Wire — B2B 数据平台";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe("ShareView（公开分享页三态 + noindex 红线）", () => {
  it("正常渲染：复用 DashboardRenderer 只读、页脚带版本、标题前缀、noindex meta、请求无鉴权头", async () => {
    const calls = stubShareFetch(200, SHARE_BODY);

    render(
      <ShareView artifactId="11" token="tok-abc" version="3" />,
    );

    // 公开端点：路径 + t/v 查询参数齐整，且绝不携带 Authorization
    await waitFor(() => {
      expect(calls[0]?.url).toBe(
        "/api/v1/share/dashboard/11?t=tok-abc&v=3",
      );
    });
    expect(calls[0]?.headers["authorization"]).toBeUndefined();

    // 复用渲染器：v1 面板正常画出（kpi 大数），无编辑入口
    expect(await screen.findByTestId("dashboard-renderer")).toBeTruthy();
    expect(
      (await screen.findByTestId("dashboard-kpi-value")).textContent,
    ).toBe("2.3");
    expect(screen.getByTestId("share-dashboard-title").textContent).toBe(
      "宏观仪表盘",
    );

    // 页脚：由柏讯分享 · 版本 v{n}（版本来自响应）
    expect(screen.getByTestId("share-footer").textContent).toBe(
      "由柏讯分享 · 版本 v3",
    );

    // 红线：document.title 前缀「分享 · 」+ robots noindex meta 已注入
    expect(document.title).toBe("分享 · 宏观仪表盘");
    expect(robotsMeta()?.getAttribute("content")).toBe("noindex");
  });

  it("令牌无效/过期（404）：落「链接无效或已过期」静态页——无渲染器、无重试泄露", async () => {
    stubShareFetch(404, { detail: "not found" });

    const { unmount } = render(
      <ShareView artifactId="11" token="tampered-token" version="1" />,
    );

    expect(await screen.findByTestId("share-invalid")).toBeTruthy();
    expect(screen.getByTestId("share-invalid").textContent).toContain(
      "链接无效或已过期",
    );
    // 不渲染看板本体；标题仍带「分享 · 」前缀
    expect(screen.queryByTestId("dashboard-renderer")).toBeNull();
    expect(document.title).toContain("分享 · ");
    // 卸载移除 noindex meta（SPA 其他视图不受影响）
    unmount();
    expect(robotsMeta()).toBeNull();
  });

  it("服务端未配置 secret（503）：落「分享功能未开通」页", async () => {
    stubShareFetch(503, { detail: "FD_WIRE_SHARE_SECRET 未配置" });

    render(<ShareView artifactId="11" token="tok-abc" version="2" />);

    expect(await screen.findByTestId("share-disabled")).toBeTruthy();
    expect(screen.getByTestId("share-disabled").textContent).toContain(
      "分享功能未开通",
    );
    expect(screen.queryByTestId("dashboard-renderer")).toBeNull();
    expect(screen.queryByTestId("share-invalid")).toBeNull();
  });

  it("缺版本参数：请求省略 v（仅 t）；极简顶栏 Wire 常在", async () => {
    const calls = stubShareFetch(200, SHARE_BODY);

    render(<ShareView artifactId="11" token="tok-only" version={null} />);

    expect(await screen.findByTestId("dashboard-renderer")).toBeTruthy();
    expect(calls[0]?.url).toBe("/api/v1/share/dashboard/11?t=tok-only");
    expect(screen.getByTestId("share-topbar").textContent).toBe("Wire");
  });
});
