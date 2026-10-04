import { useTranslation } from "react-i18next";
import { ChartPanel } from "../components/ChartPanel";

export function ConsoleView() {
  const { t } = useTranslation();

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("console.title")}
      </h1>
      <p className="mt-3 text-sm text-slate-500">{t("console.placeholder")}</p>
      <div className="mt-6">
        <ChartPanel title={t("console.chartTitle")} />
      </div>
    </div>
  );
}
