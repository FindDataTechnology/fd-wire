// 看板视图容器（wire-dashboard-renderer 任务 4）：产物页 dashboard kind 的
// 展开区（内嵌，不走路由）。拉取产物详情 → 查看态渲染 DashboardRenderer；
// v1 spec 且未归档时提供「编辑」切换 DashboardEditor；保存后同步刷新列表行。
// legacy spec（旧自由 JSON）只读呈现，不提供编辑（编辑器 v1 只吃 v1 契约）。
// wire-dashboard-refresh 任务 2.1：查看态加「刷新数据」——POST refresh 落新
// 版本后重拉详情重渲染；409 进行中 / 403 档位 / 502 引擎失败如实呈现；
// archived 只读无入口；进行中 loading 禁用防重复触发。
// wire-refresh-scheduler 任务 4.1：查看态底部加「定时刷新」小节（间隔预设
// 6h/24h/7d）；archived 目标的调度行由调度器自动清理，不再提供管理入口。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ConsoleApiError,
  apiErrorText,
  fetchLifecycleArtifact,
  refreshDashboard,
  type Artifact,
  type ArtifactDetail,
} from "../api";
import { parseDashboardSpec } from "./spec";
import { DashboardRenderer } from "./DashboardRenderer";
import { DashboardEditor } from "./DashboardEditor";
import {
  ARTIFACT_SCHEDULE_INTERVALS,
  RefreshScheduleSection,
} from "../RefreshScheduleSection";

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
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setFailed(false);
    setEditing(false);
    setRefreshing(false);
    setRefreshNotice(null);
    setRefreshError(null);
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

  /** 手动刷新：成功提示新版本号并重拉详情重渲染（行版本号经 onSaved 同步）。 */
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshNotice(null);
    setRefreshError(null);
    try {
      const result = await refreshDashboard(artifactId);
      setRefreshNotice(
        t("console.dashboard.refresh.success", { version: result.version }),
      );
      const row = await fetchLifecycleArtifact(artifactId);
      setDetail(row);
      onSaved(row);
    } catch (err) {
      if (err instanceof ConsoleApiError && err.status === 409) {
        // 单飞锁：同产物刷新进行中——固定文案（后端 detail 是机口径）。
        setRefreshError(t("console.dashboard.refresh.inProgress"));
      } else {
        // 403 档位引导 / 502 引擎失败等：后端 detail 如实呈现，无 detail 兜底。
        setRefreshError(apiErrorText(err, t("console.dashboard.refresh.failed")));
      }
    } finally {
      setRefreshing(false);
    }
  };

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
            <>
              {!locked && (
                <button
                  type="button"
                  data-testid="dashboard-refresh"
                  disabled={refreshing}
                  onClick={() => void refresh()}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {refreshing
                    ? t("console.dashboard.refresh.refreshing")
                    : t("console.dashboard.refresh.button")}
                </button>
              )}
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
            </>
          )}
        </div>
      </div>
      {refreshNotice && (
        <p data-testid="dashboard-refresh-success" className="mt-1 text-[11px] text-emerald-600">
          {refreshNotice}
        </p>
      )}
      {refreshError && (
        <p data-testid="dashboard-refresh-error" className="mt-1 text-[11px] text-red-600">
          {refreshError}
        </p>
      )}

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
        <>
          <div className="mt-1">
            <DashboardRenderer spec={detail.spec} />
          </div>
          {/* 定时刷新小节（wire-refresh-scheduler 4.1）：查看态管理入口；
              archived 由调度器自动清理调度行，不再展示。 */}
          {!locked && (
            <RefreshScheduleSection
              targetType="artifact"
              targetId={String(artifactId)}
              intervals={ARTIFACT_SCHEDULE_INTERVALS}
            />
          )}
        </>
      )}
    </div>
  );
}
