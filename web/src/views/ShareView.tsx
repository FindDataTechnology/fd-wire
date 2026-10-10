// 公开分享页（/#/share/dashboard/{id}?t=&v=，wire-dashboard-share 任务 2.1）。
// - 免登录只读：调公开端点 GET /api/v1/share/dashboard/{id}?t=&v=（无
//   Bearer），成功 → parseDashboardSpec 宽容解析标题 + DashboardRenderer
//   复用渲染（只读，无任何编辑入口）；页脚「由柏讯分享 · 版本 v{n}」。
// - noindex 红线：挂载即注入 <meta name="robots" content="noindex">（卸载
//   移除）——分享页不得入公开目录或搜索引擎；document.title 前缀「分享 · 」。
// - 失败口径与 api 对齐且不泄露原因差异：404/网络错 →「链接无效或已过期」
//   静态页（无重试按钮——重试也只会再 404）；503（未配置 share secret）→
//   「分享功能未开通」页。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ConsoleApiError,
  fetchSharedDashboard,
  type SharedDashboard,
} from "../console/api";
import { DashboardRenderer } from "../console/dashboard/DashboardRenderer";
import { parseDashboardSpec } from "../console/dashboard/spec";

/** 四态：加载中 / 就绪 / 链接无效（含网络错）/ 分享未开通（503）。 */
type ShareState =
  | { kind: "loading" }
  | { kind: "ready"; data: SharedDashboard; title: string }
  | { kind: "invalid" }
  | { kind: "disabled" };

export function ShareView({
  artifactId,
  token,
  version,
}: {
  /** 路由段里的产物 id（数字字符串；非法时交给服务端 404）。 */
  artifactId: string;
  /** 签名令牌 t（缺失即空串——服务端验签必败，落无效页）。 */
  token: string;
  /** 钉死版本 v（可选；缺失时省略该参数）。 */
  version: string | null;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<ShareState>({ kind: "loading" });

  // noindex 红线：进入即插、离开移除（SPA 其他视图不受影响）。
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "robots");
    meta.setAttribute("content", "noindex");
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    fetchSharedDashboard(
      Number(artifactId),
      token,
      version != null && version !== "" ? Number(version) : null,
    )
      .then((data) => {
        if (!alive) return;
        // 标题：响应 title 优先，缺失回落 spec 宽容解析（信封/本体皆可；
        // legacy 形态无 title 字段，回落空由兜底占位）。
        const parsed = parseDashboardSpec(data.spec);
        const parsedTitle = parsed.kind === "v1" ? parsed.title : "";
        const title =
          (typeof data.title === "string" && data.title.trim()) ||
          parsedTitle ||
          t("console.dashboard.share.untitled");
        setState({ kind: "ready", data, title });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        // 503 = 未配置 secret（分享功能整体禁用）；其余（404/网络错）一律
        // 无效链接页——不区分原因，绝不泄露验签细节。
        setState(
          err instanceof ConsoleApiError && err.status === 503
            ? { kind: "disabled" }
            : { kind: "invalid" },
        );
      });
    return () => {
      alive = false;
    };
  }, [artifactId, token, version, t]);

  // document.title 前缀「分享 · 」：进页面即生效，就绪后带上板名。
  const pageTitle =
    state.kind === "ready"
      ? state.title
      : state.kind === "disabled"
        ? t("console.dashboard.share.disabledTitle")
        : state.kind === "invalid"
          ? t("console.dashboard.share.invalidTitle")
          : t("console.dashboard.share.loading");
  useEffect(() => {
    document.title = t("console.dashboard.share.docTitle", {
      title: pageTitle,
    });
  }, [pageTitle, t]);

  return (
    <div className="flex min-h-screen flex-col">
      {/* 极简顶栏：只有 Wire 品牌字（无导航/登录/语言切换——公开只读页）。 */}
      <header
        data-testid="share-topbar"
        className="border-b border-slate-200 bg-white"
      >
        <div className="mx-auto flex max-w-5xl items-center px-4 py-3">
          <a href="#/" className="text-lg font-semibold tracking-wide">
            Wire
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {state.kind === "loading" && (
          <p data-testid="share-loading" className="mt-6 text-sm text-slate-400">
            {t("console.dashboard.share.loading")}
          </p>
        )}

        {state.kind === "invalid" && (
          <div
            data-testid="share-invalid"
            className="mx-auto mt-16 max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center"
          >
            <h1 className="text-lg font-semibold text-slate-800">
              {t("console.dashboard.share.invalidTitle")}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {t("console.dashboard.share.invalidBody")}
            </p>
          </div>
        )}

        {state.kind === "disabled" && (
          <div
            data-testid="share-disabled"
            className="mx-auto mt-16 max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center"
          >
            <h1 className="text-lg font-semibold text-slate-800">
              {t("console.dashboard.share.disabledTitle")}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {t("console.dashboard.share.disabledBody")}
            </p>
          </div>
        )}

        {state.kind === "ready" && (
          <div data-testid="share-dashboard">
            <h1
              data-testid="share-dashboard-title"
              className="text-lg font-semibold text-slate-900"
            >
              {state.title}
            </h1>
            <div className="mt-4">
              <DashboardRenderer spec={state.data.spec} />
            </div>
          </div>
        )}
      </main>

      <footer
        data-testid="share-footer"
        className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-400"
      >
        {state.kind === "ready"
          ? t("console.dashboard.share.footerVersion", {
              version: state.data.version,
            })
          : t("console.dashboard.share.footer")}
      </footer>
    </div>
  );
}
