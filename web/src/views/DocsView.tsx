// 文档页（#/docs）——四节：快速开始 / 计量与计费 / 数据面 REST / 需求单流程，
// 另加「我的数据与连接器」客户教程（wire-connector-distribution 任务 4）。
// 如实呈现纪律：未上线能力（cell 开通）挂「上线中 · 即将开放」徽标，不以
// 已上线口吻陈述；需求单提交已上线（wire-ux-consolidation 任务 4.1）。
// 需求单流程为三态机（submitted → in_progress → delivered，另 rejected），
// 八态工作流旧态名不再出现在客户面文案（任务 3.5 同步）。
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

/** MCP 端点占位（wire-platform URL 契约：单域 /mcp 反代 registry wire 入口）。 */
export const MCP_ENDPOINT = "https://wire.finddatatech.cloud/mcp";

const DEMAND_STEPS = [
  "docs.demands.step1",
  "docs.demands.step2",
  "docs.demands.step3",
] as const;

const UPLOAD_STEPS = [
  "docs.localData.uploadStep1",
  "docs.localData.uploadStep2",
  "docs.localData.uploadStep3",
] as const;

const CONNECTOR_STEPS = [
  "docs.localData.connectorStep1",
  "docs.localData.connectorStep2",
  "docs.localData.connectorStep3",
] as const;

/** 常驻配置样例（deploy/README.md「连接器」段的客户面提炼；字面配置不进 i18n）。 */
const SYSTEMD_SAMPLE = `[Unit]
Description=fd-wire connector (outbound only)
After=network-online.target

[Service]
ExecStart=/usr/local/bin/fd-wire-connector run --config /etc/fd-wire-connector/config.json
Restart=always
User=fdwire

[Install]
WantedBy=multi-user.target`;

const NSSM_SAMPLE = `nssm install fd-wire-connector "C:\\Tools\\fd-wire-connector.exe" run
nssm set fd-wire-connector AppDirectory "C:\\Tools"
nssm start fd-wire-connector`;

const LAUNCHD_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.finddata.fd-wire-connector</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/fd-wire-connector</string>
    <string>run</string>
  </array>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
