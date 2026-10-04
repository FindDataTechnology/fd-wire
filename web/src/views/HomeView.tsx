// 官网首页（#/）——柏讯产品叙事：hero + 三条价值主张 + 双 CTA + wire 线站位一句。
// 联系开通为 mailto 占位（正式商留通道后续接入）。
import { useTranslation } from "react-i18next";

export const CONTACT_MAILTO = "mailto:wire@finddatatech.cloud";

export function HomeView() {
  const { t } = useTranslation();

  const values = [
    { title: t("home.value1Title"), desc: t("home.value1Desc") },
    { title: t("home.value2Title"), desc: t("home.value2Desc") },
    { title: t("home.value3Title"), desc: t("home.value3Desc") },
  ];

  return (
    <div>
      <section className="py-14 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">
          {t("home.heroTitle")}
        </h1>
        <p className="mt-4 text-slate-500 max-w-2xl mx-auto">
          {t("home.heroSubtitle")}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href="#/catalog"
            data-testid="home-cta-catalog"
            className="rounded-md bg-slate-900 text-white px-5 py-2.5 text-sm hover:bg-slate-700 transition-colors"
          >
            {t("home.ctaCatalog")}
          </a>
          <a
            href={CONTACT_MAILTO}
            data-testid="home-cta-contact"
            className="rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm hover:bg-slate-100 transition-colors"
          >
            {t("home.ctaContact")}
          </a>
        </div>
      </section>
      <section>
        <h2 className="text-sm font-medium text-slate-400 mb-4">
          {t("home.valueTitle")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {values.map((v) => (
            <div
              key={v.title}
              className="rounded-lg border border-slate-200 p-5"
            >
              <h3 className="font-medium">{v.title}</h3>
              <p className="mt-2 text-sm text-slate-500">{v.desc}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="mt-12 border-t border-slate-200 pt-6 text-center">
        <p className="text-sm text-slate-400">{t("home.lineNote")}</p>
      </section>
    </div>
  );
}
