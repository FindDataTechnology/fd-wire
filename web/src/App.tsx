// App shell: top nav (site / pricing / docs / catalog / console, zh–en toggle)
// over the views. Hash routing, deliberately no router dependency — parametrized
// routes are parsed by parseHash below (catalog list, catalog detail, console
// tabs, demand placeholder).
// 页脚分发（wire-ux-consolidation 任务 1.2）：门户视图挂全量页脚，
// #/console/* 挂紧凑页脚，#/admin 不渲染页脚。
// 公开分享页（wire-dashboard-share）：#/share/dashboard/{id}?t=&v= 完全
// 独立成壳（极简顶栏 + 分享页脚，noindex），不进上方任何布局。
// 登录件（wire-self-serve-launch 4.4/5.2）：
// - Logto 回调走真实路径 /console/callback（App 挂载时检测 pathname 进入
//   CallbackView，完成后回 hash 路由）；
// - 「内部后台」导航按登录角色显隐（ID token roles 含 wire-admin 才渲染）。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { HomeView } from "./views/HomeView";
import { ConsoleView } from "./views/ConsoleView";
import { LoginView } from "./views/LoginView";
import { CatalogView } from "./views/CatalogView";
import { CatalogDetailView } from "./views/CatalogDetailView";
import { DemandNewView } from "./views/DemandNewView";
import { ShareView } from "./views/ShareView";
import { PricingView } from "./views/PricingView";
import { DocsView } from "./views/DocsView";
import { AdminView } from "./admin/AdminView";
import { parseAdminSection, type AdminSection } from "./admin/AdminLayout";
import { CallbackView } from "./console/CallbackView";
import { hasAdminRole, loadSession } from "./console/auth";
import type { ConsoleTab } from "./console/ConsoleLayout";
import { ConsoleFooter } from "./components/ConsoleFooter";
import { SiteFooter } from "./components/SiteFooter";
import { switchLanguage, type Language } from "./i18n";

export type Route =
  | { name: "home" }
  | { name: "pricing" }
  | { name: "docs" }
  | { name: "catalog" }
  | { name: "catalogDetail"; id: string }
  | { name: "console"; tab: ConsoleTab }
  | { name: "demandNew"; indicator: string | null }
  | { name: "admin"; section: AdminSection }
  | { name: "shareDashboard"; id: string; token: string | null; version: string | null }
  | { name: "shareForm"; id: string; token: string | null; version: string | null }
  | { name: "login" };

/** 控制台二级段 → tab（未知段回落默认 datasets）。 */
function parseConsoleTab(segment: string | undefined): ConsoleTab {
  if (
    segment === "chat" ||
    segment === "artifacts" ||
    segment === "datasets" ||
    segment === "entities" ||
    segment === "packs" ||
    segment === "demands" ||
    segment === "usage" ||
    segment === "keys"
  ) {
    return segment;
  }
  return "datasets";
}

/** "#/catalog/abc?indicator=x" → 结构化路由（未知路径回落首页）。 */
export function parseHash(rawHash: string): Route {
  const path = rawHash || "#/";
  const [rawPath, rawQuery = ""] = path.replace(/^#/, "").split("?");
  const segments = rawPath.split("/").filter(Boolean);
  const query = new URLSearchParams(rawQuery);
  if (segments.length === 0) return { name: "home" };
  const [head, second, third] = segments;
  if (head === "pricing") return { name: "pricing" };
  if (head === "docs") return { name: "docs" };
  if (head === "console") {
    if (second === "demands" && third === "new") {
      return { name: "demandNew", indicator: query.get("indicator") };
    }
    // 旧深链 ?c=<id> 仅服务于已退役的对话页：查询参数被忽略，仍落对应 tab
    //（chat 落壹座引导卡），路由兼容。
    return { name: "console", tab: parseConsoleTab(second) };
  }
  if (head === "admin") {
    // #/admin/customers|ledger|demands|catalog|usage（未知段回落客户页）
    return { name: "admin", section: parseAdminSection(second) };
  }
  if (head === "login") return { name: "login" };
  if (head === "share" && second === "dashboard" && third) {
    // 公开分享深链 #/share/dashboard/{id}?t=…&v=…（wire-dashboard-share）：
    // t 缺失/坏由 ShareView 如实落「链接无效或已过期」页，不在路由层拦截。
    return {
      name: "shareDashboard",
      id: third,
      token: query.get("t"),
      version: query.get("v"),
    };
  }
  if (head === "share" && second === "form" && third) {
    // 公开表单深链 #/share/form/{id}?t=…&v=…（wire-form-builder 任务 4.5）：
    // 与看板分享同款分派——四态框架/品牌面/noindex 沿用，运行时换 FormRuntime。
    return {
      name: "shareForm",
      id: third,
      token: query.get("t"),
      version: query.get("v"),
    };
  }
  if (head === "catalog") {
    if (segments.length >= 2) {
      const raw = segments.slice(1).join("/");
      let id = raw;
      try {
        id = decodeURIComponent(raw);
      } catch {
        /* 保留原样，交由 API 404 */
      }
      return { name: "catalogDetail", id };
    }
    return { name: "catalog" };
  }
  return { name: "home" };
}

/** Logto 授权码回调走真实路径（非 hash）：命中即渲染回调页。 */
export function isConsoleCallbackPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "") === "/console/callback";
}

