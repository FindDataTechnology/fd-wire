// 控制台「我的数据」页（#/console/datasets，wire-customer-local-data 任务组 3）。
// - 列表卡片：名称/来源徽标/行数/大小/同步状态（六态如实，暂停带原因）/最近更新；
//   空态引导上传。
// - 上传流：拖拽或选择文件 → 上传解析预览（列名+推断类型+行数）→ 命名建档 → 刷新。
// - 连接器管理在 DatasetsConnectors.tsx、数据集详情在 DatasetDetail.tsx（本页组合三者）。
// - 免费档边界（wire-self-serve-launch 任务 4.6）：plan_code=free 呈现升级引导
//   （CTA=联系开通 mailto），且不发起任何 cell/数据集请求——免费档无 cell 配给。
// 契约：openspec/changes/wire-customer-local-data/reports/interfaces.md §3.3/§4。
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  apiErrorText,
  createDataset,
  fetchDatasets,
  uploadDataset,
  type Dataset,
  type SyncStatus,
  type UploadPreview,
} from "./api";
import { formatServerDate } from "./util";
import { ConnectorsSection } from "./DatasetsConnectors";
import { DatasetDetail } from "./DatasetDetail";
import { CONTACT_MAILTO } from "../views/HomeView";

const SYNC_BADGE_CLASS: Record<SyncStatus, string> = {
  idle: "bg-slate-100 text-slate-600 ring-slate-200",
  syncing: "bg-sky-50 text-sky-700 ring-sky-200",
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
  paused_drift: "bg-amber-50 text-amber-700 ring-amber-200",
  paused_quota: "bg-rose-50 text-rose-700 ring-rose-200",
};

