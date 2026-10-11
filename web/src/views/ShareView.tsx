// 公开分享页（/#/share/dashboard/{id}?t=&v=，wire-dashboard-share 任务 2.1；
// wire-form-builder 任务 4.5 起 /#/share/form/{id}?t=&v= 同框架分派）。
// - 免登录只读：调公开端点 GET /api/v1/share/{dashboard|form}/{id}?t=&v=
//   （无 Bearer）；dashboard 态 → parseDashboardSpec 宽容解析标题 +
//   DashboardRenderer 复用渲染；form 态 → parseFormSpec + FormRuntime
//   （public endpoint，t/v 透传进 submit 地址——提交成功/失败态在组件内
//   呈现，公开提交免登录且绝不携带 Authorization）。
// - 品牌面（wire-share-branding）：四态同一顶栏双语品牌锁定（寻数·柏讯 /
//   Wire，双语锁定即两语言下文案相同）链产品首页；页脚就绪态
//   「{标题} · 由 寻数·柏讯 提供 · 版本 v{n}」、非就绪态产品署名；
//   就绪态注入 og:title/og:description/og:site_name 链接预览元信息。
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
  fetchSharedForm,
  sharedFormSubmitUrl,
} from "../console/api";
import { DashboardRenderer } from "../console/dashboard/DashboardRenderer";
import { parseDashboardSpec } from "../console/dashboard/spec";
import { FormRuntime } from "../console/form/FormRuntime";
import { parseFormSpec } from "../console/form/formSpec";

/** 分享模式：按路由路径分派（dashboard=只读看板；form=可填写表单）。 */
export type ShareMode = "dashboard" | "form";

/** 四态：加载中 / 就绪 / 链接无效（含网络错）/ 分享未开通（503）。 */
type ShareState =
  | { kind: "loading" }
  | {
      kind: "ready";
      /** 钉死版本 spec（产物信封原样——按 mode 交给对应渲染件宽容解析）。 */
      spec: Record<string, unknown>;
      title: string;
      version: number;
    }
  | { kind: "invalid" }
  | { kind: "disabled" };

