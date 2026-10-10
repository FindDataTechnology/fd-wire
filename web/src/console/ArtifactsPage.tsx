// 产物页（#/console/artifacts；wire-artifacts-persistence web 面）。
// - 列表接 GET /api/v1/artifacts（持久化产物）：kind 徽标 + 状态徽标
//   （draft/published/archived）+ 版本号 + 来源会话指针；kind/status 筛选。
// - spec 编辑保存走 PUT（成功提示新版本号）；localStorage 退位为未保存
//   离开提示的本地缓冲（自动暂存 + 可一键丢弃）；archived 只读（服务端
//   409 文案如实呈现）。
// - 版本历史抽屉：列出历史版本、查看任一版本 spec、可复制。
// - 发布/归档/恢复操作（非法迁移 409 如实呈现）。
// - dashboard kind 卡片加「查看看板」内嵌展开区（wire-dashboard-renderer）：
//   快照渲染器查看 + 编辑器切换，保存复用下方 PUT 与版本链。
// - published dashboard 卡片加「生成分享链接」弹层（wire-dashboard-share）：
//   展示公开页完整链接（origin + #/share/dashboard/…）+ 复制 + 到期时间；
//   draft/archived/非 dashboard 不出现该入口。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ARTIFACT_KINDS,
  ARTIFACT_STATUSES,
  apiErrorText,
  archiveArtifact,
  createDashboardShareLink,
  fetchArtifactVersion,
  fetchArtifactVersions,
  fetchConversations,
  fetchLifecycleArtifact,
  fetchLifecycleArtifacts,
  publishArtifact,
  restoreArtifact,
  saveArtifactSpec,
  type Artifact,
  type ArtifactKind,
  type ArtifactStatus,
  type ArtifactVersionDetail,
  type ArtifactVersionSummary,
  type Conversation,
  type DashboardShareLink,
} from "./api";
import { formatServerDate } from "./util";
import { DashboardPane } from "./dashboard/DashboardPane";

const BUFFER_STORAGE_PREFIX = "wire-web-artifact-buffer-";

const KIND_BADGE_CLASS: Record<string, string> = {
  dashboard: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  composite_indicator: "bg-violet-50 text-violet-700 ring-violet-200",
  research_report: "bg-sky-50 text-sky-700 ring-sky-200",
  alert_rule: "bg-rose-50 text-rose-700 ring-rose-200",
  refresh_schedule: "bg-teal-50 text-teal-700 ring-teal-200",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  draft: "bg-amber-100 text-amber-700",
  published: "bg-emerald-100 text-emerald-700",
  archived: "bg-slate-200 text-slate-600",
};

type StatusAction = "publish" | "archive" | "restore";

