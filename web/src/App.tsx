// App shell: top nav (site / console, zh–en toggle) over three placeholder views.
// Hash routing, deliberately no router dependency — the face is three pages.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { HomeView } from "./views/HomeView";
import { ConsoleView } from "./views/ConsoleView";
import { LoginView } from "./views/LoginView";
import { switchLanguage, type Language } from "./i18n";

const VIEWS = {
  "#/": HomeView,
  "#/console": ConsoleView,
  "#/login": LoginView,
} as const;

export function App() {
  const { t, i18n } = useTranslation();
  const [hash, setHash] = useState(window.location.hash || "#/");

  useEffect(() => {
    const on = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const View = VIEWS[hash as keyof typeof VIEWS] ?? HomeView;

  const tab = (h: string, label: string) => (
    <a
      href={h}
      className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
        (hash === h || (h === "#/" && !(hash in VIEWS)))
          ? "bg-slate-900 text-white"
          : "hover:bg-slate-200"
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
            {tab("#/", t("nav.home"))}
            {tab("#/console", t("nav.console"))}
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
        <View />
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
