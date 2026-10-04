import { useTranslation } from "react-i18next";

export function HomeView() {
  const { t } = useTranslation();

  const features = [
    { title: t("home.featureCatalogTitle"), desc: t("home.featureCatalogDesc") },
    { title: t("home.featureConsoleTitle"), desc: t("home.featureConsoleDesc") },
    { title: t("home.featureDemandTitle"), desc: t("home.featureDemandDesc") },
  ];

  return (
    <div>
      <section className="py-12 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">
          {t("home.heroTitle")}
        </h1>
        <p className="mt-4 text-slate-500 max-w-2xl mx-auto">
          {t("home.heroSubtitle")}
        </p>
      </section>
      <section>
        <h2 className="text-sm font-medium text-slate-400 mb-4">
          {t("home.featuresTitle")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-lg border border-slate-200 p-5"
            >
              <h3 className="font-medium">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-500">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
