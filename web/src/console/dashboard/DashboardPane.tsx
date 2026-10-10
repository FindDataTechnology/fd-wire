// 看板视图容器（wire-dashboard-renderer 任务 4）：产物页 dashboard kind 的
// 展开区（内嵌，不走路由）。拉取产物详情 → 查看态渲染 DashboardRenderer；
// v1 spec 且未归档时提供「编辑」切换 DashboardEditor；保存后同步刷新列表行。
// legacy spec（旧自由 JSON）只读呈现，不提供编辑（编辑器 v1 只吃 v1 契约）。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchLifecycleArtifact, type Artifact, type ArtifactDetail } from "../api";
import { parseDashboardSpec } from "./spec";
import { DashboardRenderer } from "./DashboardRenderer";
import { DashboardEditor } from "./DashboardEditor";

export function DashboardPane({
  artifactId,
  onSaved,
}: {
  artifactId: number;
  onSaved: (artifact: Artifact) => void;
}) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setFailed(false);
    setEditing(false);
    fetchLifecycleArtifact(artifactId)
      .then((row) => {
        if (alive) setDetail(row);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [artifactId]);

  if (failed) {
    return (
      <div
        data-testid="dashboard-pane"
        className="mt-3 rounded-md border border-red-200 bg-red-50/60 p-4"
      >
        <p data-testid="dashboard-load-error" className="text-xs text-red-700">
          {t("console.dashboard.loadError")}
        </p>
      </div>
    );
  }

  if (detail == null) {
    return (
      <div
        data-testid="dashboard-pane"
        className="mt-3 rounded-md border border-slate-200 bg-slate-50/60 p-4"
      >
        <p data-testid="dashboard-loading" className="text-xs text-slate-400">
          {t("console.dashboard.loading")}
        </p>
      </div>
    );
  }

  const parsed = parseDashboardSpec(detail.spec);
  const locked = detail.status === "archived";

  return (
    <div data-testid="dashboard-pane" className="mt-3 rounded-md border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{t("console.dashboard.paneTitle")}</h2>
        {locked && (
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">
            {t("console.dashboard.lockedBadge")}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {editing ? null : (
            <button
              type="button"
              data-testid="dashboard-edit"
              disabled={parsed.kind !== "v1" || locked}
              onClick={() => setEditing(true)}
              title={
                parsed.kind === "legacy"
                  ? t("console.dashboard.legacy.noEditHint")
                  : undefined
              }
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("console.dashboard.editButton")}
            </button>
          )}
        </div>
      </div>

      {editing && parsed.kind === "v1" ? (
        <DashboardEditor
          artifactId={artifactId}
          initial={{ title: parsed.title, panels: parsed.panels }}
          onSaved={(next) => {
            setDetail(next);
            onSaved(next);
          }}
          onExit={() => setEditing(false)}
        />
      ) : (
        <div className="mt-1">
          <DashboardRenderer spec={detail.spec} />
        </div>
      )}
    </div>
  );
}