function renderRoute(route: Route) {
  switch (route.name) {
    case "pricing":
      return <PricingView />;
    case "docs":
      return <DocsView />;
    case "catalog":
      return <CatalogView />;
    case "catalogDetail":
      return <CatalogDetailView id={route.id} />;
    case "console":
      return <ConsoleView tab={route.tab} />;
    case "demandNew":
      return <DemandNewView indicator={route.indicator} />;
    case "admin":
      return <AdminView section={route.section} />;
    case "shareDashboard":
      return (
        <ShareView
          artifactId={route.id}
          token={route.token ?? ""}
          version={route.version}
        />
      );
    case "shareForm":
      return (
        <ShareView
          artifactId={route.id}
          token={route.token ?? ""}
          version={route.version}
          mode="form"
        />
      );
    case "login":
      return <LoginView />;
    case "home":
      return <HomeView />;
  }
}

export function App() {
  const { t, i18n } = useTranslation();
  const [hash, setHash] = useState(window.location.hash || "#/");

  useEffect(() => {
    const on = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const route = parseHash(hash);
  // 控制台/内部后台是工作台布局（自带侧栏与宽内容区），主容器放宽。
  const wideMain = route.name === "console" || route.name === "admin";
  // 页脚分发：门户视图（含登录页）全量；#/console/*（含需求单占位子页）
  // 紧凑；#/admin 不渲染。
  const footer =
    route.name === "admin" ? null : route.name === "console" ||
      route.name === "demandNew" ? (
      <ConsoleFooter />
    ) : (
      <SiteFooter />
    );
  // Logto 回调：真实路径 /console/callback 优先于 hash 路由（完成后回 hash）。
  const callbackActive = isConsoleCallbackPath(window.location.pathname);
  // admin 导航门禁：登录会话含 wire-admin 角色才渲染「内部后台」入口
  // （路由直达仍有 AdminView 的角色门禁兜底）。
  const showAdminNav = hasAdminRole(loadSession());

  const tab = (h: string, label: string, active: boolean, testid?: string) => (
    <a
      href={h}
      data-testid={testid}
      className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
        active ? "bg-slate-900 text-white" : "hover:bg-slate-200"
      }`}
    >
      {label}
    </a>
  );

  const langButton = (lang: Language, label: string) => (
    <button
      type="button"
      onClick={() => switchLanguage(lang)}
      className={`px-2 py-1 rounded text-xs transition-colors ${
        i18n.language === lang
          ? "bg-slate-200 font-medium"
          : "hover:bg-slate-100"
      }`}
    >
      {label}
    </button>
  );

  if (callbackActive) {
    return (
      <div className="min-h-screen">
        <CallbackView />
      </div>
    );
  }

  // 公开分享页（wire-dashboard-share / wire-form-builder）：独立极简壳——
  // 自带「Wire」顶栏与「由柏讯分享」页脚，不进站点导航/控制台布局，无需登录。
  if (route.name === "shareDashboard" || route.name === "shareForm") {
    return renderRoute(route);
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <a href="#/" className="text-lg font-semibold tracking-wide">
            {t("brand.name")}
            <span className="ml-2 text-sm font-normal text-slate-500">
              {t("brand.tagline")}
            </span>
          </a>
          <nav className="ml-auto flex items-center gap-1">
            {tab("#/", t("nav.home"), route.name === "home")}
            {tab("#/pricing", t("nav.pricing"), route.name === "pricing")}
            {tab("#/docs", t("nav.docs"), route.name === "docs")}
            {tab("#/catalog", t("nav.catalog"), route.name === "catalog" || route.name === "catalogDetail")}
            {tab("#/console", t("nav.console"), route.name === "console" || route.name === "demandNew")}
            {showAdminNav &&
              tab("#/admin", t("nav.admin"), route.name === "admin", "nav-admin")}

            <a
              href="#/login"
              className="ml-2 px-3 py-1.5 rounded-md text-sm border border-slate-300 hover:bg-slate-100 transition-colors"
            >
              {t("nav.login")}
            </a>
            <div className="ml-2 flex items-center rounded-md border border-slate-200 overflow-hidden">
              {langButton("zh", "中")}
              {langButton("en", "EN")}
            </div>
          </nav>
        </div>
      </header>
      <main
        className={
          wideMain ? "mx-auto max-w-7xl px-4 py-6" : "mx-auto max-w-5xl px-4 py-8"
        }
      >
        {renderRoute(route)}
      </main>
      {footer}
    </div>
  );
}
