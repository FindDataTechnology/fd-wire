// App shell: top nav (site / catalog / console, zh–en toggle) over the views.
// Hash routing, deliberately no router dependency — parametrized routes are
// parsed by parseHash below (catalog list, catalog detail, demand placeholder).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { HomeView } from "./views/HomeView";
import { ConsoleView } from "./views/ConsoleView";
import { LoginView } from "./views/LoginView";
import { CatalogView } from "./views/CatalogView";
import { CatalogDetailView } from "./views/CatalogDetailView";
import { DemandNewView } from "./views/DemandNewView";
import { switchLanguage, type Language } from "./i18n";

export type Route =
  | { name: "home" }
  | { name: "catalog" }
  | { name: "catalogDetail"; id: string }
  | { name: "console" }
  | { name: "demandNew"; indicator: string | null }
  | { name: "login" };

/** "#/catalog/abc?indicator=x" → 结构化路由（未知路径回落首页）。 */
export function parseHash(rawHash: string): Route {
  const path = rawHash || "#/";
  const [rawPath, rawQuery = ""] = path.replace(/^#/, "").split("?");
  const segments = rawPath.split("/").filter(Boolean);
  const query = new URLSearchParams(rawQuery);
  if (segments.length === 0) return { name: "home" };
  const [head, second, third] = segments;
  if (head === "console") {
    if (second === "demands" && third === "new") {
      return { name: "demandNew", indicator: query.get("indicator") };
    }
    return { name: "console" };
  }
  if (head === "login") return { name: "login" };
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

function renderRoute(route: Route) {
  switch (route.name) {
    case "catalog":
      return <CatalogView />;
    case "catalogDetail":
      return <CatalogDetailView id={route.id} />;
    case "console":
      return <ConsoleView />;
    case "demandNew":
      return <DemandNewView indicator={route.indicator} />;
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

  const tab = (h: string, label: string, active: boolean) => (
    <a
      href={h}
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
            {tab("#/catalog", t("nav.catalog"), route.name === "catalog" || route.name === "catalogDetail")}
            {tab("#/console", t("nav.console"), route.name === "console" || route.name === "demandNew")}
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
      <main className="max-w-5xl mx-auto px-4 py-8">
        {renderRoute(route)}
      </main>
      <footer className="max-w-5xl mx-auto px-4 py-8 text-xs text-slate-400">
        {t("footer")} ·{" "}
        <a className="underline" href="https://finddatatech.cloud">
          finddatatech.cloud
        </a>
      </footer>
    </div>
  );
}