export function ArtifactsPage() {
  const { t } = useTranslation();
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<ArtifactKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ArtifactStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // 看板视图展开的产物 id（wire-dashboard-renderer：dashboard kind 内嵌入口）。
  const [dashboardFor, setDashboardFor] = useState<number | null>(null);
  const [historyFor, setHistoryFor] = useState<number | null>(null);
  // 分享弹层展开的产物 id（wire-dashboard-share：published dashboard 专属）。
  const [shareFor, setShareFor] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setArtifacts(null);
    try {
      const [rows, convs] = await Promise.all([
        fetchLifecycleArtifacts(),
        fetchConversations(),
      ]);
      setArtifacts(rows);
      setConversations(convs);
    } catch {
      setError("artifacts");
    }
  }, []);

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
      artifacts?.filter(
        (a) =>
          (kindFilter === "all" || a.kind === kindFilter) &&
          (statusFilter === "all" || a.status === statusFilter),
      ) ?? [],
    [artifacts, kindFilter, statusFilter],
  );

  const replaceArtifact = useCallback((next: Artifact) => {
    setArtifacts((prev) =>
      prev ? prev.map((a) => (a.id === next.id ? { ...a, ...next } : a)) : prev,
    );
  }, []);

  const runAction = useCallback(
    async (artifact: Artifact, action: StatusAction) => {
      setActionError(null);
      try {
        const caller =
          action === "publish"
            ? publishArtifact
            : action === "archive"
              ? archiveArtifact
              : restoreArtifact;
        replaceArtifact(await caller(artifact.id));
      } catch (err) {
        setActionError(
          apiErrorText(err, t("console.artifacts.actionErrorTitle")),
        );
      }
    },
    [replaceArtifact, t],
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
          <label htmlFor="artifact-status-filter" className="ml-2 text-xs text-slate-500">
            {t("console.artifacts.statusFilterLabel")}
          </label>
          <select
            id="artifact-status-filter"
            data-testid="artifact-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ArtifactStatus | "all")}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="all">{t("console.artifacts.statusAll")}</option>
            {ARTIFACT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`console.artifacts.statuses.${status}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

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

      {actionError && (
        <div
          data-testid="artifact-action-error"
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700"
        >
          {actionError}
        </div>
      )}

      {visible.length > 0 && (
        <ul data-testid="artifact-list" className="mt-4 space-y-2">
          {visible.map((artifact) => {
            const conv =
              artifact.origin_conversation_id != null
                ? conversationById.get(artifact.origin_conversation_id)
                : undefined;
            return (
              <li
                key={artifact.id}
                data-testid="artifact-item"
                data-artifact-id={artifact.id}
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
                    data-testid="artifact-status-badge"
                    data-status={artifact.status}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      STATUS_BADGE_CLASS[artifact.status] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {t(`console.artifacts.statuses.${artifact.status}`, artifact.status)}
                  </span>
                  <span className="text-sm font-medium text-slate-800" data-testid="artifact-title">
                    {artifact.title}
                  </span>
                  <span
                    data-testid="artifact-version"
                    className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500"
                  >
                    {t("console.artifacts.versionLabel", { version: artifact.version })}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-2">
                    {artifact.kind === "dashboard" && (
                      <button
                        type="button"
                        data-testid="artifact-dashboard-view"
                        onClick={() =>
                          setDashboardFor(
                            artifact.id === dashboardFor ? null : artifact.id,
                          )
                        }
                        className="rounded border border-indigo-300 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50"
                      >
                        {t("console.dashboard.viewButton")}
                      </button>
                    )}
                    {artifact.kind === "dashboard" && artifact.status === "published" && (
                      // 分享入口分发（wire-dashboard-share）：仅 published 且
                      // kind=dashboard——draft/archived/非 dashboard 一律不渲染。
                      <button
                        type="button"
                        data-testid="artifact-share"
                        onClick={() => setShareFor(artifact.id)}
                        className="rounded border border-sky-300 px-2 py-1 text-xs text-sky-700 hover:bg-sky-50"
                      >
                        {t("console.dashboard.share.button")}
                      </button>
                    )}
                    {artifact.status === "draft" && (
                      <button
                        type="button"
                        data-testid="artifact-publish"
                        onClick={() => void runAction(artifact, "publish")}
                        className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
                      >
                        {t("console.artifacts.publish")}
                      </button>
                    )}
                    {artifact.status !== "archived" && (
                      <button
                        type="button"
                        data-testid="artifact-archive"
                        onClick={() => void runAction(artifact, "archive")}
                        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        {t("console.artifacts.archive")}
                      </button>
                    )}
                    {artifact.status === "archived" && (
                      <button
                        type="button"
                        data-testid="artifact-restore"
                        onClick={() => void runAction(artifact, "restore")}
                        className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50"
                      >
                        {t("console.artifacts.restore")}
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid="artifact-history"
                      onClick={() => setHistoryFor(artifact.id)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      {t("console.artifacts.history")}
                    </button>
                    <button
                      type="button"
                      data-testid="artifact-view"
                      onClick={() => setSelectedId(artifact.id === selectedId ? null : artifact.id)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      {t("console.artifacts.viewSpec")}
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <span data-testid="artifact-updated">
                    {t("console.artifacts.updatedLabel")} {formatServerDate(artifact.updated_at)}
                  </span>
                  {artifact.origin_conversation_id != null ? (
                    <>
                      <span>·</span>
                      <span>{t("console.artifacts.source")}</span>
                      <a
                        data-testid="artifact-source-link"
                        href={`#/console/chat?c=${artifact.origin_conversation_id}`}
                        className="text-slate-600 underline decoration-dotted hover:text-slate-900"
                      >
                        {conv ? conv.title : `#${artifact.origin_conversation_id}`}
                      </a>
                    </>
                  ) : (
                    <span data-testid="artifact-source-none">{t("console.artifacts.sourceNone")}</span>
                  )}
                </div>
                {artifact.id === selectedId && (
                  <SpecViewer
                    key={`viewer-${artifact.id}`}
                    artifactId={artifact.id}
                    onSaved={replaceArtifact}
                  />
                )}
                {artifact.id === dashboardFor && (
                  <DashboardPane
                    key={`dashboard-${artifact.id}`}
                    artifactId={artifact.id}
                    onSaved={replaceArtifact}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {historyFor != null && (
        <VersionDrawer artifactId={historyFor} onClose={() => setHistoryFor(null)} />
      )}

      {shareFor != null && (
        <ShareLinkDialog
          key={`share-${shareFor}`}
          artifactId={shareFor}
          onClose={() => setShareFor(null)}
        />
      )}
    </div>
  );
}