</dict></plist>`;

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

const DATA_PLANE_ENDPOINTS: ReadonlyArray<{
  method: string;
  path: string;
  purposeKey: string;
}> = [
  { method: "POST", path: "/api/v1/datasets", purposeKey: "docs.dataPlane.purposeCreate" },
  { method: "POST", path: "/api/v1/datasets/{id}/query", purposeKey: "docs.dataPlane.purposeQuery" },
  { method: "POST", path: "/api/v1/datasets/{id}/aggregate", purposeKey: "docs.dataPlane.purposeAggregate" },
  { method: "POST", path: "/api/v1/datasets/{id}/rows:batchWrite", purposeKey: "docs.dataPlane.purposeWrite" },
  { method: "POST", path: "/api/v1/datasets/{id}/columns", purposeKey: "docs.dataPlane.purposeColumn" },
  { method: "POST", path: "/api/v1/datasets/{id}/derive", purposeKey: "docs.dataPlane.purposeDerive" },
  { method: "POST", path: "/api/v1/datasets/{id}/join", purposeKey: "docs.dataPlane.purposeJoin" },
  { method: "GET", path: "/api/v1/datasets/{id}/lineage", purposeKey: "docs.dataPlane.purposeLineage" },
];

export function DocsView() {
  const { t } = useTranslation();

  // 深链锚点（wire-connector-distribution 任务 4.2）：配对向导链到
  // #/docs?section=local-data——hash 路由不吃 #anchor，进页后手动定位。
  useEffect(() => {
    if (window.location.hash.includes("section=local-data")) {
      document
        .getElementById("local-data")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

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

      {/* 四、数据面 REST API（wire-customer-data-engine 7.3）：端点族 + 持钥纪律 */}
      <section className="space-y-4" data-testid="docs-data-plane">
        <h2 className="text-xl font-semibold">{t("docs.dataPlane.title")}</h2>
        <p className="max-w-3xl text-sm text-slate-500">
          {t("docs.dataPlane.intro")}
        </p>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs text-slate-400">
                <th className="px-4 py-2 font-medium">
                  {t("docs.dataPlane.colMethod")}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("docs.dataPlane.colEndpoint")}
                </th>
                <th className="px-4 py-2 font-medium">
                  {t("docs.dataPlane.colPurpose")}
                </th>
              </tr>
            </thead>
            <tbody>
              {DATA_PLANE_ENDPOINTS.map((e) => (
                <tr key={e.path} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">
                    {e.method}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-800">
                    {e.path}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {t(e.purposeKey)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-lg border border-slate-200 p-5">
          <h3 className="font-medium">{t("docs.dataPlane.keyTitle")}</h3>
          <p className="mt-1 text-sm text-slate-500">
            {t("docs.dataPlane.keyDesc")}
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-slate-500">
            <li>{t("docs.dataPlane.rule1")}</li>
            <li>{t("docs.dataPlane.rule2")}</li>
            <li>{t("docs.dataPlane.rule3")}</li>
            <li>{t("docs.dataPlane.rule4")}</li>
          </ul>
          <a
            href="#/console/keys"
            className="mt-3 inline-block text-sm text-slate-600 underline hover:text-slate-900"
          >
            {t("docs.dataPlane.consoleLink")}
          </a>
        </div>
        <p className="max-w-3xl text-xs text-slate-400">
          {t("docs.dataPlane.mcpNote")}
        </p>
      </section>

      {/* 五、我的数据与连接器（wire-connector-distribution 任务 4）：
          上传三步 / 连接器安装三步 / 常驻方式（systemd/nssm/launchd）/
          故障排查——面向客户的口径，运维细节留在 deploy/README.md。 */}
      <section
        id="local-data"
        data-testid="docs-local-data"
        className="space-y-4"
      >
        <h2 className="text-xl font-semibold">{t("docs.localData.title")}</h2>
        <p className="max-w-3xl text-sm text-slate-500">
          {t("docs.localData.intro")}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-5">
            <h3 className="font-medium">{t("docs.localData.uploadTitle")}</h3>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-500">
              {UPLOAD_STEPS.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ol>
          </div>
          <div className="rounded-lg border border-slate-200 p-5">
            <h3 className="font-medium">
              {t("docs.localData.connectorTitle")}
            </h3>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-500">
              {CONNECTOR_STEPS.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ol>
          </div>
        </div>

        <div
          data-testid="docs-local-data-residency"
          className="rounded-lg border border-slate-200 p-5"
        >
          <h3 className="font-medium">{t("docs.localData.residencyTitle")}</h3>
          <p className="mt-1 text-sm text-slate-500">
            {t("docs.localData.residencyIntro")}
          </p>
          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            <div>
              <h4 className="text-xs font-medium text-slate-600">
                {t("docs.localData.systemdTitle")}
              </h4>
              <p className="mt-1 text-xs text-slate-500">
                {t("docs.localData.systemdNote")}
              </p>
              <pre className="mt-1.5 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-700 ring-1 ring-slate-200">
                {SYSTEMD_SAMPLE}
              </pre>
            </div>
            <div>
              <h4 className="text-xs font-medium text-slate-600">
                {t("docs.localData.nssmTitle")}
              </h4>
              <p className="mt-1 text-xs text-slate-500">
                {t("docs.localData.nssmNote")}
              </p>
              <pre className="mt-1.5 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-700 ring-1 ring-slate-200">
                {NSSM_SAMPLE}
              </pre>
            </div>
            <div>
              <h4 className="text-xs font-medium text-slate-600">
                {t("docs.localData.launchdTitle")}
              </h4>
              <p className="mt-1 text-xs text-slate-500">
                {t("docs.localData.launchdNote")}
              </p>
              <pre className="mt-1.5 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-700 ring-1 ring-slate-200">
                {LAUNCHD_SAMPLE}
              </pre>
            </div>
          </div>
        </div>

        <div
          data-testid="docs-local-data-troubleshooting"
          className="rounded-lg border border-slate-200 p-5"
        >
          <h3 className="font-medium">
            {t("docs.localData.troubleshootTitle")}
          </h3>
          <ul className="mt-3 space-y-1.5 text-sm text-slate-500">
            <li>{t("docs.localData.troubleshootWarnings")}</li>
            <li>{t("docs.localData.troubleshootDrift")}</li>
            <li>{t("docs.localData.troubleshootRows")}</li>
            <li>{t("docs.localData.troubleshootRevoked")}</li>
          </ul>
        </div>

        <a
          href="#/console/datasets"
          data-testid="docs-local-data-console-link"
          className="inline-block text-sm text-slate-600 underline hover:text-slate-900"
        >
          {t("docs.localData.consoleLink")}
        </a>
      </section>

      {/* 三、需求单流程（三态状态机步骤条） */}
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

      {/* 能力上线状态——如实呈现，未上线不发卡。控制台（AI 对话构建/我的数据/
          产物预览）已上线，不再挂「上线中」徽标（wire-self-serve-launch 7.3/7.4）；
          需求单提交已上线（wire-ux-consolidation 4.1），仅 cell 开通保留徽标。 */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-400">
          {t("docs.statusTitle")}
        </h2>
        <ul className="space-y-2">
          <StatusRow label={t("docs.demands.cellLabel")} />
          <li className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-600">
              {t("docs.statusDemandLabel")}
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
