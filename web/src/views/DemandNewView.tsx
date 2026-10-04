// 需求单提交占位页（#/console/demands/new?indicator=<code>）：
// registered 指标「按需开通」的导流落点。控制台整体属后续任务，
// 此处仅占位卡片：展示预填指标 code，说明交付路径。
import { useTranslation } from "react-i18next";

export function DemandNewView({ indicator }: { indicator: string | null }) {
  const { t } = useTranslation();

  return (
    <div className="max-w-xl mx-auto py-12">
      <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-8">
        <h1 className="text-xl font-semibold">{t("demandNew.title")}</h1>
        {indicator && (
          <div className="mt-4 flex items-center gap-2 text-sm">
            <span className="text-slate-500">{t("demandNew.prefilled")}</span>
            <code
              data-testid="demand-prefilled-code"
              className="rounded bg-white px-2 py-0.5 font-mono text-xs ring-1 ring-amber-200"
            >
              {indicator}
            </code>
          </div>
        )}
        <p className="mt-4 text-sm text-slate-600">{t("demandNew.placeholder")}</p>
        <a
          href="#/catalog"
          className="mt-6 inline-block rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-100 transition-colors"
        >
          {t("demandNew.back")}
        </a>
      </div>
    </div>
  );
}
