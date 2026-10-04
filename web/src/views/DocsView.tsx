// 文档页（#/docs）——三节：快速开始 / 计量与计费 / 需求单流程。
// 如实呈现纪律：未上线能力（控制台分析构建、cell 开通、需求单提交）
// 一律挂「上线中 · 即将开放」徽标，不以已上线口吻陈述。
import { useTranslation } from "react-i18next";

/** MCP 端点占位（wire-platform URL 契约：单域 /mcp 反代 registry wire 入口）。 */
export const MCP_ENDPOINT = "https://wire.finddatatech.cloud/mcp";

const DEMAND_STEPS = [
  "docs.demands.step1",
  "docs.demands.step2",
  "docs.demands.step3",
  "docs.demands.step4",
  "docs.demands.step5",
  "docs.demands.step6",
  "docs.demands.step7",
] as const;

function ComingSoonBadge() {
  const { t } = useTranslation();
  return (
    <span
      data-testid="coming-soon-badge"
      className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700"
    >
      {t("badge.comingSoon")}
    </span>
  );
}

function StatusRow({ label }: { label: string }) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-slate-600">{label}</span>
      <ComingSoonBadge />
    </li>
  );
}

export function DocsView() {
  const { t } = useTranslation();

  const meteringPoints = [
    { title: t("docs.metering.rowsTitle"), desc: t("docs.metering.rowsDesc") },
    {
      title: t("docs.metering.exploreTitle"),
      desc: t("docs.metering.exploreDesc"),
    },
    {
      title: t("docs.metering.alertTitle"),
      desc: t("docs.metering.alertDesc"),
    },
    {
      title: t("docs.metering.hardStopTitle"),
      desc: t("docs.metering.hardStopDesc"),
    },
  ];

  return (
    <div className="space-y-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("docs.title")}
        </h1>
        <p className="mt-2 text-sm text-slate-500">{t("docs.subtitle")}</p>
      </header>

      {/* 一、快速开始 */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">{t("docs.quickStart.title")}</h2>
        <div className="rounded-lg border border-slate-200 p-5 space-y-4">
          <div>
            <h3 className="font-medium">{t("docs.quickStart.mcpTitle")}</h3>
            <p className="mt-1 text-sm text-slate-500">
              {t("docs.quickStart.mcpDesc")}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {t("docs.quickStart.mcpEndpointLabel")}
            </p>
            <code
              data-testid="mcp-endpoint"
              className="mt-1 inline-block rounded bg-slate-50 px-2 py-1 font-mono text-xs ring-1 ring-slate-200"
            >
              {MCP_ENDPOINT}
            </code>
          </div>
          <div className="border-t border-slate-100 pt-4">
            <h3 className="font-medium">{t("docs.quickStart.keyTitle")}</h3>
            <p className="mt-1 text-sm text-slate-500">
              {t("docs.quickStart.keyDesc")}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {t("docs.quickStart.keyExampleLabel")}
            </p>
            <code className="mt-1 inline-block rounded bg-slate-50 px-2 py-1 font-mono text-xs ring-1 ring-slate-200">
              Authorization: Bearer &lt;wire-api-key&gt;
            </code>
            <div className="mt-3">
              <a
                href="#/console"
                className="text-sm text-slate-600 underline hover:text-slate-900"
              >
                {t("docs.quickStart.consoleLink")}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* 二、计量与计费 */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">{t("docs.metering.title")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {meteringPoints.map((p) => (
            <div key={p.title} className="rounded-lg border border-slate-200 p-5">
              <h3 className="font-medium">{p.title}</h3>
              <p className="mt-2 text-sm text-slate-500">{p.desc}</p>
            </div>
          ))}
        </div>
        <a
          href="#/pricing"
          className="inline-block text-sm text-slate-600 underline hover:text-slate-900"
        >
          {t("docs.metering.pricingNote")}
        </a>
      </section>

      {/* 三、需求单流程（八态状态机步骤条） */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">{t("docs.demands.title")}</h2>
        <p className="text-sm text-slate-500">{t("docs.demands.intro")}</p>
        <div className="rounded-lg border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-400">
            {t("docs.demands.stepsTitle")}
          </h3>
          <ol className="mt-4 flex flex-wrap items-start gap-y-3">
            {DEMAND_STEPS.map((key, i) => (
              <li
                key={key}
                data-testid={`demand-step-${i + 1}`}
                className="flex items-center gap-2"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-medium text-white">
                  {i + 1}
                </span>
                <span className="text-sm text-slate-700">{t(key)}</span>
                {i < DEMAND_STEPS.length - 1 && (
                  <span aria-hidden className="mx-2 h-px w-6 bg-slate-300" />
                )}
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-slate-400">
            {t("docs.demands.rejectedNote")}
          </p>
        </div>
      </section>

      {/* 能力上线状态——如实呈现，未上线不发卡 */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-400">
          {t("docs.statusTitle")}
        </h2>
        <ul className="space-y-2">
          <StatusRow label={t("docs.statusConsoleLabel")} />
          <StatusRow label={t("docs.demands.cellLabel")} />
          <StatusRow label={t("docs.statusDemandLabel")} />
        </ul>
      </section>
    </div>
  );
}
