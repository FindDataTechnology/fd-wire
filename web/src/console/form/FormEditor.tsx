// 表单构建器（wire-form-builder 任务 4.3）。
//
// 数据集下拉（本企业列表，显示 tier/行数提示）→ 按数据集实时列勾选生成
// 字段（默认 label=列名、input 按列类型建议：数值列 number、日期列 date、
// 其余 text——列信息以数据集列表响应内嵌 columns 为准）→ 逐字段改
// label/input/required、select 可编辑 options（逗号分隔）→ submitLabel/
// successMessage 可配 → 保存走既有 PUT 版本链（saveArtifactSpec）。
// 保存前结构自检（validateFormSpec——与后端规则同源），错误逐条呈现零请求；
// 未绑数据集保存允许（构建中间态）；未保存离开 confirm + beforeunload 兜底
// （照抄 DashboardEditor 范式）。字段顺序=勾选时数据集列序。
//
// 显隐条件编辑（wire-form-field-linkage）：每字段卡可选配单条件 visibleWhen
// （当字段/算子/值三控件；empty 族免值；一键清除）。无 visibleWhen 的既有
// 字段默认开关关闭、编辑面零变化；草稿允许中间态（如空值），保存自检
// conditionBad/Self/Missing 拦截。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  apiErrorText,
  fetchDatasets,
  saveArtifactSpec,
  type ArtifactDetail,
  type Dataset,
  type DatasetColumn,
} from "../api";
import {
  FIELD_CONDITION_OPS,
  FORM_INPUT_TYPES,
  buildFormEnvelope,
  fieldFromColumn,
  validateFormSpec,
  type FieldConditionOp,
  type FieldVisibleWhen,
  type FormField,
  type FormInputType,
  type FormSpecBody,
  type FormSpecErrorCode,
} from "./formSpec";

/** 数据集下拉选项文案：名称 + tier 徽标（响应带才显示）+ 行数。 */
function datasetOptionText(
  t: ReturnType<typeof useTranslation>["t"],
  dataset: Dataset,
): string {
  const tier = (dataset as { storage_tier?: string }).storage_tier;
  const tierText =
    tier === "api" || tier === "cell"
      ? t(`console.datasets.tierBadge.${tier}`)
      : null;
  return tierText
    ? t("console.form.editor.datasetOption", {
        name: dataset.name,
        tier: tierText,
        rows: dataset.row_count,
      })
    : t("console.form.editor.datasetOptionPlain", {
        name: dataset.name,
        rows: dataset.row_count,
      });
}

interface FormEditorDraft {
  title: string;
  body: FormSpecBody;
}

