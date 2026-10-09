// 控制台布局：左侧栏（对话构建 / 产物 / 我的数据 / 需求单占位 / 用量）+ 顶栏
// （登录客户标识 + 当前档位 + 登出）+ 内容区。
// 身份来自登录会话（auth.ts，Authorization: Bearer）；X-Customer-Id 可编辑的
// 开发占位顶栏已退场（wire-self-serve-launch 任务 4.4）。
import { type ReactNode } from "react";
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
  // 用量页已正式化（usage-transparency 6.2）：不再是「上线中」占位。
  { id: "usage", href: "#/console/usage", labelKey: "console.nav.usage" },
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
  customerName,
  planCode,
  identity,
  onLogout,
  children,
}: {
  tab: ConsoleTab;
  /** 登录映射客户名（会话建立响应 customer.name）。 */
  customerName: string;
  /** 当前档位 code（免费档门禁/档位徽标）。 */
  planCode: string;
  /** 登录身份展示（ID token claims 的 email/username）。 */
  identity: string;
  onLogout: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();

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
              {customerName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              {t("console.topbar.plan")}
            </span>
            <span
              data-testid="console-plan"
              className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700"
            >
              {planCode}
            </span>
          </div>
          <span
            data-testid="console-identity"
            className="truncate text-xs text-slate-500"
            title={identity}
          >
            {identity}
          </span>
          <button
            type="button"
            data-testid="console-logout"
            onClick={onLogout}
            className="ml-auto rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
          >
            {t("console.topbar.logout")}
          </button>
        </div>
        <div className="min-w-0 flex-1 p-6">{children}</div>
      </div>
    </div>
  );
}
