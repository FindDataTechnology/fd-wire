// 数据集详情（wire-customer-local-data 任务组 3，四块）：
// 预览网格（分页/双击改值/删行/加行 → 修正层）、修正历史（悬空徽标+单条回滚）、
// 同步历史（失败原因；漂移暂停行确认列并恢复）、悬空清单（逐条回滚）。
// 契约：openspec/changes/wire-customer-local-data/reports/interfaces.md §3.3/§4。
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  addCorrection,
  apiErrorText,
  deleteDataset,
  fetchCorrections,
  fetchDataset,
  fetchDatasetRows,
  fetchSyncs,
  resumeDataset,
  revertCorrection,
  type Correction,
  type CorrectionInput,
  type Dataset,
  type DatasetRows,
  type SyncRecord,
  type SyncStatus,
} from "./api";
import { formatServerDate } from "./util";

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
  customerId,
  datasetId,
  onBack,
}: {
  customerId: string;
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
      setDataset(await fetchDataset(customerId, datasetId));
    } catch {
      setDataset(null);
      setError(true);
    }
  }, [customerId, datasetId]);

  const loadCorrections = useCallback(async () => {
    try {
      setCorrections(await fetchCorrections(customerId, datasetId));
    } catch {
      setCorrections([]);
    }
  }, [customerId, datasetId]);

  const loadSyncs = useCallback(async () => {
    try {
      setSyncs(await fetchSyncs(customerId, datasetId));
    } catch {
      setSyncs([]);
    }
  }, [customerId, datasetId]);

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
      await revertCorrection(customerId, datasetId, correctionId);
      afterCorrection();
    },
    [customerId, datasetId, afterCorrection],
  );

  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteDataset(customerId, datasetId);
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
        customerId={customerId}
        datasetId={datasetId}
        version={previewVersion}
        onChanged={afterCorrection}
      />
      <CorrectionsPanel corrections={corrections} revert={revert} />
      <SyncsPanel
        customerId={customerId}
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
    </div>
  );
}

function PreviewGrid({
  customerId,
  datasetId,
  version,
  onChanged,
}: {
  customerId: string;
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
      setData(await fetchDatasetRows(customerId, datasetId, page, PAGE_SIZE));
    } catch {
      setData(null);
      setLoadError(true);
    }
  }, [customerId, datasetId, page]);

  useEffect(() => {
    setData(null);
    setEditing(null);
    void load();
  }, [load, version]);

  const submit = async (payload: CorrectionInput): Promise<boolean> => {
    setBusy(true);
    setOpError(null);
    try {
      await addCorrection(customerId, datasetId, payload);
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
  customerId,
  datasetId,
  dataset,
  syncs,
  onResumed,
}: {
  customerId: string;
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
        customerId,
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