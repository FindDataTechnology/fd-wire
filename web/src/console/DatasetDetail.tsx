// 数据集详情（wire-customer-local-data 任务组 3，四块）：
// 预览网格（分页/双击改值/删行/加行 → 修正层）、修正历史（悬空徽标+单条回滚）、
// 同步历史（失败原因；漂移暂停行确认列并恢复）、悬空清单（逐条回滚）。
// 溯源区块（wire-provenance-ledger 任务组 8）：档位/链完整性/锚定进度状态条、
// 倒序事件时间线（before_seq 加载更早）、证据包下载。
// 契约：openspec/changes/wire-customer-local-data/reports/interfaces.md §3.3/§4、
// openspec/changes/wire-provenance-ledger /api/v1/provenance/*。
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  addCorrection,
  apiErrorText,
  deleteDataset,
  fetchCorrections,
  fetchDataset,
  fetchDatasetRows,
  fetchEvidencePackage,
  fetchProvenanceEvents,
  fetchProvenanceOverview,
  fetchProvenanceStatus,
  fetchSyncs,
  PROVENANCE_TIERS,
  resumeDataset,
  revertCorrection,
  updateProvenanceTier,
  type Correction,
  type CorrectionInput,
  type Dataset,
  type DatasetRows,
  type ProvenanceEvent,
  type ProvenanceOverview,
  type ProvenanceStatus,
  type ProvenanceTier,
  type SyncRecord,
  type SyncStatus,
} from "./api";
import { formatServerDate, truncate } from "./util";

const SYNC_BADGE_CLASS: Record<SyncStatus, string> = {
  idle: "bg-slate-100 text-slate-600 ring-slate-200",
  syncing: "bg-sky-50 text-sky-700 ring-sky-200",
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
  paused_drift: "bg-amber-50 text-amber-700 ring-amber-200",
  paused_quota: "bg-rose-50 text-rose-700 ring-rose-200",
};

const PAGE_SIZE = 50;

/**
 * 从漂移暂停原因/同步错误文本中解析被拒绝的列名（如
 * `drift: 列 price 缺失，列 amount 类型变更` → ["price", "amount"]），
 * 供 resume 对话框逐列确认；解析不到时返回空集，由客户人工核对。
 */
export function driftColumns(reason: string | null | undefined): string[] {
  if (!reason) return [];
  const found: string[] = [];
  const patterns = [
    /列\s*([A-Za-z_][A-Za-z0-9_]*)/g,
    /column\s+([A-Za-z_][A-Za-z0-9_]*)/gi,
    /`([A-Za-z_][A-Za-z0-9_]*)`/g,
    /"([A-Za-z_][A-Za-z0-9_]*)"/g,
  ];
  for (const pattern of patterns) {
    for (const match of reason.matchAll(pattern)) {
      const name = match[1];
      if (name && !found.includes(name)) found.push(name);
    }
  }
  return found;
}

function describeCorrection(correction: Correction): string {
  if (correction.op === "update") {
    return `${correction.column ?? ""} = ${String(correction.value ?? "")}`;
  }
  if (correction.op === "delete") return correction.row_id ?? "";
  return JSON.stringify(correction.values ?? {});
}

