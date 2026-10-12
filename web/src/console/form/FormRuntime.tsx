// 表单运行时（wire-form-builder 任务 4.2）——console 详情与公开分享页共用。
//
// props {spec, endpoint}：console 态提交走既有 corrections 端点
// （addCorrection op=insert，带登录会话）；公开态走分享 submit 端点
// （postPublicJson，免登录、绝不携带 Bearer）。必填/类型前端先拦
// （validateFormValues——与后端规则同源的纯函数），逐字段错误呈现；
// 成功显示 successMessage（缺省文案 i18n）；datasetId==null 渲染
// 「未绑定数据集」诚实态（不可提交）。服务端 422/429/404 的 detail
// 如实呈现，绝不静默吞掉。
//
// 显隐联动（wire-form-field-linkage）：每次 values 变化重求隐藏集
// （evaluateFieldVisibility），隐藏字段不渲染（连 label 都不出）；字段从
// 可见转隐藏即清其 state 值（重新可见从空开始）；提交走联动感知
// validateFormValues（隐藏必填不拦、隐藏携带值拒）。分享页共用本组件，
// 联动自动生效。
//
// 联动 v1+（wire-form-linkage-v2）：①组条件显隐走同一 evaluateFieldVisibility
// （all/any）；②select 动态选项——optionsFrom 按当前 raw values 解析
// （resolveSelectOptions），解析为空的字段并入隐藏集走现行隐藏渲染路径；
// 解析选项变化且现值不在新选项集 → 立即清值（与隐藏清值同款纪律，提交
// 载荷不含；级联由 setValues 触发的重渲染自然推进）。
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { addCorrection, apiErrorText, postPublicJson } from "../api";
import {
  evaluateFieldVisibility,
  resolveSelectOptions,
  validateFormValues,
  type FormSpecBody,
} from "./formSpec";

/** 提交目标：console 态（corrections 端点，datasetId 随表单绑定）/ 公开态
 *  （分享 submit 端点完整地址，t/v 已进 query）。 */
export type FormRuntimeEndpoint =
  | { kind: "console"; datasetId: string | null }
  | { kind: "public"; url: string };

