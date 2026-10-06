// 内部后台布局（#/admin/*）：左侧栏（客户 / 账本 / 需求单 / 目录治理 / 用量）
// + 顶栏（X-Admin-Token 可编辑占位——仅开发用，注明生产由正式鉴权替换）+ 内容区。
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export type AdminSection =
  | "customers"
  | "ledger"
  | "demands"
  | "catalog"
  | "usage"
  | "localdata";

export const ADMIN_SECTIONS: ReadonlyArray<{
  id: AdminSection;
  href: string;
  labelKey: string;
}> = [
  { id: "customers", href: "#/admin/customers", labelKey: "admin.nav.customers" },
  { id: "ledger", href: "#/admin/ledger", labelKey: "admin.nav.ledger" },
  { id: "demands", href: "#/admin/demands", labelKey: "admin.nav.demands" },
  { id: "catalog", href: "#/admin/catalog", labelKey: "admin.nav.catalog" },
  { id: "usage", href: "#/admin/usage", labelKey: "admin.nav.usage" },
  {
    id: "localdata",
    href: "#/admin/localdata",
    labelKey: "admin.nav.localData",
  },
];

export function parseAdminSection(segment: string | undefined): AdminSection {
  if (
    segment === "customers" ||
    segment === "ledger" ||
    segment === "demands" ||
    segment === "catalog" ||
    segment === "usage" ||
    segment === "localdata"
  ) {
    return segment;
  }
  return "customers";
}

export function AdminLayout({
  section,
  token,
  onTokenSave,
  children,
}: {
  section: AdminSection;
  token: string;
  onTokenSave: (raw: string) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(token);

  // 外部变更（恢复默认）同步进编辑框。
  useEffect(() => {
    setDraft(token);
  }, [token]);

  return (
    <div className="flex min-h-[32rem] rounded-lg border border-slate-200 bg-white shadow-sm">
      <aside className="w-52 shrink-0 border-r border-slate-200 p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {t("admin.title")}
        </div>
        <nav className="mt-3 flex flex-col gap-1" data-testid="admin-nav">
          {ADMIN_SECTIONS.map((item) => (
            <a
              key={item.id}
              href={item.href}
              data-testid={`admin-nav-${item.id}`}
              className={`flex items-center rounded-md px-3 py-2 text-sm transition-colors ${
                section === item.id
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span>{t(item.labelKey)}</span>
            </a>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          data-testid="admin-topbar"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 px-6 py-3"
        >
          <div className="flex items-center gap-2">
            <label
              htmlFor="admin-token-input"
              className="text-xs text-slate-500"
            >
              {t("admin.topbar.tokenLabel")}
            </label>
            <input
              id="admin-token-input"
              data-testid="admin-token-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-44 rounded-md border border-slate-300 px-2 py-1 font-mono text-xs"
            />
            <button
              type="button"
              data-testid="admin-token-save"
              onClick={() => onTokenSave(draft)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
            >
              {t("admin.topbar.save")}
            </button>
          </div>
          <span className="text-[11px] text-amber-600">
            {t("admin.topbar.tokenHint")}
          </span>
          <a
            href="#/"
            data-testid="admin-exit"
            className="ml-auto rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
          >
            {t("admin.topbar.exit")}
          </a>
        </div>
        <div className="min-w-0 flex-1 p-6">{children}</div>
      </div>
    </div>
  );
}

/** 鉴权失败（401/403）与一般错误的如实呈现（含重试）。 */
export function AdminErrorBox({
  error,
  onRetry,
}: {
  error: { status?: number; message: string; detail?: string };
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const auth = error.status === 401 || error.status === 403;
  return (
    <div
      data-testid={auth ? "admin-auth-error" : "admin-error"}
      className="mt-4 rounded-md border border-red-200 bg-red-50 p-4"
    >
      <p className="text-sm font-medium text-red-700">
        {auth ? t("admin.error.authTitle") : t("admin.error.title")}
      </p>
      <p className="mt-1 text-xs text-red-600" data-testid="admin-error-detail">
        {error.detail ?? error.message}
      </p>
      {auth && (
        <p className="mt-1 text-xs text-red-500">{t("admin.error.authHint")}</p>
      )}
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100"
      >
        {t("admin.error.retry")}
      </button>
    </div>
  );
}

/** 统一的加载/空态小件（各页复用，状态齐备）。 */
export function AdminStates({
  loading,
  empty,
  emptyTestId = "admin-empty",
  children,
}: {
  loading: boolean;
  empty: boolean;
  emptyTestId?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <p className="mt-6 text-xs text-slate-400" data-testid="admin-loading">
        {t("admin.common.loading")}
      </p>
    );
  }
  if (empty) {
    return (
      <div
        data-testid={emptyTestId}
        className="mt-6 rounded-lg border border-dashed border-slate-300 p-8 text-center"
      >
        <p className="text-sm text-slate-600">{t("admin.common.empty")}</p>
      </div>
    );
  }
  return <>{children}</>;
}
