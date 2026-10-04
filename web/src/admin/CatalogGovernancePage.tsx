// 目录治理页（#/admin/catalog）：registered 镜像列表 + 审核意见录入/留档。
// 如实标注：镜像仅同步管道可写——状态修改在权威库侧完成，本页只看不改、
// 意见只追加（append-only）到 admin 自己的 catalog_review_notes。
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminErrorBox, AdminStates } from "./AdminLayout";
import {
  addVerifyNote,
  fetchCatalogPending,
  fetchReviewNotes,
  type IndicatorPendingItem,
  type ReviewNote,
} from "./api";

type MirrorStatus = "registered" | "verified";

export function CatalogGovernancePage({ token }: { token: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MirrorStatus>("registered");
  const [items, setItems] = useState<IndicatorPendingItem[] | null>(null);
  const [error, setError] = useState<{ status?: number; message: string; detail?: string } | null>(null);
  const [notesByIndicator, setNotesByIndicator] = useState<Record<string, ReviewNote[]>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setItems(null);
    try {
      const response = await fetchCatalogPending(token, status);
      setItems(response.items);
    } catch (err) {
      setError(err as { status?: number; message: string });
    }
  }, [token, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleNotes = async (indicatorId: string) => {
    if (openId === indicatorId) {
      setOpenId(null);
      return;
    }
    setOpenId(indicatorId);
    try {
      const notes = await fetchReviewNotes(token, indicatorId);
      setNotesByIndicator((prev) => ({ ...prev, [indicatorId]: notes }));
    } catch (err) {
      setError(err as { status?: number; message: string });
    }
  };

  const refreshNotes = async (indicatorId: string) => {
    const notes = await fetchReviewNotes(token, indicatorId);
    setNotesByIndicator((prev) => ({ ...prev, [indicatorId]: notes }));
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("admin.catalog.title")}</h1>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            {t("admin.catalog.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="catalog-status" className="text-xs text-slate-500">
            {t("admin.catalog.statusFilter")}
          </label>
          <select
            id="catalog-status"
            data-testid="catalog-status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value as MirrorStatus)}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="registered">{t("admin.catalog.registered")}</option>
            <option value="verified">{t("admin.catalog.verified")}</option>
          </select>
        </div>
      </div>

      <p
        data-testid="admin-catalog-readonly-note"
        className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700"
      >
        {t("admin.catalog.readonlyNote")}
      </p>

      {error && <AdminErrorBox error={error} onRetry={() => void load()} />}

      <AdminStates
        loading={items == null && !error}
        empty={(items?.length ?? 0) === 0 && !error}
        emptyTestId="admin-catalog-empty"
      >
        {items != null && items.length > 0 && (
          <ul data-testid="admin-catalog-list" className="mt-4 space-y-2">
          {items!.map((item) => (
            <li
              key={item.indicator_id}
              data-testid="admin-catalog-item"
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-400">{item.code}</span>
                <span className="text-sm font-medium text-slate-800">
                  {item.name_zh ?? item.name_en ?? item.indicator_id}
                </span>
                <span
                  data-testid="admin-catalog-status-badge"
                  className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
                    item.status === "registered"
                      ? "bg-amber-50 text-amber-700 ring-amber-200"
                      : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  }`}
                >
                  {item.status === "registered"
                    ? t("admin.catalog.registered")
                    : t("admin.catalog.verified")}
                </span>
                {item.domain && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                    {item.domain}
                  </span>
                )}
                <button
                  type="button"
                  data-testid="admin-catalog-notes-toggle"
                  onClick={() => void toggleNotes(item.indicator_id)}
                  className="ml-auto rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  {t("admin.catalog.notesToggle", {
                    count: notesByIndicator[item.indicator_id]?.length ?? 0,
                  })}
                </button>
              </div>
              {openId === item.indicator_id && (
                <div
                  data-testid="admin-catalog-notes-panel"
                  className="mt-3 rounded-md border border-slate-200 bg-slate-50/60 p-4"
                >
                  <ul className="space-y-1">
                    {(notesByIndicator[item.indicator_id] ?? []).map((note) => (
                      <li
                        key={note.id}
                        data-testid="admin-catalog-note-item"
                        className="text-xs text-slate-600"
                      >
                        <span className="font-mono text-[11px] text-slate-400">
                          {note.author} · {note.created_at.slice(0, 16).replace("T", " ")}
                        </span>
                        {" — "}
                        {note.note}
                      </li>
                    ))}
                    {(notesByIndicator[item.indicator_id]?.length ?? 0) === 0 && (
                      <li className="text-xs text-slate-400">
                        {t("admin.catalog.noNotes")}
                      </li>
                    )}
                  </ul>
                  <NoteInput
                    token={token}
                    indicatorId={item.indicator_id}
                    onSaved={() => void refreshNotes(item.indicator_id)}
                    onError={(err) => setError(err)}
                  />
                </div>
              )}
            </li>
          ))}
          </ul>
        )}
      </AdminStates>
    </div>
  );
}

function NoteInput({
  token,
  indicatorId,
  onSaved,
  onError,
}: {
  token: string;
  indicatorId: string;
  onSaved: () => void;
  onError: (err: { status?: number; message: string }) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await addVerifyNote(token, indicatorId, text.trim());
      setText("");
      onSaved();
    } catch (err) {
      onError(err as { status?: number; message: string });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input
        data-testid="admin-catalog-note-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("admin.catalog.notePlaceholder")}
        className="w-72 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      <button
        type="button"
        data-testid="admin-catalog-note-submit"
        disabled={busy || !text.trim()}
        onClick={() => void submit()}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {busy ? t("admin.common.working") : t("admin.catalog.noteSubmit")}
      </button>
    </div>
  );
}