export function FormRuntime({
  spec,
  endpoint,
}: {
  spec: FormSpecBody;
  endpoint: FormRuntimeEndpoint;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 显隐联动：每次 values 变化重求隐藏集（hooks 先于下方 unbound 早退——
  // 组件实例跨 spec 演进保持 hook 顺序稳定）。
  const hiddenColumns = useMemo(
    () => evaluateFieldVisibility(spec.fields, values),
    [spec, values],
  );
  // 稳定依赖键（Set 每次新建；排序串只在隐藏集真正变化时推进 effect）。
  const hiddenKey = useMemo(
    () => [...hiddenColumns].sort().join("\u0000"),
    [hiddenColumns],
  );
  // 字段从可见转隐藏即清其 state 值（隐藏即清，重新可见从空开始——
  // Non-Goal 定案）。级联（隐藏的控制字段被清值→下游可见性变化）由
  // setValues 触发的重渲染自然推进。
  useEffect(() => {
    if (hiddenColumns.size === 0) return;
    setValues((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const column of hiddenColumns) {
        if (next[column]) {
          next[column] = "";
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenKey]);

  // select 动态选项（wire-form-linkage-v2）：按当前 raw values 逐 select
  // 解析候选（optionsFrom 命中 cases/回退 fallback；静态 options 原样）。
  // 解析为空的字段已由 evaluateFieldVisibility 并入隐藏集（走现行隐藏渲染
  // 与清值路径——不可填即不可见）。
  const selectOptions = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const field of spec.fields) {
      if (field.input === "select") {
        map[field.column] = resolveSelectOptions(field, values);
      }
    }
    return map;
  }, [spec, values]);
  // 稳定依赖键（选项列表真正变化时才推进下方清值 effect）。
  const selectOptionsKey = useMemo(
    () =>
      Object.entries(selectOptions)
        .map(([column, options]) => `${column}:${options.join("\u0001")}`)
        .join("\u0000"),
    [selectOptions],
  );
  // 解析选项变化且现值不在新选项集 → 立即清值（与「隐藏即清」同款纪律：
  // 现值绝不进提交载荷；级联清理由 setValues 触发的重渲染自然推进）。
  useEffect(() => {
    setValues((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [column, options] of Object.entries(selectOptions)) {
        const current = next[column];
        if (current && !options.includes(current)) {
          next[column] = "";
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectOptionsKey]);

  // 未绑定数据集诚实态（构建中间态）：如实呈现而非可提交表单。
  // （局部 const 承接窄化——闭包内保持非空。）
  const boundDatasetId = spec.datasetId;
  if (boundDatasetId == null) {
    return (
      <div
        data-testid="form-runtime-unbound"
        className="rounded-md border border-amber-200 bg-amber-50/60 p-4 text-center"
      >
        <p className="text-sm font-medium text-amber-700">
          {t("console.form.runtime.unboundTitle")}
        </p>
        <p className="mt-1 text-xs text-amber-600">
          {t("console.form.runtime.unboundBody")}
        </p>
      </div>
    );
  }

  const setValue = (column: string, value: string) => {
    setValues((prev) => ({ ...prev, [column]: value }));
    setFieldErrors((prev) => {
      if (!(column in prev)) return prev;
      const next = { ...prev };
      delete next[column];
      return next;
    });
    setSubmitError(null);
  };

  /** 提交：前端先拦（必填/类型）→ console 走 corrections / 公开走分享端点；
   *  成功显示 successMessage 并清空重填（表单面向重复录入），失败如实呈现。 */
  const submit = async () => {
    if (submitting) return;
    const validation = validateFormValues(spec.fields, values);
    if (Object.keys(validation.errors).length > 0) {
      setFieldErrors(validation.errors);
      setSubmitError(null);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    setSubmitError(null);
    try {
      let message: string;
      if (endpoint.kind === "console") {
        await addCorrection(endpoint.datasetId ?? boundDatasetId, {
          op: "insert",
          values: validation.values,
        });
        message =
          spec.successMessage?.trim() || t("console.form.runtime.successDefault");
      } else {
        const result = (await postPublicJson(endpoint.url, {
          values: validation.values,
        })) as { message?: unknown };
        message =
          (typeof result?.message === "string" && result.message) ||
          spec.successMessage?.trim() ||
          t("console.form.runtime.successDefault");
      }
      setSuccess(message);
      setValues({});
    } catch (err) {
      // 422 字段级原因 / 429 限流与行数闸 / 404 链接失效：detail 如实呈现。
      setSubmitError(
        apiErrorText(err, t("console.form.runtime.submitFailed")),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submitLabel = spec.submitLabel?.trim() || t("console.form.runtime.submitDefault");

  return (
    <form
      data-testid="form-runtime"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="max-w-xl space-y-3"
    >
      {/* 隐藏字段不渲染（连 label 都不出）；可见性由上方 hiddenColumns 决定。 */}
      {spec.fields
        .filter((field) => !hiddenColumns.has(field.column))
        .map((field) => {
        const error = fieldErrors[field.column];
        const fieldLabel = field.label || field.column;
        return (
          <div key={field.column} data-testid="form-field" data-column={field.column}>
            <label
              htmlFor={`form-field-${field.column}`}
              className="flex flex-wrap items-center gap-1 text-xs text-slate-600"
            >
              <span>{fieldLabel}</span>
              {field.required && (
                <span
                  data-testid="form-field-required"
                  title={t("console.form.runtime.requiredMark")}
                  className="rounded bg-rose-100 px-1 text-[10px] text-rose-600"
                >
                  {t("console.form.runtime.requiredMark")}
                </span>
              )}
            </label>
            {field.input === "select" ? (
              <select
                id={`form-field-${field.column}`}
                data-testid="form-field-input"
                value={values[field.column] ?? ""}
                onChange={(e) => setValue(field.column, e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">—</option>
                {/* 动态选项（wire-form-linkage-v2）：按当前 raw values 解析
                    （optionsFrom 命中 cases/回退 fallback；静态原样）。 */}
                {(selectOptions[field.column] ?? field.options ?? []).map(
                  (option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ),
                )}
              </select>
            ) : (
              /* 文本输入承载全部类型（number/date 由 validateFormValues 统一校验
                 归一——不依赖浏览器原生控件，规则与后端公开提交同源）。 */
              <input
                id={`form-field-${field.column}`}
                data-testid="form-field-input"
                type="text"
                inputMode={field.input === "number" ? "decimal" : undefined}
                placeholder={field.input === "date" ? "YYYY-MM-DD" : undefined}
                value={values[field.column] ?? ""}
                onChange={(e) => setValue(field.column, e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            )}
            {error && (
              <p
                data-testid="form-field-error"
                data-column={field.column}
                className="mt-0.5 text-[11px] text-red-600"
              >
                {t(`console.form.runtime.errors.${error}`)}
              </p>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          data-testid="form-submit"
          disabled={submitting}
          className="rounded bg-slate-900 px-4 py-1.5 text-xs text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting
            ? t("console.form.runtime.submitting")
            : submitLabel}
        </button>
        {success && (
          <span
            data-testid="form-success"
            className="text-xs text-emerald-600"
          >
            {success}
          </span>
        )}
        {submitError && (
          <span data-testid="form-submit-error" className="text-xs text-red-600">
            {submitError}
          </span>
        )}
      </div>
    </form>
  );
}
