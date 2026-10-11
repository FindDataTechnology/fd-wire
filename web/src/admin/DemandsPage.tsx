// 需求单派发台（#/admin/demands）：全客户列表 + 状态筛选 + 派发操作。
// 迁移下拉按状态机白名单禁用非法项（客户端只是提示面，服务端 409 仍是
// 唯一裁决）；三态机（wire-ux-consolidation 任务 3.5）：submitted →
// in_progress → delivered，rejected 必带理由；报价确认流程已随八态废除。
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminErrorBox, AdminStates } from "./AdminLayout";
import {
  exportDemandWorkorder,
  fetchDemands,
  transitionDemand,
  type AdminDemand,
  type AdminWorkorderResult,
  type DemandStatus,
} from "./api";
import { ALL_DEMAND_STATUSES, allowedTargets, needsReason } from "./demandsMachine";

const STATUS_BADGE_CLASS: Record<string, string> = {
  submitted: "bg-slate-100 text-slate-700 ring-slate-200",
  in_progress: "bg-amber-50 text-amber-700 ring-amber-200",
  delivered: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
};

export function DemandsPage() {
  const { t } = useTranslation();
  const [demands, setDemands] = useState<AdminDemand[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<DemandStatus | "all">("all");
  const [error, setError] = useState<{ status?: number; message: string; detail?: string } | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setDemands(null);
    try {
      const items = await fetchDemands(
        statusFilter === "all" ? undefined : statusFilter,
      );
      setDemands(items);
    } catch (err) {
      setError(err as { status?: number; message: string });
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("admin.demands.title")}</h1>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            {t("admin.demands.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="demand-status-filter" className="text-xs text-slate-500">
            {t("admin.demands.statusFilter")}
          </label>
          <select
            id="demand-status-filter"
            data-testid="demand-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as DemandStatus | "all")}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="all">{t("admin.demands.statusAll")}</option>
            {ALL_DEMAND_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`admin.demands.statuses.${status}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <AdminErrorBox error={error} onRetry={() => void load()} />}
      {actionError && (
        <div
          data-testid="admin-dispatch-conflict"
          className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700"
        >
          {actionError}
        </div>
      )}

      <AdminStates
        loading={demands == null && !error}
        empty={(demands?.length ?? 0) === 0 && !error}
        emptyTestId="admin-demands-empty"
      >
        {demands != null && demands.length > 0 && (
          <ul data-testid="admin-demand-list" className="mt-4 space-y-2">
          {demands!.map((demand) => (
            <li
              key={demand.id}
              data-testid="admin-demand-item"
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-400">{demand.code}</span>
                <span className="text-sm font-medium text-slate-800">
                  {demand.title}
                </span>
                <span
                  data-testid="admin-demand-status"
                  data-status={demand.status}
                  className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
                    STATUS_BADGE_CLASS[demand.status] ?? STATUS_BADGE_CLASS.submitted
                  }`}
                >
                  {t(`admin.demands.statuses.${demand.status}`, demand.status)}
                </span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">
                  {demand.customer_id}
                </span>
                <button
                  type="button"
                  data-testid="admin-demand-dispatch-toggle"
                  onClick={() => {
                    setOpenId(openId === demand.id ? null : demand.id);
                    setActionError(null);
                  }}
                  disabled={allowedTargets(demand.status).length === 0}
                  className="ml-auto rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  title={
                    allowedTargets(demand.status).length === 0
                      ? t("admin.demands.terminalHint")
                      : undefined
                  }
                >
                  {t("admin.demands.dispatch")}
                </button>
              </div>
              {demand.evaluation_summary && (
                <p
                  data-testid="admin-demand-evaluation"
                  className="mt-2 text-xs text-slate-500"
                >
                  {demand.evaluation_summary}
                </p>
              )}
              {demand.status_history.length > 0 && (
                <p
                  data-testid="admin-demand-last-event"
                  className="mt-1 text-[11px] text-slate-400"
                >
                  {t("admin.demands.lastEvent", {
                    status: t(
                      `admin.demands.statuses.${demand.status_history[demand.status_history.length - 1]!.status}`,
                    ),
                    by: demand.status_history[demand.status_history.length - 1]!.by,
                  })}
                </p>
              )}
              {openId === demand.id && (
                <>
                  <DispatchPanel
                    demand={demand}
                    onDone={async () => {
                      setOpenId(null);
                      await load();
                    }}
                    onConflict={(message) => setActionError(message)}
                  />
                  {demand.status === "in_progress" && (
                    <WorkorderSection
                      demandId={demand.id}
                      onConflict={(message) => setActionError(message)}
                    />
                  )}
                </>
              )}
            </li>
          ))}
          </ul>
        )}
      </AdminStates>
    </div>
  );
}

