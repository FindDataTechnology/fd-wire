// 仪表盘基础编辑器 v1（wire-dashboard-renderer 任务 3）。
// - 面板增（选 type 出模板）/删/改标题/左移右移/span 三档切换；
//   kpi 值（存 snapshot.rows[0][0]）/单位/副标题表单编辑。
// - 编辑态实时预览复用 DashboardRenderer；保存走既有 PUT（saveArtifactSpec，
//   version 递增由服务端）；未保存离开 confirm 提示（含 beforeunload 兜底）。
// - 不做图表类型切换与数据绑定编辑（v2）；JSON 视图在产物页 spec 编辑器已有。
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiErrorText, saveArtifactSpec, type ArtifactDetail } from "../api";
import {
  DASHBOARD_PANEL_SPANS,
  DASHBOARD_PANEL_TYPES,
  buildArtifactEnvelope,
  moveItem,
  panelTemplate,
  type DashboardPanel,
  type DashboardPanelType,
  type DashboardSpecV1,
} from "./spec";
import { DashboardRenderer } from "./DashboardRenderer";

/** 表单输入 → 契约格子值：空 → null；完整数字样式 → number；其余（含
 *  输入中的 "3." 等未完成态）原样字符串——不打断受控输入。 */
function coerceCell(text: string): string | number | null {
  if (text === "") return null;
  const n = Number(text);
  if (Number.isFinite(n) && !text.endsWith(".")) return n;
  return text;
}