export function DatasetDetail({
  datasetId,
  onBack,
}: {
  datasetId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [error, setError] = useState(false);
  const [corrections, setCorrections] = useState<Correction[] | null>(null);
  const [syncs, setSyncs] = useState<SyncRecord[] | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadDataset = useCallback(async () => {
    setError(false);
    try {
      setDataset(await fetchDataset(datasetId));
    } catch {
      setDataset(null);
      setError(true);
    }
  }, [datasetId]);

  const loadCorrections = useCallback(async () => {
    try {
      setCorrections(await fetchCorrections(datasetId));
    } catch {
      setCorrections([]);
    }
  }, [datasetId]);

  const loadSyncs = useCallback(async () => {
    try {
      setSyncs(await fetchSyncs(datasetId));
    } catch {
      setSyncs([]);
    }
  }, [datasetId]);

  useEffect(() => {
    setDataset(null);
    void loadDataset();
  }, [loadDataset]);

  useEffect(() => {
    setCorrections(null);
    void loadCorrections();
  }, [loadCorrections]);

  useEffect(() => {
    setSyncs(null);
    void loadSyncs();
  }, [loadSyncs]);

  const afterCorrection = useCallback(() => {
    setPreviewVersion((version) => version + 1);
    void loadCorrections();
  }, [loadCorrections]);

  const revert = useCallback(
    async (correctionId: number) => {
      await revertCorrection(datasetId, correctionId);
      afterCorrection();
    },
    [datasetId, afterCorrection],
  );

  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteDataset(datasetId);
      setDeleteDialogOpen(false);
      // 回列表页（onBack 内会刷新列表，删除的数据集不再出现）。
      onBack();
    } catch (err) {
      setDeleteError(apiErrorText(err, t("console.datasets.detail.deleteError")));
    } finally {
      setDeleting(false);
    }
  };

  const backButton = (
    <button
      type="button"
      data-testid="detail-back"
      onClick={onBack}
      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
    >
      ← {t("console.datasets.detail.back")}
    </button>
  );

  if (error) {
    return (
      <div>
        {backButton}
        <div
          data-testid="detail-error"
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-4"
        >
          <p className="text-sm text-red-700">
            {t("console.datasets.detail.errorTitle")}
          </p>
          <button
            type="button"
            data-testid="detail-retry"
            onClick={() => void loadDataset()}
            className="mt-2 rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100"
          >
            {t("console.datasets.retry")}
          </button>
        </div>
      </div>
    );
  }

  if (dataset == null) {
    return (
      <div>
        {backButton}
        <p className="mt-4 text-xs text-slate-400" data-testid="detail-loading">
          {t("console.datasets.detail.loading")}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="dataset-detail">
      <div className="flex flex-wrap items-center gap-2">
        {backButton}
        <h1 data-testid="detail-name" className="text-lg font-semibold">
          {dataset.name}
        </h1>
        <span
          data-testid="detail-source-badge"
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
          data-testid="detail-sync-status"
          data-status={dataset.sync_status}
          className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
            SYNC_BADGE_CLASS[dataset.sync_status] ??
            "bg-slate-100 text-slate-600 ring-slate-200"
          }`}
        >
          {t(`console.datasets.syncStatus.${dataset.sync_status}`)}
        </span>
        <button
          type="button"
          data-testid="detail-delete"
          onClick={() => {
            setDeleteError(null);
            setDeleteDialogOpen(true);
          }}
          className="ml-auto rounded border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
        >
          {t("console.datasets.detail.deleteDataset")}
        </button>
      </div>
      <p className="mt-1 font-mono text-[11px] text-slate-400">{dataset.key}</p>

      {deleteDialogOpen && (
        <div
          data-testid="delete-dialog"
          role="dialog"
          className="mt-3 rounded-lg border border-rose-200 bg-rose-50/60 p-4"
        >
          <h3 className="text-sm font-semibold text-rose-800">
            {t("console.datasets.detail.deleteTitle")}
          </h3>
          <p data-testid="delete-warning" className="mt-1.5 text-xs text-slate-600">
            {t("console.datasets.detail.deleteWarning")}
          </p>
          {dataset.source_kind === "connector" && (
            <p
              data-testid="delete-connector-warning"
              className="mt-1 text-xs text-amber-700"
            >
              {t("console.datasets.detail.deleteConnectorWarning")}
            </p>
          )}
          {deleteError && (
            <p data-testid="delete-error" className="mt-1.5 text-xs text-red-600">
              {deleteError}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              data-testid="delete-confirm"
              disabled={deleting}
              onClick={() => void confirmDelete()}
              className="rounded bg-rose-600 px-3 py-1 text-xs text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-300"
            >
              {deleting
                ? t("console.datasets.detail.deleting")
                : t("console.datasets.detail.deleteConfirm")}
            </button>
            <button
              type="button"
              data-testid="delete-cancel"
              onClick={() => setDeleteDialogOpen(false)}
              className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              {t("console.datasets.detail.cancel")}
            </button>
          </div>
        </div>
      )}

      <PreviewGrid
        datasetId={datasetId}
        version={previewVersion}
        onChanged={afterCorrection}
      />
      <CorrectionsPanel corrections={corrections} revert={revert} />
      <SyncsPanel
        datasetId={datasetId}
        dataset={dataset}
        syncs={syncs}
        onResumed={() => {
          void loadDataset();
          void loadSyncs();
          setPreviewVersion((version) => version + 1);
        }}
      />
      <DanglingPanel corrections={corrections} revert={revert} />
      <ProvenancePanel datasetKey={dataset.key} />
    </div>
  );
}

function PreviewGrid({
  datasetId,
  version,
  onChanged,
}: {
  datasetId: string;
  version: number;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<DatasetRows | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{
    rowId: string;
    column: string;
    value: string;
  } | null>(null);
  const [adding, setAdding] = useState(false);
  const [newValues, setNewValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      setData(await fetchDatasetRows(datasetId, page, PAGE_SIZE));
    } catch {
      setData(null);
      setLoadError(true);
    }
  }, [datasetId, page]);

  useEffect(() => {
    setData(null);
    setEditing(null);
    void load();
  }, [load, version]);

  const submit = async (payload: CorrectionInput): Promise<boolean> => {
    setBusy(true);
    setOpError(null);
    try {
      await addCorrection(datasetId, payload);
      return true;
    } catch (err) {
      setOpError(
        apiErrorText(err, t("console.datasets.detail.correctionError")),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const ok = await submit({
      op: "update",
      row_id: editing.rowId,
      column: editing.column,
      value: editing.value,
    });
    if (ok) {
      setEditing(null);
      onChanged();
    }
  };

  const deleteRow = async (rowId: string) => {
    const ok = await submit({ op: "delete", row_id: rowId });
    if (ok) onChanged();
  };

  const addRow = async () => {
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(newValues)) {
      if (value.trim() !== "") values[key] = value;
    }
    const ok = await submit({ op: "insert", values });
    if (ok) {
      setAdding(false);
      setNewValues({});
      onChanged();
    }
  };

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section data-testid="preview-section" className="mt-6">
      <h2 className="text-base font-semibold">
        {t("console.datasets.detail.previewTitle")}
      </h2>
      <p className="mt-1 max-w-2xl text-xs text-slate-500">
        {t("console.datasets.detail.previewHint")}
      </p>

      {opError && (
        <p data-testid="preview-op-error" className="mt-2 text-xs text-red-600">
          {opError}
        </p>
      )}

      {loadError && (
        <div data-testid="preview-error" className="mt-2">
          <p className="text-xs text-red-600">
            {t("console.datasets.detail.errorTitle")}
          </p>
          <button
            type="button"
            data-testid="preview-retry"
            onClick={() => void load()}
            className="mt-1 rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100"
          >
            {t("console.datasets.retry")}
          </button>
        </div>
      )}

      {data == null && !loadError && (
        <p data-testid="preview-loading" className="mt-2 text-xs text-slate-400">
          {t("console.datasets.detail.previewLoading")}
        </p>
      )}

      {data != null && (
        <>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table data-testid="preview-grid" className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50">
                  {data.columns.map((column) => (
                    <th
                      key={column.name}
                      data-testid="preview-header"
                      data-type={column.type}
                      className="whitespace-nowrap border-b border-slate-200 px-3 py-1.5 text-left font-medium text-slate-600"
                    >
                      {column.name}
                      <span className="ml-1.5 font-mono text-[10px] text-slate-400">
                        {column.type}
                      </span>
                    </th>
                  ))}
                  <th className="border-b border-slate-200 px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, index) => {
                  const rowId = String(row.__row_id ?? "");
                  return (
                    <tr
                      key={rowId || index}
                      data-testid="preview-row"
                      data-row-id={rowId}
                      className="hover:bg-slate-50/60"
                    >
                      {data.columns.map((column) => {
                        const isEditing =
                          editing != null &&
                          editing.rowId === rowId &&
                          editing.column === column.name;
                        return (
                          <td
                            key={column.name}
                            data-testid="preview-cell"
                            data-column={column.name}
                            data-row-id={rowId}
                            onDoubleClick={() => {
                              if (rowId && !busy) {
                                setEditing({
                                  rowId,
                                  column: column.name,
                                  value:
                                    row[column.name] == null
                                      ? ""
                                      : String(row[column.name]),
                                });
                              }
                            }}
                            className="whitespace-nowrap border-b border-slate-100 px-3 py-1 text-slate-700"
                          >
                            {isEditing ? (
                              <span className="flex items-center gap-1">
                                <input
                                  data-testid="preview-edit-input"
                                  value={editing.value}
                                  autoFocus
                                  onChange={(e) =>
                                    setEditing({
                                      ...editing,
                                      value: e.target.value,
                                    })
                                  }
                                  className="w-28 rounded border border-slate-300 px-1 py-0.5 text-xs"
                                />
                                <button
                                  type="button"
                                  data-testid="preview-edit-save"
                                  disabled={busy}
                                  onClick={() => void saveEdit()}
                                  className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-white disabled:bg-slate-300"
                                >
                                  {busy
                                    ? t("console.datasets.detail.saving")
                                    : t("console.datasets.detail.save")}
                                </button>
                                <button
                                  type="button"
                                  data-testid="preview-edit-cancel"
                                  onClick={() => setEditing(null)}
                                  className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500"
                                >
                                  {t("console.datasets.detail.cancel")}
                                </button>
                              </span>
                            ) : row[column.name] == null ? (
                              ""
                            ) : (
                              String(row[column.name])
                            )}
                          </td>
                        );
                      })}
                      <td className="border-b border-slate-100 px-2 py-1 text-right">
                        <button
                          type="button"
                          data-testid="preview-delete-row"
                          title={t("console.datasets.detail.deleteRow")}
                          disabled={!rowId || busy}
                          onClick={() => void deleteRow(rowId)}
                          className="rounded border border-rose-200 px-1.5 py-0.5 text-[10px] text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {data.rows.length === 0 && (
            <p data-testid="preview-empty" className="mt-2 text-xs text-slate-400">
              {t("console.datasets.detail.previewEmpty")}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span data-testid="preview-pagination">
              {t("console.datasets.detail.pagination", {
                total,
                page,
                pages,
              })}
            </span>
            <button
              type="button"
              data-testid="preview-prev-page"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="rounded border border-slate-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("console.datasets.detail.prev")}
            </button>
            <button
              type="button"
              data-testid="preview-next-page"
              disabled={page >= pages}
              onClick={() => setPage((current) => current + 1)}
              className="rounded border border-slate-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("console.datasets.detail.next")}
            </button>

            {!adding && (
              <button
                type="button"
                data-testid="preview-add-row"
                onClick={() => {
                  setAdding(true);
                  setNewValues({});
                }}
                className="ml-auto rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50"
              >
                {t("console.datasets.detail.addRow")}
              </button>
            )}
          </div>

          {adding && (
            <div
              data-testid="preview-add-row-panel"
              className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3"
            >
              <p className="text-xs font-medium text-slate-600">
                {t("console.datasets.detail.addRowTitle")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.columns.map((column) => (
                  <input
                    key={column.name}
                    data-testid="preview-add-row-input"
                    data-column={column.name}
                    value={newValues[column.name] ?? ""}
                    placeholder={column.name}
                    onChange={(e) =>
                      setNewValues((prev) => ({
                        ...prev,
                        [column.name]: e.target.value,
                      }))
                    }
                    className="w-32 rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  data-testid="preview-add-row-submit"
                  disabled={busy}
                  onClick={() => void addRow()}
                  className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:bg-slate-300"
                >
                  {busy
                    ? t("console.datasets.detail.saving")
                    : t("console.datasets.detail.addRowSubmit")}
                </button>
                <button
                  type="button"
                  data-testid="preview-add-row-cancel"
                  onClick={() => {
                    setAdding(false);
                    setNewValues({});
                  }}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600"
                >
                  {t("console.datasets.detail.addRowCancel")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function CorrectionsPanel({
  corrections,
  revert,
}: {
  corrections: Correction[] | null;
  revert: (correctionId: number) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doRevert = async (correctionId: number) => {
    setBusyId(correctionId);
    setError(null);
    try {
      await revert(correctionId);
    } catch (err) {
      setError(apiErrorText(err, t("console.datasets.detail.revertError")));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section data-testid="corrections-section" className="mt-6">
      <h2 className="text-base font-semibold">
        {t("console.datasets.detail.correctionsTitle")}
      </h2>
      {error && (
        <p data-testid="corrections-op-error" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
      {corrections == null && (
        <p data-testid="corrections-loading" className="mt-2 text-xs text-slate-400">
          {t("console.datasets.detail.correctionsLoading")}
        </p>
      )}
      {corrections != null && corrections.length === 0 && (
        <p data-testid="corrections-empty" className="mt-2 text-xs text-slate-400">
          {t("console.datasets.detail.correctionsEmpty")}
        </p>
      )}
      {corrections != null && corrections.length > 0 && (
        <ul data-testid="correction-list" className="mt-2 space-y-1.5">
          {corrections.map((correction) => (
            <li
              key={correction.id}
              data-testid="correction-row"
              data-op={correction.op}
              data-dangling={correction.dangling_at != null ? "true" : "false"}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              <span
                data-testid="correction-op"
                className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
              >
                {t(`console.datasets.detail.correctionOps.${correction.op}`)}
              </span>
              <span className="font-mono text-[11px] text-slate-700">
                {describeCorrection(correction)}
              </span>
              {correction.dangling_at != null && (
                <span
                  data-testid="correction-dangling-badge"
                  className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700"
                >
                  {t("console.datasets.detail.dangling")}
                </span>
              )}
              {correction.reverted_at != null && (
                <span
                  data-testid="correction-reverted-badge"
                  className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600"
                >
                  {t("console.datasets.detail.reverted")}
                </span>
              )}
              <span className="text-[11px] text-slate-400">
                {correction.actor} · {formatServerDate(correction.created_at)}
              </span>
              {correction.reverted_at == null && (
                <button
                  type="button"
                  data-testid="correction-revert"
                  disabled={busyId === correction.id}
                  onClick={() => void doRevert(correction.id)}
                  className="ml-auto rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyId === correction.id
                    ? t("console.datasets.detail.reverting")
                    : t("console.datasets.detail.revert")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SyncsPanel({
  datasetId,
  dataset,
  syncs,
  onResumed,
}: {
  datasetId: string;
  dataset: Dataset;
  syncs: SyncRecord[] | null;
  onResumed: () => void;
}) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<{ reason: string; columns: string[] } | null>(
    null,
  );
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);

  const openResume = (fallbackReason?: string | null) => {
    const reason = dataset.paused_reason ?? fallbackReason ?? "";
    const columns = driftColumns(reason);
    setDialog({ reason, columns });
    setChecked(Object.fromEntries(columns.map((column) => [column, true])));
    setResumed(false);
  };

  const confirmResume = async () => {
    if (!dialog) return;
    setBusy(true);
    setError(null);
    try {
      await resumeDataset(
        datasetId,
        dialog.columns.filter((column) => checked[column]),
      );
      setDialog(null);
      setResumed(true);
      onResumed();
    } catch (err) {
      setError(apiErrorText(err, t("console.datasets.detail.resumeError")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="syncs-section" className="mt-6">
      <h2 className="text-base font-semibold">
        {t("console.datasets.detail.syncsTitle")}
      </h2>

      {dataset.sync_status === "paused_drift" && (
        <div
          data-testid="drift-banner"
          className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
        >
          <p className="text-xs text-amber-800">
            {t("console.datasets.detail.pauseBanner")}
          </p>
          <button
            type="button"
            data-testid="drift-resume"
            onClick={() => openResume()}
            className="ml-auto rounded bg-amber-600 px-2 py-1 text-xs text-white hover:bg-amber-700"
          >
            {t("console.datasets.detail.resume")}
          </button>
        </div>
      )}

      {dataset.sync_status === "paused_quota" && (
        <p
          data-testid="quota-banner"
          className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
        >
          {t("console.datasets.detail.pauseQuotaBanner")}
        </p>
      )}

      {error && (
        <p data-testid="syncs-op-error" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
      {resumed && (
        <p data-testid="resume-done" className="mt-2 text-xs text-emerald-600">
          {t("console.datasets.detail.resumed")}
        </p>
      )}

      {syncs == null && (
        <p data-testid="syncs-loading" className="mt-2 text-xs text-slate-400">
          {t("console.datasets.detail.syncsLoading")}
        </p>
      )}
      {syncs != null && syncs.length === 0 && (
        <p data-testid="syncs-empty" className="mt-2 text-xs text-slate-400">
          {t("console.datasets.detail.syncsEmpty")}
        </p>
      )}
      {syncs != null && syncs.length > 0 && (
        <ul data-testid="sync-list" className="mt-2 space-y-1.5">
          {syncs.map((record) => (
            <li
              key={record.id}
              data-testid="sync-row"
              data-status={record.status}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              <span
                data-testid="sync-status"
                className={`rounded px-1.5 py-0.5 text-[11px] ${
                  record.status === "ok"
                    ? "bg-emerald-50 text-emerald-700"
                    : record.status === "failed"
                      ? "bg-red-50 text-red-700"
                      : "bg-amber-50 text-amber-700"
                }`}
              >
                {t(`console.datasets.detail.syncStatuses.${record.status}`)}
              </span>
              <span data-testid="sync-rows" className="text-slate-600">
                {t("console.datasets.detail.syncRows", { count: record.rows })}
              </span>
              <span className="text-[11px] text-slate-400">
                {formatServerDate(record.finished_at ?? record.started_at)}
              </span>
              {record.error && (
                <span
                  data-testid="sync-error"
                  className="font-mono text-[11px] text-red-500"
                >
                  {record.error}
                </span>
              )}
              {record.status === "drift" && (
                <button
                  type="button"
                  data-testid="sync-resume"
                  onClick={() => openResume(record.error)}
                  className="ml-auto rounded bg-amber-600 px-2 py-0.5 text-[11px] text-white hover:bg-amber-700"
                >
                  {t("console.datasets.detail.resume")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {dialog && (
        <div
          data-testid="resume-dialog"
          role="dialog"
          className="mt-3 rounded-lg border border-amber-300 bg-amber-50/60 p-4"
        >
          <h3 className="text-sm font-semibold">
            {t("console.datasets.detail.resumeTitle")}
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            {t("console.datasets.detail.resumeHint")}
          </p>
          {dialog.reason && (
            <p
              data-testid="resume-reason"
              className="mt-2 font-mono text-[11px] text-slate-500"
            >
              {dialog.reason}
            </p>
          )}
          {dialog.columns.length === 0 ? (
            <p data-testid="resume-columns-empty" className="mt-2 text-[11px] text-slate-500">
              {t("console.datasets.detail.resumeColumnsEmpty")}
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {dialog.columns.map((column) => (
                <li key={column}>
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      data-testid="resume-column"
                      data-column={column}
                      checked={checked[column] !== false}
                      onChange={(e) =>
                        setChecked((prev) => ({
                          ...prev,
                          [column]: e.target.checked,
                        }))
                      }
                    />
                    <span className="font-mono">{column}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              data-testid="resume-confirm"
              disabled={busy}
              onClick={() => void confirmResume()}
              className="rounded bg-amber-600 px-3 py-1 text-xs text-white hover:bg-amber-700 disabled:bg-amber-300"
            >
              {busy
                ? t("console.datasets.detail.resuming")
                : t("console.datasets.detail.resumeConfirm")}
            </button>
            <button
              type="button"
              data-testid="resume-cancel"
              onClick={() => setDialog(null)}
              className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600"
            >
              {t("console.datasets.detail.resumeCancel")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function DanglingPanel({
  corrections,
  revert,
}: {
  corrections: Correction[] | null;
  revert: (correctionId: number) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dangling = (corrections ?? []).filter(
    (correction) => correction.dangling_at != null && correction.reverted_at == null,
  );

  const doRevert = async (correctionId: number) => {
    setBusyId(correctionId);
    setError(null);
    try {
      await revert(correctionId);
    } catch (err) {
      setError(apiErrorText(err, t("console.datasets.detail.revertError")));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section data-testid="dangling-section" className="mt-6">
      <h2 className="text-base font-semibold">
        {t("console.datasets.detail.danglingTitle")}
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        {t("console.datasets.detail.danglingHint")}
      </p>
      {error && (
        <p data-testid="dangling-op-error" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
      {corrections == null && (
        <p data-testid="dangling-loading" className="mt-2 text-xs text-slate-400">
          {t("console.datasets.detail.correctionsLoading")}
        </p>
      )}
      {corrections != null && dangling.length === 0 && (
        <p data-testid="dangling-empty" className="mt-2 text-xs text-slate-400">
          {t("console.datasets.detail.danglingEmpty")}
        </p>
      )}
      {dangling.length > 0 && (
        <ul data-testid="dangling-list" className="mt-2 space-y-1.5">
          {dangling.map((correction) => (
            <li
              key={correction.id}
              data-testid="dangling-item"
              data-op={correction.op}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-amber-200 bg-amber-50/50 px-3 py-2 text-xs"
            >
              <span
                data-testid="dangling-badge"
                className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700"
              >
                {t("console.datasets.detail.dangling")}
              </span>
              <span className="font-mono text-[11px] text-slate-700">
                {describeCorrection(correction)}
              </span>
              {correction.dangling_reason && (
                <span className="text-[11px] text-slate-500">
                  {correction.dangling_reason}
                </span>
              )}
              <button
                type="button"
                data-testid="dangling-revert"
                disabled={busyId === correction.id}
                onClick={() => void doRevert(correction.id)}
                className="ml-auto rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyId === correction.id
                  ? t("console.datasets.detail.reverting")
                  : t("console.datasets.detail.revert")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
// ── 溯源区块（wire-provenance-ledger 任务组 8）──────────────────────────

/** 已知事件类型 → eventTypes i18n 键；cell.* 前缀归并为 cell 生命周期。 */
const PROVENANCE_EVENT_TYPE_KEYS: Record<string, string> = {
  "dataset.upload.registered": "uploadRegistered",
  "dataset.correction.added": "correctionAdded",
  "dataset.correction.reverted": "correctionReverted",
  "dataset.snapshot.refreshed": "snapshotRefreshed",
  "dataset.correction.dangling": "correctionDangling",
  "dataset.dataset.deleted": "datasetDeleted",
  "ledger.epoch.sealed": "epochSealed",
};

export function provenanceEventTypeKey(type: string): string | null {
  if (PROVENANCE_EVENT_TYPE_KEYS[type]) return PROVENANCE_EVENT_TYPE_KEYS[type];
  if (type.startsWith("cell.")) return "cellLifecycle";
  return null;
}

/** 事件负载摘要：顶层键值平铺 `k=v` 取前 4 项、长值截断，尾部 +N 计余。 */
export function summarizeProvenancePayload(
  payload: Record<string, unknown> | null | undefined,
): string {
  if (payload == null || typeof payload !== "object") return "";
  const entries = Object.entries(payload);
  const shown = entries.slice(0, 4).map(([key, value]) => {
    const text =
      value == null
        ? "null"
        : typeof value === "object"
          ? truncate(JSON.stringify(value), 48)
          : truncate(String(value), 48);
    return `${key}=${text}`;
  });
  const rest = entries.length - shown.length;
  if (rest > 0) shown.push(`+${rest}`);
  return shown.join(", ");
}

function ProvenancePanel({
  datasetKey,
}: {
  datasetKey: string;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ProvenanceStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [overview, setOverview] = useState<ProvenanceOverview | null>(null);
  const [tier, setTier] = useState<ProvenanceTier>("off");
  const [tierBusy, setTierBusy] = useState(false);
  const [tierError, setTierError] = useState<string | null>(null);
  const [events, setEvents] = useState<ProvenanceEvent[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [eventsError, setEventsError] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setStatusError(false);
    try {
      const next = await fetchProvenanceStatus(datasetKey);
      setStatus(next);
      setTier(next.tier);
    } catch {
      setStatus(null);
      setStatusError(true);
    }
  }, [datasetKey]);

  const loadEvents = useCallback(async () => {
    setEventsError(false);
    try {
      const page = await fetchProvenanceEvents(datasetKey);
      setEvents(page.events);
      setHasMore(page.has_more);
    } catch {
      setEvents(null);
      setEventsError(true);
    }
  }, [datasetKey]);

  useEffect(() => {
    setStatus(null);
    setOverview(null);
    setTierError(null);
    void loadStatus();
    fetchProvenanceOverview()
      .then(setOverview)
      .catch(() => setOverview(null));
  }, [datasetKey, loadStatus]);

  useEffect(() => {
    setEvents(null);
    setHasMore(false);
    void loadEvents();
  }, [loadEvents]);

  const changeTier = async (next: ProvenanceTier) => {
    if (tierBusy || next === tier) return;
    setTierBusy(true);
    setTierError(null);
    try {
      const result = await updateProvenanceTier(datasetKey, next);
      setTier(result.tier);
      await loadStatus();
    } catch (err) {
      setTierError(
        apiErrorText(err, t("console.datasets.detail.provenance.tierError")),
      );
    } finally {
      setTierBusy(false);
    }
  };

  const loadEarlier = async () => {
    if (events == null || events.length === 0 || loadingEarlier) return;
    const oldest = events[events.length - 1]!.seq;
    setLoadingEarlier(true);
    try {
      const page = await fetchProvenanceEvents(datasetKey, oldest);
      setEvents((prev) => [...(prev ?? []), ...page.events]);
      setHasMore(page.has_more);
    } catch {
      setEventsError(true);
    } finally {
      setLoadingEarlier(false);
    }
  };

  const downloadEvidence = async () => {
    if (evidenceBusy) return;
    setEvidenceBusy(true);
    setEvidenceError(null);
    try {
      const { blob, filename } = await fetchEvidencePackage();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setEvidenceError(
        apiErrorText(err, t("console.datasets.detail.provenance.evidenceError")),
      );
    } finally {
      setEvidenceBusy(false);
    }
  };

  const anchoredThrough = status?.anchored_through;
  const anchoringParts: string[] = [];
  if (anchoredThrough?.backend) {
    anchoringParts.push(anchoredThrough.backend);
    anchoringParts.push(
      anchoredThrough.epoch != null
        ? t("console.datasets.detail.provenance.anchoringEpoch", {
            epoch: anchoredThrough.epoch,
          })
        : t("console.datasets.detail.provenance.anchoringNotSealed"),
    );
    if (overview?.anchoring) {
      anchoringParts.push(
        t("console.datasets.detail.provenance.anchoringLag", {
          count: overview.anchoring.lag_events,
        }),
      );
    }
  } else {
    anchoringParts.push(t("console.datasets.detail.provenance.anchoringNone"));
  }

  return (
    <section data-testid="provenance-section" className="mt-6">
      <h2 className="text-base font-semibold">
        {t("console.datasets.detail.provenance.title")}
      </h2>
      <p className="mt-1 max-w-2xl text-xs text-slate-500">
        {t("console.datasets.detail.provenance.hint")}
      </p>

      {statusError && (
        <div data-testid="provenance-status-error" className="mt-2">
          <p className="text-xs text-red-600">
            {t("console.datasets.detail.provenance.statusError")}
          </p>
          <button
            type="button"
            data-testid="provenance-status-retry"
            onClick={() => void loadStatus()}
            className="mt-1 rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100"
          >
            {t("console.datasets.detail.provenance.retry")}
          </button>
        </div>
      )}

      {status == null && !statusError && (
        <p
          data-testid="provenance-status-loading"
          className="mt-2 text-xs text-slate-400"
        >
          {t("console.datasets.detail.provenance.statusLoading")}
        </p>
      )}

      {status != null && (
        <div
          data-testid="provenance-status-bar"
          className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
        >
          <label className="flex items-center gap-1.5">
            <span className="text-slate-500">
              {t("console.datasets.detail.provenance.tierLabel")}
            </span>
            <select
              data-testid="provenance-tier-select"
              data-tier={tier}
              value={tier}
              disabled={tierBusy}
              onChange={(e) => void changeTier(e.target.value as ProvenanceTier)}
              className="rounded border border-slate-300 px-1.5 py-1 text-xs disabled:bg-slate-100"
            >
              {PROVENANCE_TIERS.map((tierId) => (
                <option key={tierId} value={tierId}>
                  {t(`console.datasets.detail.provenance.tiers.${tierId}`)}
                </option>
              ))}
            </select>
          </label>
          <span
            data-testid="provenance-integrity"
            data-ok={status.integrity.ok ? "true" : "false"}
            className={`rounded-full px-2 py-0.5 ring-1 ${
              status.integrity.ok
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : "bg-red-50 text-red-700 ring-red-200"
            }`}
          >
            {status.integrity.ok
              ? t("console.datasets.detail.provenance.integrityOk")
              : t("console.datasets.detail.provenance.integrityBroken")}
            <span className="ml-1 text-[10px] opacity-70">
              {t("console.datasets.detail.provenance.integrityChecked", {
                count: status.integrity.checked,
              })}
            </span>
          </span>
          <span
            data-testid="provenance-anchoring"
            data-backend={anchoredThrough?.backend ?? ""}
            data-epoch={anchoredThrough?.epoch ?? ""}
            className="text-slate-600"
          >
            <span className="text-slate-400">
              {t("console.datasets.detail.provenance.anchoringLabel")}：
            </span>
            {anchoringParts.join(" · ")}
          </span>
          {status.note ? (
            <span
              data-testid="provenance-note"
              className="rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700"
            >
              {status.note}
            </span>
          ) : status.first_event_ts ? (
            <span
              data-testid="provenance-first-event"
              className="text-[11px] text-slate-400"
            >
              {t("console.datasets.detail.provenance.firstEvent", {
                time: formatServerDate(status.first_event_ts),
              })}
            </span>
          ) : null}
          <button
            type="button"
            data-testid="provenance-evidence-download"
            disabled={evidenceBusy}
            onClick={() => void downloadEvidence()}
            className="ml-auto rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {evidenceBusy
              ? t("console.datasets.detail.provenance.evidenceDownloading")
              : t("console.datasets.detail.provenance.evidenceDownload")}
          </button>
        </div>
      )}

      {tierError && (
        <p data-testid="provenance-tier-error" className="mt-2 text-xs text-red-600">
          {tierError}
        </p>
      )}
      {evidenceError && (
        <p
          data-testid="provenance-evidence-error"
          className="mt-2 text-xs text-red-600"
        >
          {evidenceError}
        </p>
      )}

      <h3 className="mt-4 text-sm font-medium">
        {t("console.datasets.detail.provenance.timelineTitle")}
      </h3>
      {eventsError && (
        <div data-testid="provenance-events-error" className="mt-2">
          <p className="text-xs text-red-600">
            {t("console.datasets.detail.provenance.timelineError")}
          </p>
          <button
            type="button"
            data-testid="provenance-events-retry"
            onClick={() => void loadEvents()}
            className="mt-1 rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100"
          >
            {t("console.datasets.detail.provenance.retry")}
          </button>
        </div>
      )}
      {events == null && !eventsError && (
        <p
          data-testid="provenance-timeline-loading"
          className="mt-2 text-xs text-slate-400"
        >
          {t("console.datasets.detail.provenance.timelineLoading")}
        </p>
      )}
      {events != null && events.length === 0 && !eventsError && (
        <p
          data-testid="provenance-timeline-empty"
          className="mt-2 text-xs text-slate-400"
        >
          {t("console.datasets.detail.provenance.timelineEmpty")}
        </p>
      )}
      {events != null && events.length > 0 && (
        <ul data-testid="provenance-timeline" className="mt-2 space-y-1.5">
          {events.map((event) => {
            const typeKey = provenanceEventTypeKey(event.type);
            return (
              <li
                key={event.event_id || event.seq}
                data-testid="provenance-event"
                data-type={event.type}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <span
                  data-testid="provenance-event-type"
                  className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
                >
                  {typeKey
                    ? t(`console.datasets.detail.provenance.eventTypes.${typeKey}`)
                    : event.type}
                </span>
                <span
                  data-testid="provenance-event-payload"
                  className="font-mono text-[11px] text-slate-700"
                >
                  {summarizeProvenancePayload(event.payload)}
                </span>
                <span
                  data-testid="provenance-event-actor"
                  className="text-[11px] text-slate-500"
                >
                  {event.actor.id}
                </span>
                <span
                  data-testid="provenance-event-ts"
                  className="text-[11px] text-slate-400"
                >
                  {formatServerDate(event.ts_platform)}
                </span>
                <span
                  data-testid="provenance-event-seq"
                  className="ml-auto font-mono text-[10px] text-slate-400"
                >
                  #{event.seq}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore && (
        <button
          type="button"
          data-testid="provenance-load-earlier"
          disabled={loadingEarlier}
          onClick={() => void loadEarlier()}
          className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loadingEarlier
            ? t("console.datasets.detail.provenance.loadingEarlier")
            : t("console.datasets.detail.provenance.loadEarlier")}
        </button>
      )}
    </section>
  );
}
