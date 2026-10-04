// 产物草稿页（#/console/artifacts；wire-platform-v1 任务 5.5 web 面）。
// - 五类产物（dashboard/composite_indicator/research_report/alert_rule/
//   refresh_schedule）的 draft 列表：kind 徽标 + spec 摘要 + 来源会话链接。
// - spec 查看器：格式化 JSON 可编辑 textarea；保存仅落 localStorage（本地
//   草稿）——产物真保存与物化是后续任务，页面上如实标注。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ARTIFACT_KINDS,
  fetchAllArtifacts,
  fetchConversations,
  type ArtifactKind,
  type Conversation,
  type DraftArtifact,
} from "./api";
import { artifactTitle, formatServerDate, summarizeSpec } from "./util";

const SPEC_STORAGE_PREFIX = "wire-web-artifact-spec-";

const KIND_BADGE_CLASS: Record<string, string> = {
  dashboard: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  composite_indicator: "bg-violet-50 text-violet-700 ring-violet-200",
  research_report: "bg-sky-50 text-sky-700 ring-sky-200",
  alert_rule: "bg-rose-50 text-rose-700 ring-rose-200",
  refresh_schedule: "bg-teal-50 text-teal-700 ring-teal-200",
};

export function ArtifactsPage({ customerId }: { customerId: string }) {
  const { t } = useTranslation();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [artifacts, setArtifacts] = useState<DraftArtifact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<ArtifactKind | "all">("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setConversations(null);
    setArtifacts(null);
    try {
      const convs = await fetchConversations(customerId);
      const drafts = await fetchAllArtifacts(customerId, convs);
      setConversations(convs);
      setArtifacts(drafts);
    } catch {
      setError("artifacts");
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const conversationById = useMemo(() => {
    const map = new Map<number, Conversation>();
    conversations?.forEach((c) => map.set(c.id, c));
    return map;
  }, [conversations]);

  const visible = useMemo(
    () =>
      artifacts?.filter((a) => kindFilter === "all" || a.kind === kindFilter) ?? [],
    [artifacts, kindFilter],
  );

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("console.artifacts.title")}</h1>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            {t("console.artifacts.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="artifact-kind-filter" className="text-xs text-slate-500">
            {t("console.artifacts.kindFilterLabel")}
          </label>
          <select
            id="artifact-kind-filter"
            data-testid="artifact-kind-filter"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as ArtifactKind | "all")}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="all">{t("console.artifacts.kindAll")}</option>
            {ARTIFACT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`console.artifacts.kinds.${kind}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p
        data-testid="artifacts-draft-note"
        className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700"
      >
        {t("console.artifacts.draftNote")}
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4" data-testid="artifacts-error">
          <p className="text-sm text-red-700">{t("console.artifacts.errorTitle")}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100"
          >
            {t("console.artifacts.retry")}
          </button>
        </div>
      )}

      {artifacts == null && !error && (
        <p className="mt-6 text-xs text-slate-400" data-testid="artifacts-loading">
          {t("console.artifacts.loading")}
        </p>
      )}

      {artifacts != null && visible.length === 0 && !error && (
        <div className="mt-6 rounded-lg border border-dashed border-slate-300 p-8 text-center" data-testid="artifacts-empty">
          <p className="text-sm text-slate-600">{t("console.artifacts.empty")}</p>
          <p className="mt-1 text-xs text-slate-400">{t("console.artifacts.emptyHint")}</p>
        </div>
      )}

      {visible.length > 0 && (
        <ul data-testid="artifact-list" className="mt-4 space-y-2">
          {visible.map((artifact) => {
            const conv = conversationById.get(artifact.conversation_id);
            return (
              <li
                key={artifact.id}
                data-testid="artifact-item"
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    data-testid="artifact-kind-badge"
                    data-kind={artifact.kind}
                    className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
                      KIND_BADGE_CLASS[artifact.kind] ??
                      "bg-slate-100 text-slate-600 ring-slate-200"
                    }`}
                  >
                    {t(`console.artifacts.kinds.${artifact.kind}`, artifact.kind)}
                  </span>
                  <span
                    data-testid="artifact-draft-badge"
                    className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700"
                  >
                    {t("console.artifacts.draftBadge")}
                  </span>
                  <span className="text-sm font-medium text-slate-800" data-testid="artifact-title">
                    {artifactTitle(artifact, `${artifact.kind} #${artifact.id}`)}
                  </span>
                  <button
                    type="button"
                    data-testid="artifact-view"
                    onClick={() => setSelectedId(artifact.id === selectedId ? null : artifact.id)}
                    className="ml-auto rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    {t("console.artifacts.viewSpec")}
                  </button>
                </div>
                <p
                  data-testid="artifact-spec-summary"
                  className="mt-2 truncate font-mono text-[11px] text-slate-500"
                  title={JSON.stringify(artifact.spec)}
                >
                  {summarizeSpec(artifact.spec)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <span>{formatServerDate(artifact.created_at)}</span>
                  <span>·</span>
                  <span>{t("console.artifacts.source")}</span>
                  <a
                    data-testid="artifact-source-link"
                    href={`#/console/chat?c=${artifact.conversation_id}`}
                    className="text-slate-600 underline decoration-dotted hover:text-slate-900"
                  >
                    {conv ? conv.title : `#${artifact.conversation_id}`}
                  </a>
                </div>
                {artifact.id === selectedId && (
                  <SpecViewer key={artifact.id} artifact={artifact} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SpecViewer({ artifact }: { artifact: DraftArtifact }) {
  const { t } = useTranslation();
  const storageKey = `${SPEC_STORAGE_PREFIX}${artifact.id}`;
  const original = JSON.stringify(artifact.spec, null, 2);
  const [text, setText] = useState(original);
  const [fromLocal, setFromLocal] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const local = localStorage.getItem(storageKey);
      if (local != null) {
        setText(local);
        setFromLocal(true);
      }
    } catch {
      /* localStorage 不可用：仅展示原始 spec */
    }
    // 重置其余编辑态
    setInvalid(false);
    setSaved(false);
  }, [storageKey, original]);

  const saveLocal = () => {
    try {
      JSON.parse(text);
    } catch {
      setInvalid(true);
      setSaved(false);
      return;
    }
    setInvalid(false);
    try {
      localStorage.setItem(storageKey, text);
    } catch {
      /* 存不进去时仅本次会话可见 */
    }
    setSaved(true);
    setFromLocal(true);
  };

  const restoreOriginal = () => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* 同上 */
    }
    setText(original);
    setFromLocal(false);
    setSaved(false);
    setInvalid(false);
  };

  return (
    <div data-testid="artifact-viewer" className="mt-3 rounded-md border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{t("console.artifacts.viewer.title")}</h2>
        {fromLocal && (
          <span data-testid="local-draft-badge" className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
            {t("console.artifacts.viewer.localDraft")}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            data-testid="spec-save-local"
            onClick={saveLocal}
            className="rounded bg-slate-900 px-3 py-1 text-xs text-white hover:bg-slate-700"
          >
            {t("console.artifacts.viewer.saveLocal")}
          </button>
          <button
            type="button"
            data-testid="spec-restore-original"
            onClick={restoreOriginal}
            className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
          >
            {t("console.artifacts.viewer.restoreOriginal")}
          </button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        {t("console.artifacts.viewer.note")}
      </p>
      {saved && (
        <p data-testid="spec-saved-hint" className="mt-1 text-[11px] text-emerald-600">
          {t("console.artifacts.viewer.saved")}
        </p>
      )}
      {invalid && (
        <p data-testid="spec-invalid-json" className="mt-1 text-[11px] text-red-600">
          {t("console.artifacts.viewer.invalidJson")}
        </p>
      )}
      <textarea
        data-testid="spec-editor"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
          setInvalid(false);
        }}
        rows={Math.min(20, Math.max(8, text.split("\n").length + 1))}
        spellCheck={false}
        className="mt-2 w-full resize-y rounded-md border border-slate-300 bg-white p-3 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
      />
    </div>
  );
}