export function ShareView({
  artifactId,
  token,
  version,
  mode = "dashboard",
}: {
  /** 路由段里的产物 id（数字字符串；非法时交给服务端 404）。 */
  artifactId: string;
  /** 签名令牌 t（缺失即空串——服务端验签必败，落无效页）。 */
  token: string;
  /** 钉死版本 v（可选；缺失时省略该参数）。 */
  version: string | null;
  /** 分享模式（路由分派；缺省看板——既有深链零漂移）。 */
  mode?: ShareMode;
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

  // og 链接预览元信息（wire-share-branding）：仅就绪态注入，与 noindex 同
  // 手法——插/移除成对，data-share-og 标记便于清理与定位。诚实边界：这是
  // 运行时注入，只对执行 JS 的链接预览器（聊天工具内嵌浏览器等）生效；
  // 不执行 JS 的爬虫读不到（SPA 静态壳无 SSR，如需爬虫全覆盖另走入口
  // nginx 注入，见 proposal Non-Goals）。og 与 noindex 不冲突：og 服务聊天
  // 卡片预览，noindex 管不入搜索目录。
  const ogTitle = state.kind === "ready" ? state.title : null;
  useEffect(() => {
    if (ogTitle == null) return;
    const ogDescription =
      mode === "form"
        ? t("console.form.ogDescription")
        : t("console.dashboard.share.ogDescription");
    const metas = (
      [
        ["og:title", ogTitle],
        ["og:description", ogDescription],
        ["og:site_name", t("console.dashboard.share.ogSiteName")],
      ] as const
    ).map(([property, content]) => {
      const meta = document.createElement("meta");
      meta.setAttribute("property", property);
      meta.setAttribute("content", content);
      meta.setAttribute("data-share-og", property);
      document.head.appendChild(meta);
      return meta;
    });
    return () => {
      metas.forEach((meta) => {
        document.head.removeChild(meta);
      });
    };
  }, [ogTitle, mode, t]);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    const numericVersion =
      version != null && version !== "" ? Number(version) : null;
    // 标题：响应 title 优先，缺失回落 spec 宽容解析（信封/本体皆可），
    // 兜底占位按 mode 取「未命名看板/表单」。
    const resolveTitle = (spec: Record<string, unknown>, rawTitle: string) => {
      // form 信封内层无标题字段——标题只认响应 title；dashboard 回落 v1
      // 解析（legacy 形态无 title 字段，回落空由兜底占位）。
      const parsedTitle =
        mode === "form"
          ? ""
          : (() => {
              const parsed = parseDashboardSpec(spec);
              return parsed.kind === "v1" ? parsed.title : "";
            })();
      return (
        (typeof rawTitle === "string" && rawTitle.trim()) ||
        parsedTitle ||
        (mode === "form"
          ? t("console.form.untitled")
          : t("console.dashboard.share.untitled"))
      );
    };
    const ready = (spec: Record<string, unknown>, rawTitle: string, v: number) => {
      setState({
        kind: "ready",
        spec,
        title: resolveTitle(spec, rawTitle),
        version: v,
      });
    };
    if (mode === "form") {
      fetchSharedForm(Number(artifactId), token, numericVersion)
        .then((data) => {
          if (!alive) return;
          ready(data.spec, data.title, data.version);
        })
        .catch((err: unknown) => {
          if (!alive) return;
          setState(
            err instanceof ConsoleApiError && err.status === 503
              ? { kind: "disabled" }
              : { kind: "invalid" },
          );
        });
    } else {
      fetchSharedDashboard(Number(artifactId), token, numericVersion)
        .then((data) => {
          if (!alive) return;
          ready(data.spec, data.title, data.version);
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
    }
    return () => {
      alive = false;
    };
  }, [artifactId, token, version, mode, t]);

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
      {/* 极简顶栏：双语品牌锁定 寻数·柏讯 / Wire（无导航/登录/语言切换——
          公开只读页）。主副排版贴 App.tsx 站点顶栏品牌惯例（主名 semibold +
          副名 slate-500 小字）；双语锁定即文案不随界面语言切换；四态同一
          顶栏——invalid/disabled 页同样是产品触点。链接保持产品首页 #/。 */}
      <header
        data-testid="share-topbar"
        className="border-b border-slate-200 bg-white"
      >
        <div className="mx-auto flex max-w-5xl items-center px-4 py-3">
          <a
            href="#/"
            data-testid="share-brand"
            className="text-lg font-semibold tracking-wide"
          >
            {t("console.dashboard.share.brandNameZh")}
            <span className="ml-2 text-sm font-normal tracking-normal text-slate-500">
              {t("console.dashboard.share.brandNameEn")}
            </span>
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

        {state.kind === "ready" && mode === "dashboard" && (
          <div data-testid="share-dashboard">
            <h1
              data-testid="share-dashboard-title"
              className="text-lg font-semibold text-slate-900"
            >
              {state.title}
            </h1>
            <div className="mt-4">
              <DashboardRenderer spec={state.spec} />
            </div>
          </div>
        )}

        {state.kind === "ready" && mode === "form" && (
          <div data-testid="share-form">
            <h1
              data-testid="share-form-title"
              className="text-lg font-semibold text-slate-900"
            >
              {state.title}
            </h1>
            <div className="mt-4">
              <FormRuntime
                spec={parseFormSpec(state.spec) ?? { datasetId: null, fields: [] }}
                endpoint={{
                  kind: "public",
                  url: sharedFormSubmitUrl(
                    Number(artifactId),
                    token,
                    version != null && version !== "" ? Number(version) : null,
                  ),
                }}
              />
            </div>
          </div>
        )}
      </main>

      {/* 页脚署名（wire-share-branding）：就绪态三段「{标题} · 由 寻数·柏讯
          提供 · 版本 v{n}」；非就绪态（loading/invalid/disabled）产品署名。 */}
      <footer
        data-testid="share-footer"
        className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-400"
      >
        {state.kind === "ready"
          ? t("console.dashboard.share.footerVersion", {
              title: state.title,
              version: state.version,
            })
          : t("console.dashboard.share.footer")}
      </footer>
    </div>
  );
}
