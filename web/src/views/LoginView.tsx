import { useTranslation } from "react-i18next";

export function LoginView() {
  const { t } = useTranslation();

  return (
    <div className="max-w-sm mx-auto py-16">
      <div className="rounded-lg border border-slate-200 p-8 text-center">
        <h1 className="text-xl font-semibold">{t("login.title")}</h1>
        <p className="mt-3 text-sm text-slate-500">{t("login.placeholder")}</p>
        <button
          type="button"
          className="mt-6 w-full rounded-md bg-slate-900 text-white px-4 py-2 text-sm hover:bg-slate-700 transition-colors"
        >
          {t("login.cta")}
        </button>
      </div>
    </div>
  );
}