export function FormEditor({
  artifactId,
  initial,
  onSaved,
  onExit,
}: {
  artifactId: number;
  /** 服务端当前 spec 解析出的编辑初态（信封标题 + 表单本体）。 */
  initial: FormEditorDraft;
  onSaved: (detail: ArtifactDetail) => void;
  /** 返回查看态（脏态时编辑器先 confirm）。 */
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<FormEditorDraft>(initial);
  // 已保存基线（保存成功后推进——dirty 对比用它而不是 initial prop）。
  const [baseline, setBaseline] = useState<FormEditorDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [structureErrors, setStructureErrors] = useState<FormSpecErrorCode[]>([]);

  // 数据集列表：编辑器即数据集选择器，挂载即拉取（可重试）。
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [datasetsError, setDatasetsError] = useState<string | null>(null);
  const loadDatasets = useCallback(() => {
    setDatasetsLoading(true);
    setDatasetsError(null);
    fetchDatasets()
      .then((list) => setDatasets(list))
      .catch((err) => {
        setDatasetsError(
          apiErrorText(err, t("console.form.editor.datasetsLoadFailed")),
        );
      })
      .finally(() => setDatasetsLoading(false));
  }, [t]);
  useEffect(() => {
    loadDatasets();
  }, [loadDatasets]);

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

  const selectedDataset =
    datasets?.find((d) => d.id === draft.body.datasetId) ?? null;
  const columns: DatasetColumn[] = selectedDataset?.columns ?? [];
  const columnNames = new Set(columns.map((c) => c.name));

  const patchDraft = (patch: Partial<FormEditorDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setSavedVersion(null);
    setServerError(null);
    setStructureErrors([]);
  };

  /** 勾列成字段：新字段插入后按数据集列序稳定重排（不在列清单的字段——
   *  数据集已演进——排在其后并保留，构建器如实标注）。 */
  const toggleColumn = (column: DatasetColumn, checked: boolean) => {
    const fields = checked
      ? sortFields([...draft.body.fields, fieldFromColumn(column)], columns)
      : draft.body.fields.filter((f) => f.column !== column.name);
    patchDraft({ body: { ...draft.body, fields } });
  };

  const patchField = (column: string, patch: Partial<FormField>) => {
    patchDraft({
      body: {
        ...draft.body,
        fields: draft.body.fields.map((f) =>
          f.column === column ? { ...f, ...patch } : f,
        ),
      },
    });
  };

  /** 显隐条件写入/清除（wire-form-field-linkage）：cond=null 时 visibleWhen
   *  键整体不落（既有无条件字段零变化）。 */
  const setFieldCondition = (column: string, cond: FieldVisibleWhen | null) => {
    patchDraft({
      body: {
        ...draft.body,
        fields: draft.body.fields.map((f) => {
          if (f.column !== column) return f;
          if (!cond) {
            const { visibleWhen: _omit, ...rest } = f;
            return rest;
          }
          return { ...f, visibleWhen: cond };
        }),
      },
    });
  };

  /** 保存：结构自检（零请求拦截）→ PUT 版本链；datasetId 为空的构建中间态
   *  允许保存（服务端只裁 datasetId 非空时的存在性/属主）。 */
  const save = async () => {
    if (saving) return;
    const title = draft.title.trim();
    const errors = validateFormSpec(title, draft.body);
    if (errors.length > 0) {
      setStructureErrors(errors);
      setSavedVersion(null);
      return;
    }
    setSaving(true);
    setServerError(null);
    setStructureErrors([]);
    try {
      const detail = await saveArtifactSpec(
        artifactId,
        buildFormEnvelope(title, draft.body) as unknown as Record<string, unknown>,
      );
      setSavedVersion(detail.version);
      const saved: FormEditorDraft = {
        title,
        body: buildFormEnvelope(title, draft.body).spec,
      };
      setBaseline(JSON.parse(JSON.stringify(saved)) as FormEditorDraft);
      setDraft(saved);
      onSaved(detail);
    } catch (err) {
      setServerError(apiErrorText(err, t("console.form.editor.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const requestExit = () => {
    if (
      dirty &&
      !window.confirm(t("console.form.editor.dirtyLeaveConfirm"))
    ) {
      return;
    }
    onExit();
  };

  return (
    <div data-testid="form-editor" className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="form-editor-title" className="text-xs text-slate-500">
          {t("console.form.editor.titleLabel")}
        </label>
        <input
          id="form-editor-title"
          data-testid="editor-form-title"
          value={draft.title}
          onChange={(e) => patchDraft({ title: e.target.value })}
          className="w-56 rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            data-testid="editor-form-exit"
            onClick={requestExit}
            className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
          >
            {t("console.form.editor.backToView")}
          </button>
          <button
            type="button"
            data-testid="editor-form-save"
            disabled={saving || !draft.title.trim()}
            onClick={() => void save()}
            className="rounded bg-slate-900 px-3 py-1 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving
              ? t("console.form.editor.saving")
              : t("console.form.editor.save")}
          </button>
        </div>
      </div>
      {savedVersion != null && (
        <p data-testid="editor-form-saved-version" className="mt-1 text-[11px] text-emerald-600">
          {t("console.form.editor.savedVersion", { version: savedVersion })}
        </p>
      )}
      {serverError && (
        <p data-testid="editor-form-server-error" className="mt-1 text-[11px] text-red-600">
          {serverError}
        </p>
      )}
      {structureErrors.length > 0 && (
        <ul data-testid="editor-form-errors" className="mt-1 space-y-0.5">
          {structureErrors.map((code) => (
            <li
              key={code}
              data-testid="editor-form-error"
              data-code={code}
              className="text-[11px] text-red-600"
            >
              {t(`console.form.editor.errors.${code}`)}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="editor-form-dataset" className="text-xs text-slate-500">
              {t("console.form.editor.datasetLabel")}
            </label>
            <select
              id="editor-form-dataset"
              data-testid="editor-form-dataset"
              value={draft.body.datasetId ?? ""}
              onChange={(e) => {
                // 换数据集：字段保留但按新列清单如实标注缺失列（不静默删）。
                patchDraft({
                  body: { ...draft.body, datasetId: e.target.value || null },
                });
              }}
              className="rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">{t("console.form.editor.datasetPlaceholder")}</option>
              {(datasets ?? []).map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {datasetOptionText(t, dataset)}
                </option>
              ))}
              {/* 已绑数据集不在列表（已删/他企）——保留占位选项，值不漂移。 */}
              {draft.body.datasetId && !selectedDataset && (
                <option value={draft.body.datasetId}>
                  {draft.body.datasetId}
                </option>
              )}
            </select>
            {datasetsLoading && (
              <span className="text-[11px] text-slate-400">
                {t("console.form.editor.loadingDatasets")}
              </span>
            )}
            {datasetsError && (
              <button
                type="button"
                data-testid="editor-form-datasets-retry"
                onClick={loadDatasets}
                className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100"
              >
                {t("console.form.editor.retry")}
              </button>
            )}
          </div>
          {datasetsError && (
            <p className="mt-1 text-[11px] text-red-600">{datasetsError}</p>
          )}

          {columns.length > 0 && (
            <div className="mt-2">
              <span className="text-[11px] text-slate-400">
                {t("console.form.editor.columnsLabel")}
              </span>
              <span className="ml-1 text-[10px] text-slate-300">
                {t("console.form.editor.columnsHint")}
              </span>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {columns.map((column) => (
                  <label
                    key={column.name}
                    className="flex items-center gap-1 text-[11px] text-slate-600"
                  >
                    <input
                      type="checkbox"
                      data-testid="editor-form-column"
                      data-column={column.name}
                      checked={draft.body.fields.some(
                        (f) => f.column === column.name,
                      )}
                      onChange={(e) => toggleColumn(column, e.target.checked)}
                    />
                    {column.name}
                    <span className="text-[10px] text-slate-300">{column.type}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="editor-form-submit-label" className="text-[11px] text-slate-400">
                {t("console.form.editor.submitLabelLabel")}
              </label>
              <input
                id="editor-form-submit-label"
                data-testid="editor-form-submit-label"
                value={draft.body.submitLabel ?? ""}
                placeholder={t("console.form.editor.submitLabelPlaceholder")}
                onChange={(e) =>
                  patchDraft({
                    body: { ...draft.body, submitLabel: e.target.value },
                  })
                }
                className="w-40 rounded border border-slate-300 px-2 py-1 text-xs"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="editor-form-success-message" className="text-[11px] text-slate-400">
                {t("console.form.editor.successMessageLabel")}
              </label>
              <input
                id="editor-form-success-message"
                data-testid="editor-form-success-message"
                value={draft.body.successMessage ?? ""}
                placeholder={t("console.form.editor.successMessagePlaceholder")}
                onChange={(e) =>
                  patchDraft({
                    body: { ...draft.body, successMessage: e.target.value },
                  })
                }
                className="w-64 rounded border border-slate-300 px-2 py-1 text-xs"
              />
            </div>
          </div>
        </div>

        {/* 字段卡列表：label/input/required/select options 逐字段可配。 */}
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <h3 className="text-xs font-semibold text-slate-600">
            {t("console.form.editor.columnsLabel")}
          </h3>
          {draft.body.fields.length === 0 && (
            <p data-testid="editor-form-empty-fields" className="mt-2 text-xs text-slate-400">
              {t("console.form.editor.columnsHint")}
            </p>
          )}
          <ul data-testid="editor-field-list" className="mt-2 space-y-2">
            {draft.body.fields.map((field) => (
              <li
                key={field.column}
                data-testid="editor-field"
                data-column={field.column}
                className="rounded border border-slate-200 p-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    data-testid="editor-field-column"
                    className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500"
                  >
                    {field.column}
                  </span>
                  {!columnNames.has(field.column) && (
                    <span
                      data-testid="editor-field-missing"
                      title={t("console.form.editor.fieldMissingColumn")}
                      className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700"
                    >
                      {t("console.form.editor.fieldMissingColumn")}
                    </span>
                  )}
                  <label className="ml-auto flex items-center gap-1 text-[11px] text-slate-500">
                    <input
                      type="checkbox"
                      data-testid="editor-field-required"
                      checked={field.required === true}
                      onChange={(e) =>
                        patchField(field.column, { required: e.target.checked })
                      }
                    />
                    {t("console.form.editor.fieldRequiredLabel")}
                  </label>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <label className="text-[11px] text-slate-400">
                    {t("console.form.editor.fieldLabelLabel")}
                  </label>
                  <input
                    data-testid="editor-field-label"
                    value={field.label}
                    onChange={(e) =>
                      patchField(field.column, { label: e.target.value })
                    }
                    className="w-36 rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                  <label className="text-[11px] text-slate-400">
                    {t("console.form.editor.fieldInputLabel")}
                  </label>
                  <select
                    data-testid="editor-field-input"
                    value={field.input}
                    onChange={(e) => {
                      const input = e.target.value as FormInputType;
                      patchField(field.column, {
                        input,
                        // select 切入时给一组空 options 占位（保存前必须配齐）。
                        ...(input === "select" && !field.options
                          ? { options: [] }
                          : {}),
                      });
                    }}
                    className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                  >
                    {FORM_INPUT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`console.form.editor.inputTypes.${type}`)}
                      </option>
                    ))}
                  </select>
                </div>
                {field.input === "select" && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <label className="text-[11px] text-slate-400">
                      {t("console.form.editor.fieldOptionsLabel")}
                    </label>
                    <input
                      data-testid="editor-field-options"
                      value={(field.options ?? []).join(", ")}
                      onChange={(e) =>
                        patchField(field.column, {
                          options: e.target.value
                            .split(",")
                            .map((option) => option.trim())
                            .filter((option) => option !== ""),
                        })
                      }
                      className="w-64 rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                  </div>
                )}
                {/* 显隐条件（wire-form-field-linkage）：开关默认关（无
                    visibleWhen 的既有字段零变化）；打开即给默认条件（当字段=
                    首个其他字段、算子=等于、值空——草稿允许中间态，保存自检
                    拦截）。 */}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1 text-[11px] text-slate-500">
                    <input
                      type="checkbox"
                      data-testid="editor-field-condition-toggle"
                      checked={field.visibleWhen !== undefined}
                      onChange={(e) => {
                        if (!e.target.checked) {
                          setFieldCondition(field.column, null);
                          return;
                        }
                        const other = draft.body.fields.find(
                          (f) => f.column !== field.column,
                        );
                        setFieldCondition(field.column, {
                          field: other?.column ?? "",
                          op: "eq",
                          value: "",
                        });
                      }}
                    />
                    {t("console.form.editor.conditionToggle")}
                  </label>
                </div>
                {field.visibleWhen && (
                  <div
                    data-testid="editor-field-condition"
                    className="mt-1.5 flex flex-wrap items-center gap-2"
                  >
                    <label className="text-[11px] text-slate-400">
                      {t("console.form.editor.conditionWhenLabel")}
                    </label>
                    <select
                      data-testid="editor-field-condition-field"
                      value={field.visibleWhen.field}
                      onChange={(e) =>
                        setFieldCondition(field.column, {
                          ...field.visibleWhen!,
                          field: e.target.value,
                        })
                      }
                      className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                    >
                      {(() => {
                        // 候选=同表单其他字段（选项 label、值 column）；条件
                        // 引用的字段已被移除时保留占位选项，值不漂移（保存
                        // 自检 conditionMissing 如实拦截）。
                        const others = draft.body.fields.filter(
                          (f) => f.column !== field.column,
                        );
                        const known = others.some(
                          (f) => f.column === field.visibleWhen?.field,
                        );
                        return (
                          <>
                            {!known && (
                              <option value={field.visibleWhen!.field}>
                                {field.visibleWhen!.field ||
                                  t("console.form.editor.conditionFieldPlaceholder")}
                              </option>
                            )}
                            {others.map((other) => (
                              <option key={other.column} value={other.column}>
                                {other.label || other.column}
                              </option>
                            ))}
                          </>
                        );
                      })()}
                    </select>
                    <label className="text-[11px] text-slate-400">
                      {t("console.form.editor.conditionOpLabel")}
                    </label>
                    <select
                      data-testid="editor-field-condition-op"
                      value={field.visibleWhen.op}
                      onChange={(e) => {
                        const op = e.target.value as FieldConditionOp;
                        const prev = field.visibleWhen!;
                        const emptyFamily = op === "empty" || op === "notEmpty";
                        // 切入 empty 族→value 键不落；切入带值算子→从空值
                        // 起步（或沿用既有值）。
                        setFieldCondition(field.column, {
                          field: prev.field,
                          op,
                          ...(emptyFamily
                            ? {}
                            : {
                                value:
                                  prev.value === undefined
                                    ? ""
                                    : prev.value,
                              }),
                        });
                      }}
                      className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                    >
                      {FIELD_CONDITION_OPS.map((op) => (
                        <option key={op} value={op}>
                          {t(`console.form.editor.conditionOps.${op}`)}
                        </option>
                      ))}
                    </select>
                    {field.visibleWhen.op !== "empty" &&
                      field.visibleWhen.op !== "notEmpty" && (
                        <>
                          <label className="text-[11px] text-slate-400">
                            {t("console.form.editor.conditionValueLabel")}
                          </label>
                          <input
                            data-testid="editor-field-condition-value"
                            value={String(field.visibleWhen.value ?? "")}
                            onChange={(e) =>
                              setFieldCondition(field.column, {
                                ...field.visibleWhen!,
                                value: e.target.value,
                              })
                            }
                            className="w-28 rounded border border-slate-300 px-2 py-1 text-xs"
                          />
                        </>
                      )}
                    <button
                      type="button"
                      data-testid="editor-field-condition-clear"
                      onClick={() => setFieldCondition(field.column, null)}
                      className="rounded border border-slate-300 px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100"
                    >
                      {t("console.form.editor.conditionClear")}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** 字段按数据集列序稳定重排：不在列清单的字段（数据集已演进）排在末尾并
 *  保留原相对顺序——绝不静默丢弃已配字段。 */
function sortFields(
  fields: FormField[],
  columns: DatasetColumn[],
): FormField[] {
  const order = new Map(columns.map((c, i) => [c.name, i]));
  return [...fields].sort(
    (a, b) =>
      (order.get(a.column) ?? columns.length) -
      (order.get(b.column) ?? columns.length),
  );
}