export function DashboardEditor({
  artifactId,
  initial,
  onSaved,
  onExit,
}: {
  artifactId: number;
  /** 服务端当前 spec 解析出的 v1 本体（面板 id 已归一）。 */
  initial: DashboardSpecV1;
  onSaved: (detail: ArtifactDetail) => void;
  /** 返回查看态（脏态时编辑器先 confirm）。 */
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<DashboardSpecV1>(initial);
  // 已保存基线（保存成功后推进——dirty 对比用它而不是 initial prop）。
  const [baseline, setBaseline] = useState<DashboardSpecV1>(initial);
  const [addType, setAddType] = useState<DashboardPanelType>("kpi");
  const [saving, setSaving] = useState(false);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline),
    [draft, baseline],
  );

  // 浏览器级离开兜底（页内返回查看的 confirm 在 requestExit 里）。
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const patchPanel = (id: string, patch: (p: DashboardPanel) => DashboardPanel) => {
    setDraft((prev) => ({
      ...prev,
      panels: prev.panels.map((p) => (p.id === id ? patch(p) : p)),
    }));
    setSavedVersion(null);
    setServerError(null);
  };

  const addPanel = () => {
    setDraft((prev) => ({
      ...prev,
      panels: [
        ...prev.panels,
        panelTemplate(
          addType,
          prev.panels.map((p) => p.id),
        ),
      ],
    }));
    setSavedVersion(null);
    setServerError(null);
  };

  const removePanel = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      panels: prev.panels.filter((p) => p.id !== id),
    }));
    setSavedVersion(null);
    setServerError(null);
  };

  const movePanel = (index: number, delta: -1 | 1) => {
    setDraft((prev) => ({
      ...prev,
      panels: moveItem(prev.panels, index, index + delta),
    }));
    setSavedVersion(null);
    setServerError(null);
  };

  /** kpi 三件套写回：值进 snapshot.rows[0][0]，单位/副标题进 config。 */
  const patchKpi = (
    id: string,
    patch: Partial<Pick<NonNullable<DashboardPanel["config"]>, "unit" | "subtitle">> & {
      value?: string;
    },
  ) => {
    patchPanel(id, (p) => {
      if (patch.value !== undefined) {
        return {
          ...p,
          snapshot: {
            columns: p.snapshot?.columns ?? ["value"],
            rows: [[coerceCell(patch.value)]],
          },
        };
      }
      return {
        ...p,
        config: {
          unit: patch.unit !== undefined ? patch.unit : p.config?.unit ?? "",
          subtitle:
            patch.subtitle !== undefined ? patch.subtitle : p.config?.subtitle ?? "",
        },
      };
    });
  };

  const save = async () => {
    const title = draft.title.trim();
    if (!title || saving) return;
    setSaving(true);
    setServerError(null);
    try {
      const detail = await saveArtifactSpec(
        artifactId,
        buildArtifactEnvelope({ ...draft, title }),
      );
      setSavedVersion(detail.version);
      // 推进基线为已保存内容（服务端按原样存储，回读无漂移）。
      const saved: DashboardSpecV1 = { title, panels: draft.panels };
      setBaseline(JSON.parse(JSON.stringify(saved)) as DashboardSpecV1);
      onSaved(detail);
    } catch (err) {
      setServerError(
        apiErrorText(err, t("console.dashboard.editor.saveFailed")),
      );
    } finally {
      setSaving(false);
    }
  };

  const requestExit = () => {
    if (dirty && !window.confirm(t("console.dashboard.editor.dirtyLeaveConfirm"))) {
      return;
    }
    onExit();
  };

  const previewSpec = useMemo<DashboardSpecV1>(
    () => ({ title: draft.title, panels: draft.panels }),
    [draft],
  );

  return (
    <div data-testid="dashboard-editor" className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="dashboard-editor-title" className="text-xs text-slate-500">
          {t("console.dashboard.editor.titleLabel")}
        </label>
        <input
          id="dashboard-editor-title"
          data-testid="editor-dashboard-title"
          value={draft.title}
          onChange={(e) => {
            setDraft((prev) => ({ ...prev, title: e.target.value }));
            setSavedVersion(null);
            setServerError(null);
          }}
          className="w-56 rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            data-testid="editor-exit"
            onClick={requestExit}
            className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
          >
            {t("console.dashboard.editor.backToView")}
          </button>
          <button
            type="button"
            data-testid="editor-save"
            disabled={saving || !draft.title.trim()}
            onClick={() => void save()}
            className="rounded bg-slate-900 px-3 py-1 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving
              ? t("console.dashboard.editor.saving")
              : t("console.dashboard.editor.save")}
          </button>
        </div>
      </div>
      {savedVersion != null && (
        <p data-testid="editor-saved-version" className="mt-1 text-[11px] text-emerald-600">
          {t("console.dashboard.editor.savedVersion", { version: savedVersion })}
        </p>
      )}
      {serverError && (
        <p data-testid="editor-server-error" className="mt-1 text-[11px] text-red-600">
          {serverError}
        </p>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-semibold text-slate-600">
              {t("console.dashboard.editor.panelListTitle")}
            </h3>
            <div className="ml-auto flex items-center gap-1">
              <label htmlFor="editor-add-type" className="text-[11px] text-slate-400">
                {t("console.dashboard.editor.addTypeLabel")}
              </label>
              <select
                id="editor-add-type"
                data-testid="editor-add-type"
                value={addType}
                onChange={(e) => setAddType(e.target.value as DashboardPanelType)}
                className="rounded border border-slate-300 px-1.5 py-0.5 text-xs"
              >
                {DASHBOARD_PANEL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`console.dashboard.type.${type}`)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                data-testid="editor-add-panel"
                onClick={addPanel}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
              >
                {t("console.dashboard.editor.addPanel")}
              </button>
            </div>
          </div>

          {draft.panels.length === 0 && (
            <p data-testid="editor-empty-panels" className="mt-2 text-xs text-slate-400">
              {t("console.dashboard.emptyPanels")}
            </p>
          )}

          <ul data-testid="editor-panel-list" className="mt-2 space-y-2">
            {draft.panels.map((panel, index) => (
              <li
                key={panel.id}
                data-testid="editor-panel"
                data-panel-id={panel.id}
                data-panel-type={panel.type}
                className="rounded border border-slate-200 p-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                    {t(`console.dashboard.type.${panel.type}`)}
                  </span>
                  <input
                    data-testid="editor-panel-title"
                    value={panel.title}
                    placeholder={t("console.dashboard.editor.panelTitlePlaceholder")}
                    onChange={(e) =>
                      patchPanel(panel.id, (p) => ({ ...p, title: e.target.value }))
                    }
                    className="min-w-32 flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                  <div className="flex items-center gap-0.5">
                    {DASHBOARD_PANEL_SPANS.map((span) => (
                      <button
                        key={span}
                        type="button"
                        data-testid="editor-panel-span"
                        data-span={span}
                        onClick={() =>
                          patchPanel(panel.id, (p) => ({ ...p, span }))
                        }
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          panel.span === span
                            ? "bg-slate-900 text-white"
                            : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {t("console.dashboard.editor.spanOption", { span })}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      data-testid="editor-panel-move-left"
                      disabled={index === 0}
                      onClick={() => movePanel(index, -1)}
                      className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    >
                      {t("console.dashboard.editor.moveLeft")}
                    </button>
                    <button
                      type="button"
                      data-testid="editor-panel-move-right"
                      disabled={index === draft.panels.length - 1}
                      onClick={() => movePanel(index, 1)}
                      className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    >
                      {t("console.dashboard.editor.moveRight")}
                    </button>
                    <button
                      type="button"
                      data-testid="editor-panel-remove"
                      onClick={() => removePanel(panel.id)}
                      className="rounded border border-rose-200 bg-white px-1.5 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50"
                    >
                      {t("console.dashboard.editor.remove")}
                    </button>
                  </div>
                </div>
                {panel.type === "kpi" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="text-[11px] text-slate-400">
                      {t("console.dashboard.editor.kpiValue")}
                    </label>
                    <input
                      data-testid="editor-kpi-value"
                      value={String(panel.snapshot?.rows?.[0]?.[0] ?? "")}
                      onChange={(e) => patchKpi(panel.id, { value: e.target.value })}
                      className="w-28 rounded border border-slate-300 px-2 py-1 text-xs tabular-nums"
                    />
                    <label className="text-[11px] text-slate-400">
                      {t("console.dashboard.editor.kpiUnit")}
                    </label>
                    <input
                      data-testid="editor-kpi-unit"
                      value={panel.config?.unit ?? ""}
                      onChange={(e) => patchKpi(panel.id, { unit: e.target.value })}
                      className="w-20 rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                    <label className="text-[11px] text-slate-400">
                      {t("console.dashboard.editor.kpiSubtitle")}
                    </label>
                    <input
                      data-testid="editor-kpi-subtitle"
                      value={panel.config?.subtitle ?? ""}
                      onChange={(e) => patchKpi(panel.id, { subtitle: e.target.value })}
                      className="w-44 rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-md border border-slate-200 bg-white p-3">
          <h3 className="text-xs font-semibold text-slate-600">
            {t("console.dashboard.editor.preview")}
          </h3>
          <div className="mt-2">
            <DashboardRenderer spec={previewSpec} />
          </div>
        </div>
      </div>
    </div>
  );
}
