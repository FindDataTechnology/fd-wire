// 控制台「我的需求」页（#/console/demands，wire-ux-consolidation 任务 4.3
// 自占位转正）：本人提交的需求单只读列表。
// - 数据：GET /api/v1/demands（Bearer 登录身份；跨客户隔离由服务端按映射
//   客户保证，前端不加任何过滤参数）。
// - 呈现：状态徽章（已收到/处理中/已交付；rejected 显示「未承接」+ 理由
//   摘要）+ 提交时间 + 需求摘要；无任何迁移操作控件——派发是内部面的事。
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiErrorText, fetchMyDemands, type CustomerDemand } from "./api";

const STATUS_BADGE_CLASS: Record<string, string> = {
  submitted: "bg-slate-100 text-slate-700 ring-slate-200",
  in_progress: "bg-amber-50 text-amber-700 ring-amber-200",
  delivered: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
};

/** 状态徽章文案键（旧八态名不再出现；未知状态兜底原样展示）。 */
function statusLabel(
  translate: (key: string) => string,
  status: string,
): string {
  const key = `console.demands.statuses.${status}`;
  const label = translate(key);
  return label === key ? status : label;
}

function formatSubmittedAt(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const locale = language === "zh" ? "zh-CN" : "en-US";
  try {
    return date.toLocaleString(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function MyDemandsPage() {
  const { t, i18n } = useTranslation();
  const [demands, setDemands] = useState<CustomerDemand[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDemands(await fetchMyDemands());
    } catch (err) {
      setDemands(null);
      setError(apiErrorText(err, t("console.demands.errorTitle")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div>
        <h1 className="text-lg font-semibold">{t("console.demands.title")}</h1>
        <p className="mt-6 text-xs text-slate-400" data-testid="my-demands-loading">
          {t("console.demands.loading")}
        </p>
      </div>
    );
  }

  if (error || demands == null) {
    return (
      <div>
        <h1 className="text-lg font-semibold">{t("console.demands.title")}</h1>
        <div
          data-testid="my-demands-error"
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-4"
        >
          <p className="text-sm text-red-700">{t("console.demands.errorTitle")}</p>
          {error && (
            <p className="mt-1 break-all font-mono text-[11px] text-red-500">{error}</p>
          )}
          <button
            type="button"
            data-testid="my-demands-retry"
            onClick={() => void load()}
            className="mt-2 rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100"
          >
            {t("console.demands.retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="my-demands-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("console.demands.title")}</h1>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            {t("console.demands.subtitle")}
          </p>
        </div>
        <a
          href="#/console/demands/new"
          data-testid="my-demands-new"
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 transition-colors"
        >
          {t("console.demands.newCta")}
        </a>
      </div>

      {demands.length === 0 ? (
        <div
          data-testid="my-demands-empty"
          className="mt-6 rounded-lg border border-slate-200 bg-white p-8 text-center"
        >
          <p className="text-sm font-medium text-slate-700">
            {t("console.demands.empty")}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {t("console.demands.emptyHint")}
          </p>
        </div>
      ) : (
        <ul data-testid="my-demand-list" className="mt-4 space-y-2">
          {demands.map((demand) => (
            <li
              key={demand.id}
              data-testid="my-demand-item"
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-400">{demand.code}</span>
                <span
                  data-testid="my-demand-status"
                  data-status={demand.status}
                  className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
                    STATUS_BADGE_CLASS[demand.status] ?? STATUS_BADGE_CLASS.submitted
                  }`}
                >
                  {statusLabel(t, demand.status)}
                </span>
                <span className="ml-auto text-xs text-slate-400" data-testid="my-demand-time">
                  {t("console.demands.submittedAt", {
                    time: formatSubmittedAt(demand.created_at, i18n.language),
                  })}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-800" data-testid="my-demand-summary">
                {demand.title}
              </p>
              {demand.status === "rejected" && demand.rejection_reason && (
                <p
                  data-testid="my-demand-rejection-reason"
                  className="mt-1 text-xs text-rose-600"
                >
                  {t("console.demands.rejectedReason", {
                    reason: demand.rejection_reason,
                  })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
