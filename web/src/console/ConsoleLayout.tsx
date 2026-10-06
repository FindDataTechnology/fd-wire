// 控制台布局：左侧栏（对话构建 / 产物 / 需求单占位 / 用量占位）+ 顶栏
// （企业标识占位 = X-Customer-Id 可编辑的开发占位值 + 登录占位）+ 内容区。
// 鉴权上线后顶栏客户标识编辑退场，由登录态提供（本组件注明「仅开发用」）。
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export type ConsoleTab = "chat" | "artifacts" | "datasets" | "demands" | "usage";

export const CONSOLE_TABS: ReadonlyArray<{
  id: ConsoleTab;
  href: string;
  labelKey: string;
  placeholder?: boolean;
}> = [
  { id: "chat", href: "#/console/chat", labelKey: "console.nav.chat" },
  { id: "artifacts", href: "#/console/artifacts", labelKey: "console.nav.artifacts" },
  {
    id: "datasets",
    href: "#/console/datasets",
    labelKey: "console.nav.datasets",
  },
  {
    id: "demands",
    href: "#/console/demands",
    labelKey: "console.nav.demands",
    placeholder: true,
  },
  {
    id: "usage",
    href: "#/console/usage",
    labelKey: "console.nav.usage",
    placeholder: true,
  },
];

export function ConsolePlaceholder({
  titleKey,
  bodyKey,
}: {
  titleKey: string;
  bodyKey: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="console-placeholder"
      className="max-w-xl rounded-lg border border-amber-200 bg-amber-50/50 p-8"
    >
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{t(titleKey)}</h1>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
          {t("badge.comingSoon")}
        </span>
      </div>
      <p className="mt-4 text-sm text-slate-600">{t(bodyKey)}</p>
    </div>
  );
}

export function ConsoleLayout({
  tab,
  customerId,
  onCustomerIdSave,
  children,
}: {
  tab: ConsoleTab;
  customerId: string;
  onCustomerIdSave: (raw: string) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(customerId);

  // 外部变更（如恢复默认）同步进编辑框。
  useEffect(() => {
    setDraft(customerId);
  }, [customerId]);

  return (
    <div className="flex min-h-[32rem] rounded-lg border border-slate-200 bg-white shadow-sm">
      <aside className="w-52 shrink-0 border-r border-slate-200 p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {t("console.title")}
        </div>
        <nav className="mt-3 flex flex-col gap-1" data-testid="console-nav">
          {CONSOLE_TABS.map((item) => (
            <a
              key={item.id}
              href={item.href}
              data-testid={`console-nav-${item.id}`}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                tab === item.id
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span>{t(item.labelKey)}</span>
              {item.placeholder && (
                <span
                  className={`ml-auto rounded px-1 py-0.5 text-[10px] ${
                    tab === item.id
                      ? "bg-white/20 text-white"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {t("badge.comingSoonShort")}
                </span>
              )}
            </a>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          data-testid="console-topbar"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 px-6 py-3"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              {t("console.topbar.org")}
            </span>
            <span
              data-testid="console-org"
              className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700"
            >
              {customerId}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label
              htmlFor="customer-id-input"
              className="text-xs text-slate-500"
            >
              {t("console.topbar.customerLabel")}
            </label>
            <input
              id="customer-id-input"
              data-testid="customer-id-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-44 rounded-md border border-slate-300 px-2 py-1 font-mono text-xs"
            />
            <button
              type="button"
              data-testid="customer-id-save"
              onClick={() => onCustomerIdSave(draft)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
            >
              {t("console.topbar.save")}
            </button>
          </div>
          <span className="text-[11px] text-amber-600">
            {t("console.topbar.customerHint")}
          </span>
          <a
            href="#/login"
            data-testid="console-login-placeholder"
            className="ml-auto rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
          >
            {t("console.topbar.login")}
          </a>
        </div>
        <div className="min-w-0 flex-1 p-6">{children}</div>
      </div>
    </div>
  );
}