/** 字节数 → 人类可读（单位换算，非业务数字文案）。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function DatasetsPage({ planCode }: { planCode: string }) {
  const { t } = useTranslation();
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 免费档门禁：升级引导优先于一切数据请求（不为免费用户创建/查询 cell）。
  const gated = planCode === "free";

  const load = useCallback(async () => {
    setError(false);
    try {
      setDatasets(await fetchDatasets());
    } catch {
      setDatasets([]);
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (gated) return;
    setDatasets(null);
    void load();
  }, [gated, load]);

  if (!gated && selectedId != null) {
    return (
      <DatasetDetail
        datasetId={selectedId}
        onBack={() => {
          setSelectedId(null);
          void load();
        }}
      />
    );
  }

  if (gated) {
    return (
      <div
        data-testid="datasets-upgrade"
        className="max-w-xl rounded-lg border border-amber-200 bg-amber-50/50 p-8"
      >
        <h1 className="text-lg font-semibold">
          {t("console.datasets.upgrade.title")}
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          {t("console.datasets.upgrade.body")}
        </p>
        <a
          data-testid="datasets-upgrade-cta"
          href={CONTACT_MAILTO}
          className="mt-4 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
        >
          {t("console.datasets.upgrade.cta")}
        </a>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-lg font-semibold">{t("console.datasets.title")}</h1>
      <p className="mt-1 max-w-2xl text-xs text-slate-500">
        {t("console.datasets.subtitle")}
      </p>

      {error && (
        <div
          data-testid="datasets-error"
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-4"
        >
          <p className="text-sm text-red-700">{t("console.datasets.errorTitle")}</p>
          <button
            type="button"
            data-testid="datasets-retry"
            onClick={() => void load()}
            className="mt-2 rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100"
          >
            {t("console.datasets.retry")}
          </button>
        </div>
      )}

      {datasets == null && !error && (
        <p className="mt-6 text-xs text-slate-400" data-testid="datasets-loading">
          {t("console.datasets.loading")}
        </p>
      )}

      {datasets != null && datasets.length === 0 && !error && (
        <div
          data-testid="datasets-empty"
          className="mt-6 rounded-lg border border-dashed border-slate-300 p-8 text-center"
        >
          <p className="text-sm text-slate-600">{t("console.datasets.empty")}</p>
          <p className="mt-1 text-xs text-slate-400">
            {t("console.datasets.emptyHint")}
          </p>
        </div>
      )}

      {datasets != null && datasets.length > 0 && (
        <ul data-testid="dataset-list" className="mt-4 space-y-2">
          {datasets.map((dataset) => (
            <DatasetCard
              key={dataset.id}
              dataset={dataset}
              onOpen={() => setSelectedId(dataset.id)}
            />
          ))}
        </ul>
      )}

      <UploadPanel onCreated={() => void load()} />

      <ConnectorsSection onCreated={() => void load()} />
    </div>
  );
}

function DatasetCard({
  dataset,
  onOpen,
}: {
  dataset: Dataset;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li
      data-testid="dataset-card"
      data-status={dataset.sync_status}
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-testid="dataset-name"
          className="text-sm font-medium text-slate-800"
        >
          {dataset.name}
        </span>
        <span
          data-testid="dataset-source-badge"
          data-kind={dataset.source_kind}
          className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
            dataset.source_kind === "connector"
              ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
              : "bg-teal-50 text-teal-700 ring-teal-200"
          }`}
        >
          {t(`console.datasets.source.${dataset.source_kind}`)}
        </span>
        <span
          data-testid="dataset-sync-status"
          data-status={dataset.sync_status}
          className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
            SYNC_BADGE_CLASS[dataset.sync_status] ??
            "bg-slate-100 text-slate-600 ring-slate-200"
          }`}
        >
          {t(`console.datasets.syncStatus.${dataset.sync_status}`)}
        </span>
        {dataset.source_kind === "connector" &&
          (dataset.source_name || dataset.source_ref) && (
            <span
              data-testid="dataset-source-ref"
              className="font-mono text-[11px] text-slate-400"
            >
              {[dataset.source_name, dataset.source_ref]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
      </div>
      {dataset.paused_reason && (
        <p
          data-testid="dataset-paused-reason"
          className="mt-1.5 text-[11px] text-amber-700"
        >
          {t("console.datasets.pausedReason", { reason: dataset.paused_reason })}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span data-testid="dataset-rows">
          {t("console.datasets.rowCount", { count: dataset.row_count })}
        </span>
        <span>·</span>
        <span data-testid="dataset-size">
          {t("console.datasets.sizeLabel")} {formatBytes(dataset.size_bytes)}
        </span>
        <span>·</span>
        <span data-testid="dataset-updated">
          {t("console.datasets.updatedLabel")} {formatServerDate(dataset.updated_at)}
        </span>
        <button
          type="button"
          data-testid="dataset-open"
          onClick={onOpen}
          className="ml-auto rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          {t("console.datasets.openDetail")}
        </button>
      </div>
    </li>
  );
}

function UploadPanel({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  const [created, setCreated] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (file: File | null | undefined) => {
    if (!file || parsing) return;
    setParsing(true);
    setError(null);
    setPreview(null);
    setCreated(false);
    try {
      const result = await uploadDataset(file);
      setPreview(result);
      setName(file.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      setError({
        title: t("console.datasets.upload.errorTitle"),
        detail: apiErrorText(err, t("console.datasets.upload.errorTitle")),
      });
    } finally {
      setParsing(false);
    }
  };

  const create = async () => {
    if (!preview || !name.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      await createDataset({
        name: name.trim(),
        source: { kind: "upload", upload_id: preview.upload_id },
      });
      setPreview(null);
      setName("");
      setCreated(true);
      onCreated();
    } catch (err) {
      setError({
        title: t("console.datasets.upload.createErrorTitle"),
        detail: apiErrorText(err, t("console.datasets.upload.createErrorTitle")),
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <section data-testid="upload-section" className="mt-8">
      <h2 className="text-base font-semibold">{t("console.datasets.upload.title")}</h2>
      <p className="mt-1 max-w-2xl text-xs text-slate-500">
        {t("console.datasets.upload.hint")}
      </p>

      <div
        data-testid="upload-dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void handleFile(e.dataTransfer?.files?.[0]);
        }}
        className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-4 py-4"
      >
        <span className="text-xs text-slate-500">
          {t("console.datasets.upload.dropzone")}
        </span>
        <button
          type="button"
          data-testid="upload-choose"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
        >
          {t("console.datasets.upload.choose")}
        </button>
        {parsing && (
          <span data-testid="upload-parsing" className="text-xs text-slate-400">
            {t("console.datasets.upload.parsing")}
          </span>
        )}
        <input
          ref={fileInputRef}
          data-testid="upload-file-input"
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            e.target.value = "";
            void handleFile(file);
          }}
        />
      </div>

      {error && (
        <div
          data-testid="upload-error"
          className="mt-3 rounded-md border border-red-200 bg-red-50 p-3"
        >
          <p className="text-sm text-red-700">{error.title}</p>
          <p className="mt-1 break-all font-mono text-[11px] text-red-500">
            {error.detail}
          </p>
        </div>
      )}

      {created && !preview && (
        <p data-testid="upload-created" className="mt-3 text-xs text-emerald-600">
          {t("console.datasets.upload.created")}
        </p>
      )}

      {preview && (
        <div
          data-testid="upload-preview"
          className="mt-3 rounded-lg border border-slate-200 bg-white p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {t("console.datasets.upload.previewTitle")}
            </h3>
            <span
              data-testid="upload-preview-rows"
              className="text-xs text-slate-500"
            >
              {t("console.datasets.upload.previewRows", {
                count: preview.row_count,
              })}
            </span>
          </div>

          {!preview.within_limit && (
            <p
              data-testid="upload-over-limit"
              className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              {t("console.datasets.upload.overLimit")}
            </p>
          )}

          <ul data-testid="upload-preview-columns" className="mt-3 flex flex-wrap gap-2">
            {preview.columns.map((column) => (
              <li
                key={column.name}
                data-testid="upload-preview-column"
                data-column={column.name}
                data-type={column.type}
                className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600"
              >
                <span className="font-medium">{column.name}</span>
                <span className="ml-1.5 font-mono text-slate-400">
                  {column.type}
                </span>
              </li>
            ))}
          </ul>

          {preview.sample_rows.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table data-testid="upload-sample" className="text-xs">
                <thead>
                  <tr>
                    {preview.columns.map((column) => (
                      <th
                        key={column.name}
                        className="border-b border-slate-200 px-2 py-1 text-left font-medium text-slate-500"
                      >
                        {column.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample_rows.map((row, index) => (
                    <tr key={index} data-testid="upload-sample-row">
                      {preview.columns.map((column) => (
                        <td
                          key={column.name}
                          className="border-b border-slate-100 px-2 py-1 text-slate-700"
                        >
                          {row[column.name] == null ? "" : String(row[column.name])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="upload-name"
                className="block text-xs text-slate-500"
              >
                {t("console.datasets.upload.nameLabel")}
              </label>
              <input
                id="upload-name"
                data-testid="upload-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("console.datasets.upload.namePlaceholder")}
                className="mt-1 w-56 rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
            <button
              type="button"
              data-testid="upload-create"
              disabled={!name.trim() || !preview.within_limit || creating}
              onClick={() => void create()}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {creating
                ? t("console.datasets.upload.creating")
                : t("console.datasets.upload.create")}
            </button>
            <button
              type="button"
              data-testid="upload-cancel"
              onClick={() => {
                setPreview(null);
                setName("");
                setError(null);
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
            >
              {t("console.datasets.upload.cancel")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}