function SpecViewer({
  artifactId,
  onSaved,
}: {
  artifactId: number;
  onSaved: (artifact: Artifact) => void;
}) {
  const { t } = useTranslation();
  const storageKey = `${BUFFER_STORAGE_PREFIX}${artifactId}`;
  const [serverSpec, setServerSpec] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<string>("draft");
  const [loadFailed, setLoadFailed] = useState(false);
  const [text, setText] = useState("");
  const [fromLocal, setFromLocal] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoadFailed(false);
    setSavedVersion(null);
    setInvalid(false);
    setServerError(null);
    fetchLifecycleArtifact(artifactId)
      .then((detail) => {
        if (!alive) return;
        setServerSpec(detail.spec);
        setStatus(detail.status);
        const original = JSON.stringify(detail.spec, null, 2);
        try {
          const buffered = localStorage.getItem(storageKey);
          if (buffered != null && buffered !== original) {
            setText(buffered);
            setFromLocal(true);
            return;
          }
        } catch {
          /* localStorage 不可用：仅展示服务端 spec */
        }
        setText(original);
        setFromLocal(false);
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [artifactId, storageKey]);

  const locked = status === "archived";

  const editText = (next: string) => {
    setText(next);
    setInvalid(false);
    setSavedVersion(null);
    setServerError(null);
    // localStorage 退位为未保存离开提示的本地缓冲：编辑即自动暂存，
    // 保存到服务端成功或显式丢弃时清除。
    if (!locked) {
      try {
        localStorage.setItem(storageKey, next);
        setFromLocal(next !== (serverSpec ? JSON.stringify(serverSpec, null, 2) : next));
      } catch {
        /* 存不进去时仅本次会话可见 */
      }
    }
  };

  const saveToServer = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setInvalid(true);
      setSavedVersion(null);
      return;
    }
    if (typeof parsed !== "object" || parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setSaving(true);
    setServerError(null);
    try {
      const detail = await saveArtifactSpec(artifactId, parsed as Record<string, unknown>);
      setSavedVersion(detail.version);
      setServerSpec(detail.spec);
      setStatus(detail.status);
      setText(JSON.stringify(detail.spec, null, 2));
      setFromLocal(false);
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* 清不掉时下次打开仍提示缓冲 */
      }
      onSaved(detail);
    } catch (err) {
      setServerError(apiErrorText(err, t("console.artifacts.viewer.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const discardBuffer = () => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* 同上 */
    }
    if (serverSpec != null) setText(JSON.stringify(serverSpec, null, 2));
    setFromLocal(false);
    setInvalid(false);
    setSavedVersion(null);
    setServerError(null);
  };

  if (loadFailed) {
    return (
      <div data-testid="artifact-viewer" className="mt-3 rounded-md border border-red-200 bg-red-50/60 p-4">
        <p className="text-xs text-red-700">{t("console.artifacts.viewer.loadError")}</p>
      </div>
    );
  }

  if (serverSpec == null) {
    return (
      <div data-testid="artifact-viewer" className="mt-3 rounded-md border border-slate-200 bg-slate-50/60 p-4">
        <p className="text-xs text-slate-400">{t("console.artifacts.loading")}</p>
      </div>
    );
  }

  return (
    <div data-testid="artifact-viewer" className="mt-3 rounded-md border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{t("console.artifacts.viewer.title")}</h2>
        {fromLocal && (
          <span data-testid="spec-buffer-badge" className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
            {t("console.artifacts.viewer.bufferBadge")}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {!locked && (
            <button
              type="button"
              data-testid="spec-save-server"
              disabled={saving}
              onClick={() => void saveToServer()}
              className="rounded bg-slate-900 px-3 py-1 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {saving
                ? t("console.artifacts.viewer.saving")
                : t("console.artifacts.viewer.saveServer")}
            </button>
          )}
          {fromLocal && !locked && (
            <button
              type="button"
              data-testid="spec-discard-buffer"
              onClick={discardBuffer}
              className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
            >
              {t("console.artifacts.viewer.discardBuffer")}
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        {locked
          ? t("console.artifacts.viewer.locked")
          : t("console.artifacts.viewer.note")}
      </p>
      {savedVersion != null && (
        <p data-testid="spec-saved-version" className="mt-1 text-[11px] text-emerald-600">
          {t("console.artifacts.viewer.savedVersion", { version: savedVersion })}
        </p>
      )}
      {serverError && (
        <p data-testid="spec-server-error" className="mt-1 text-[11px] text-red-600">
          {serverError}
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
        readOnly={locked}
        onChange={(e) => editText(e.target.value)}
        rows={Math.min(20, Math.max(8, text.split("\n").length + 1))}
        spellCheck={false}
        className="mt-2 w-full resize-y rounded-md border border-slate-300 bg-white p-3 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
      />
    </div>
  );
}

function VersionDrawer({
  artifactId,
  onClose,
}: {
  artifactId: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<ArtifactVersionSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<ArtifactVersionDetail | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setVersions(null);
    setFailed(false);
    setSelected(null);
    fetchArtifactVersions(artifactId)
      .then((rows) => {
        if (alive) setVersions(rows);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [artifactId]);

  const openVersion = async (version: number) => {
    setCopied(false);
    try {
      setSelected(await fetchArtifactVersion(artifactId, version));
    } catch {
      setSelected(null);
    }
  };

  const copySpec = async () => {
    if (selected == null) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(selected.spec, null, 2));
      setCopied(true);
    } catch {
      /* 剪贴板不可用（如非安全上下文）：如实不提示已复制 */
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" data-testid="version-drawer">
      <button
        type="button"
        aria-label={t("console.artifacts.versions.close")}
        data-testid="version-drawer-backdrop"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/30"
      />
      <aside className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{t("console.artifacts.versions.title")}</h2>
          <button
            type="button"
            data-testid="version-drawer-close"
            onClick={onClose}
            className="ml-auto rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            {t("console.artifacts.versions.close")}
          </button>
        </div>

        {failed && (
          <p className="mt-4 text-xs text-red-600" data-testid="version-list-error">
            {t("console.artifacts.versions.fetchError")}
          </p>
        )}
        {versions == null && !failed && (
          <p className="mt-4 text-xs text-slate-400" data-testid="version-list-loading">
            {t("console.artifacts.versions.loading")}
          </p>
        )}
        {versions != null && versions.length === 0 && (
          <p className="mt-4 text-xs text-slate-400" data-testid="version-list-empty">
            {t("console.artifacts.versions.empty")}
          </p>
        )}

        <ul data-testid="version-list" className="mt-4 space-y-2">
          {versions?.map((entry) => (
            <li key={entry.version}>
              <button
                type="button"
                data-testid="version-item"
                data-version={entry.version}
                onClick={() => void openVersion(entry.version)}
                className={`w-full rounded-md border px-3 py-2 text-left text-xs ${
                  selected?.version === entry.version
                    ? "border-slate-900 bg-slate-50"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <span className="font-mono font-medium text-slate-800">
                  {t("console.artifacts.versions.entry", { version: entry.version })}
                </span>
                <span className="ml-2 text-slate-400">
                  {t("console.artifacts.versions.operatorLabel")}: {entry.operator ?? "-"}
                </span>
                <span className="ml-2 text-slate-400">{formatServerDate(entry.created_at)}</span>
              </button>
            </li>
          ))}
        </ul>

        {selected != null && (
          <div data-testid="version-detail" className="mt-4 rounded-md border border-slate-200 bg-slate-50/60 p-4">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold">
                {t("console.artifacts.versions.entry", { version: selected.version })}
              </h3>
              <button
                type="button"
                data-testid="version-copy"
                onClick={() => void copySpec()}
                className="ml-auto rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
              >
                {t("console.artifacts.versions.copy")}
              </button>
            </div>
            {copied && (
              <p data-testid="version-copied" className="mt-1 text-[11px] text-emerald-600">
                {t("console.artifacts.versions.copied")}
              </p>
            )}
            <pre
              data-testid="version-spec"
              className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-3 font-mono text-[11px] text-slate-700"
            >
              {JSON.stringify(selected.spec, null, 2)}
            </pre>
          </div>
        )}
      </aside>
    </div>
  );
}

/**
 * 分享链接弹层（wire-dashboard-share 任务 2.2）：打开即调
 * POST /api/v1/artifacts/{id}/share，展示完整公开页链接 + 复制按钮 +
 * 到期时间。响应的 url 是**数据端点**（/api/v1/share/...），给接收者的
 * 展示链接必须另行构造：origin + /#/share/dashboard/{id}?t=…&v={version}
 * （t 从响应 url 的 query 里解出，版本钉死生成时刻的响应 version）。
 */
function ShareLinkDialog({
  artifactId,
  onClose,
}: {
  artifactId: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [result, setResult] = useState<DashboardShareLink | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setResult(null);
    setShareUrl("");
    setError(null);
    setCopied(false);
    createDashboardShareLink(artifactId)
      .then((res) => {
        if (!alive) return;
        setResult(res);
        // t 从数据端点 url 的 query 解出（相对路径也能被 URL 解析出 search）。
        const token = new URL(res.url, window.location.origin).searchParams.get("t") ?? "";
        setShareUrl(
          `${window.location.origin}/#/share/dashboard/${artifactId}` +
            `?t=${encodeURIComponent(token)}&v=${res.version}`,
        );
      })
      .catch((err: unknown) => {
        // 服务端 detail 如实呈现（403 状态说明 / 503 未配置 secret 原因）。
        if (alive) setError(apiErrorText(err, t("console.dashboard.share.generateFailed")));
      });
    return () => {
      alive = false;
    };
  }, [artifactId, t]);

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      /* 剪贴板不可用（如非安全上下文）：如实不提示已复制 */
    }
  };

  return (
    <div
      data-testid="share-dialog"
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label={t("console.dashboard.share.close")}
        data-testid="share-dialog-backdrop"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/30"
      />
      <div className="relative w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-center gap-2">
          <h2 data-testid="share-dialog-title" className="text-sm font-semibold">
            {t("console.dashboard.share.dialogTitle")}
          </h2>
          <button
            type="button"
            data-testid="share-dialog-close"
            onClick={onClose}
            className="ml-auto rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            {t("console.dashboard.share.close")}
          </button>
        </div>

        {error && (
          <p data-testid="share-error" className="mt-4 text-xs text-red-600">
            {error}
          </p>
        )}

        {!error && result == null && (
          <p data-testid="share-generating" className="mt-4 text-xs text-slate-400">
            {t("console.dashboard.share.generating")}
          </p>
        )}

        {result != null && (
          <div className="mt-4 space-y-3">
            <div>
              <p className="text-xs font-medium text-slate-600">
                {t("console.dashboard.share.urlLabel")}
              </p>
              {/* readonly 输入框承载完整链接：可选中复制、长链接不撑破布局。 */}
              <input
                data-testid="share-url"
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="mt-1 w-full rounded border border-slate-300 bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-700"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  data-testid="share-copy"
                  onClick={() => void copyLink()}
                  className="rounded bg-slate-900 px-3 py-1 text-xs text-white hover:bg-slate-700"
                >
                  {t("console.dashboard.share.copy")}
                </button>
                {copied && (
                  <span data-testid="share-copied" className="text-[11px] text-emerald-600">
                    {t("console.dashboard.share.copied")}
                  </span>
                )}
              </div>
            </div>
            <p data-testid="share-expires" className="text-xs text-slate-500">
              {t("console.dashboard.share.expiresLabel")}：
              {formatServerDate(result.expires_at)}
            </p>
            <p className="text-[11px] text-slate-400">
              {t("console.dashboard.share.versionNote", { version: result.version })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
