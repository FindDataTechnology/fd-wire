// 定价页（#/pricing）——三档卡片，中档（专业版）标「推荐」。
// 档位数字为 design.md 已裁决口径（后台可配不发版）；需求单独立报价、
// 法律域询价为脚注如实呈现。CTA 一律 mailto 占位（联系开通）。
// 目录规模数字活取 /v1/catalog/stats（千位向下取整）；取不到时回退
// 不带数字的文案——源码不携带手写指标数字面量。
import { useTranslation } from "react-i18next";
import { CONTACT_MAILTO } from "./HomeView";
import { formatCatalogTotal } from "../catalog/api";
import { useCatalogStats } from "../catalog/useCatalogStats";

type TierKey = "starter" | "pro" | "enterprise";

const TIERS: { key: TierKey; testid: string; featured: boolean }[] = [
  { key: "starter", testid: "tier-starter", featured: false },
  { key: "pro", testid: "tier-pro", featured: true },
  { key: "enterprise", testid: "tier-enterprise", featured: false },
];

export function PricingView() {
  const { t } = useTranslation();
  const stats = useCatalogStats();
  const catalogTotal = formatCatalogTotal(stats?.registered ?? 0);

  const features = [
    catalogTotal
      ? t("pricing.featCatalog", { total: catalogTotal })
      : t("pricing.featCatalogNoCount"),
    t("pricing.featMcp"),
    t("pricing.featDemand"),
  ];

  return (
    <div>
      <section className="py-10 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("pricing.title")}
        </h1>
        <p className="mt-3 text-slate-500 max-w-2xl mx-auto text-sm">
          {t("pricing.subtitle")}
        </p>
      </section>
      <section className="grid gap-4 sm:grid-cols-3 items-start">
        {TIERS.map((tier) => (
          <div
            key={tier.key}
            data-testid={tier.testid}
            className={`relative rounded-lg border p-6 ${
              tier.featured
                ? "border-slate-900 ring-1 ring-slate-900"
                : "border-slate-200"
            }`}
          >
            {tier.featured && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-slate-900 px-3 py-0.5 text-xs font-medium text-white">
                {t("pricing.recommended")}
              </span>
            )}
            <h2 className="font-medium">{t(`pricing.${tier.key}.name`)}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {t(`pricing.${tier.key}.desc`)}
            </p>
            <p className="mt-4 text-3xl font-semibold tracking-tight">
              {t(`pricing.${tier.key}.price`)}
              <span className="ml-1 text-sm font-normal text-slate-400">
                {t("pricing.perMonth")}
              </span>
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {t(`pricing.${tier.key}.rows`)}
            </p>
            <p className="text-sm text-slate-600">
              {t(`pricing.${tier.key}.overage`)}
            </p>
            <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <span
                    aria-hidden
                    className="mt-0.5 inline-block h-1.5 w-1.5 rounded-full bg-slate-400"
                  />
                  {f}
                </li>
              ))}
            </ul>
            <a
              href={CONTACT_MAILTO}
              className={`mt-6 block rounded-md px-4 py-2 text-center text-sm transition-colors ${
                tier.featured
                  ? "bg-slate-900 text-white hover:bg-slate-700"
                  : "border border-slate-300 hover:bg-slate-100"
              }`}
            >
              {t("pricing.cta")}
            </a>
          </div>
        ))}
      </section>
      <section className="mt-8 space-y-1 text-xs text-slate-400">
        <p>{t("pricing.fnDemand")}</p>
        <p>{t("pricing.fnLegal")}</p>
      </section>
    </div>
  );
}