function DispatchPanel({
  demand,
  onDone,
  onConflict,
}: {
  demand: AdminDemand;
  onDone: () => Promise<void>;
  onConflict: (message: string) => void;
}) {
  const { t } = useTranslation();
  const allowed = allowedTargets(demand.status);
  const [target, setTarget] = useState<DemandStatus>(allowed[0] ?? demand.status);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await transitionDemand(demand.id, {
        target_status: target,
        by: "admin-console",
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(needsReason(target) && reason.trim() ? { reason: reason.trim() } : {}),
      });
      setNote("");
      setReason("");
      await onDone();
    } catch (err) {
      const apiErr = err as { status?: number; detail?: string; message: string };
      onConflict(
        apiErr.detail ??
          (apiErr.status === 409
            ? t("admin.demands.conflictDefault")
            : apiErr.message),
      );
    } finally {
      setBusy(false);
    }
  };

  const reasonRequired = needsReason(target);

  return (
    <div
      data-testid="admin-dispatch-panel"
      className="mt-3 rounded-md border border-slate-200 bg-slate-50/60 p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`target-${demand.id}`} className="block text-xs text-slate-500">
            {t("admin.demands.targetLabel")}
          </label>
          <select
            id={`target-${demand.id}`}
            data-testid="admin-dispatch-target"
            value={target}
            onChange={(e) => setTarget(e.target.value as DemandStatus)}
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {ALL_DEMAND_STATUSES.map((status) => {
              const legal = allowed.includes(status);
              return (
                <option key={status} value={status} disabled={!legal}>
                  {t(`admin.demands.statuses.${status}`)}
                  {legal ? "" : `（${t("admin.demands.illegalSuffix")}）`}
                </option>
              );
            })}
          </select>
        </div>
        <div>
          <label htmlFor={`note-${demand.id}`} className="block text-xs text-slate-500">
            {t("admin.demands.noteLabel")}
          </label>
          <input
            id={`note-${demand.id}`}
            data-testid="admin-dispatch-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-56 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            placeholder={t("admin.demands.notePlaceholder")}
          />
        </div>
        {reasonRequired && (
          <div>
            <label htmlFor={`reason-${demand.id}`} className="block text-xs text-slate-500">
              {t("admin.demands.reasonLabel")}
            </label>
            <input
              id={`reason-${demand.id}`}
              data-testid="admin-dispatch-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-56 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              placeholder={t("admin.demands.reasonPlaceholder")}
            />
          </div>
        )}
        <button
          type="button"
          data-testid="admin-dispatch-submit"
          disabled={busy || (reasonRequired && !reason.trim()) || allowed.length === 0}
          onClick={() => void submit()}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? t("admin.common.working") : t("admin.demands.submit")}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        {t("admin.demands.machineNote")}
      </p>
    </div>
  );
}

/** 「转生成工单」区（wire-workorder-console-action）：仅 in_progress 单渲染。

 * 出单入舰队拉取队列，出单不迁移状态；成功必须展示工单全文（人工推送
 * 降级）与「未投递」诚实文案——绝不呈现自动化投递成功假象（spec 红线）。
 */
function WorkorderSection({
  demandId,
  onConflict,
}: {
  demandId: number;
  onConflict: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AdminWorkorderResult | null>(null);

  const submit = async () => {
    setBusy(true);
    try {
      setResult(await exportDemandWorkorder(demandId));
    } catch (err) {
      const apiErr = err as { status?: number; detail?: string; message: string };
      onConflict(apiErr.detail ?? t("admin.demands.workorder.errorDefault"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="admin-workorder-section"
      className="mt-3 rounded-md border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-slate-800">
            {t("admin.demands.workorder.title")}
          </h3>
          <p className="mt-1 max-w-xl text-[11px] text-slate-500">
            {t("admin.demands.workorder.hint")}
          </p>
        </div>
        <button
          type="button"
          data-testid="admin-workorder-submit"
          disabled={busy}
          onClick={() => void submit()}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? t("admin.common.working") : t("admin.demands.workorder.submit")}
        </button>
      </div>

      {result && (
        <div
          data-testid="admin-workorder-result"
          className="mt-3 rounded border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-xs text-slate-600"
        >
          <p>
            <span className="text-slate-500">
              {t("admin.demands.workorder.pathLabel")}：
            </span>
            <span data-testid="admin-workorder-path" className="font-mono">
              {result.ticket_path}
            </span>
          </p>
          <p className="mt-1" data-testid="admin-workorder-slug">
            {result.slug_check === "free"
              ? t("admin.demands.workorder.slugFree")
              : t("admin.demands.workorder.slugUnverified")}
          </p>
          <p
            data-testid="admin-workorder-undelivered"
            className="mt-1 text-amber-700"
          >
            {t("admin.demands.workorder.undelivered")}
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-slate-500">
              {t("admin.demands.workorder.yamlSummary")}
            </summary>
            <pre
              data-testid="admin-workorder-yaml"
              className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-white p-2 font-mono text-[11px] text-slate-700"
            >
              {result.ticket_yaml}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
