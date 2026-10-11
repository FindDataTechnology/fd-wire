// 表单 spec 契约与纯函数（wire-form-builder 任务 4.1）。
//
// 存储形状：产物 spec 是信封 `{title, spec:{datasetId, fields[], submitLabel?,
// successMessage?}}`（内层即表单本体）；field = `{column, label,
// input: text|number|date|select, required?, options?}`（select 须带非空
// options；column 表单内唯一）。结构自检（validateFormSpec）与提交前校验
// （validateFormValues）在此集中——FormEditor（保存前）与 FormRuntime
// （提交前）共用同一套规则，与后端 artifacts/form_spec.py 同源：前端先拦
// 只是体验层，后端仍是唯一裁决面（422 如实呈现）。
import type { DatasetColumn } from "../api";

export const FORM_INPUT_TYPES = ["text", "number", "date", "select"] as const;
export type FormInputType = (typeof FORM_INPUT_TYPES)[number];

export interface FormField {
  /** 目标数据集列名（提交 values 的键）。 */
  column: string;
  /** 呈现名（缺省=列名）。 */
  label: string;
  input: FormInputType;
  required?: boolean;
  /** select 专属：候选选项（保存时须非空）。 */
  options?: string[];
}

/** 表单本体（信封的 spec 内层）。datasetId=null 为构建中间态（可保存不可提交）。 */
export interface FormSpecBody {
  datasetId: string | null;
  fields: FormField[];
  submitLabel?: string;
  successMessage?: string;
}

/** 文案长度上限（与后端 form_spec 校验同源口径）。 */
export const FORM_TEXT_LIMITS = {
  title: 200,
  label: 100,
  submitLabel: 50,
  successMessage: 200,
} as const;

/** 列类型 → 建议输入类型：数值列 number、日期列 date、其余（含拿不到类型）text。 */
export function suggestInputType(columnType: string): FormInputType {
  if (/int|float|double|decimal|numeric|real|number/i.test(columnType)) {
    return "number";
  }
  if (/date/i.test(columnType)) return "date";
  return "text";
}

/** 列 → 默认字段：label=列名、input 按列类型建议、非必填。 */
export function fieldFromColumn(column: DatasetColumn): FormField {
  return {
    column: column.name,
    label: column.name,
    input: suggestInputType(column.type),
  };
}

/** 列清单 + 勾选 → 字段数组：字段顺序=数据集列序（spec 冻结口径）。 */
export function fieldsFromColumns(
  columns: DatasetColumn[],
  selected: string[],
): FormField[] {
  const keep = new Set(selected);
  return columns.filter((c) => keep.has(c.name)).map(fieldFromColumn);
}

/** 信封组装：编辑器保存时把表单本体放回产物信封（saveArtifactSpec 入参）。
 *  submitLabel/successMessage 仅在非空时写入（缺省不落键）。 */
export function buildFormEnvelope(
  title: string,
  body: FormSpecBody,
): { title: string; spec: FormSpecBody } {
  const spec: FormSpecBody = {
    datasetId: body.datasetId,
    fields: body.fields,
  };
  const submitLabel = body.submitLabel?.trim();
  const successMessage = body.successMessage?.trim();
  if (submitLabel) spec.submitLabel = submitLabel;
  if (successMessage) spec.successMessage = successMessage;
  return { title, spec };
}

/** 宽容解析产物 spec → 表单本体：同时接受信封（产物详情原样）与本体
 *  （内层直给）两种输入；无 fields 数组视为非表单 spec，返回 null。
 *  字段逐个归一（缺 label 回退列名、非法 input 回退 text），绝不整单失败。 */
export function parseFormSpec(raw: unknown): FormSpecBody | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const inner =
    record.spec && typeof record.spec === "object"
      ? (record.spec as Record<string, unknown>)
      : record;
  if (!Array.isArray(inner.fields)) return null;
  const fields: FormField[] = [];
  for (const entry of inner.fields) {
    if (!entry || typeof entry !== "object") continue;
    const f = entry as Record<string, unknown>;
    if (typeof f.column !== "string" || !f.column) continue;
    const input = FORM_INPUT_TYPES.includes(f.input as FormInputType)
      ? (f.input as FormInputType)
      : "text";
    const options = Array.isArray(f.options)
      ? f.options.filter((o): o is string => typeof o === "string")
      : undefined;
    fields.push({
      column: f.column,
      label: typeof f.label === "string" && f.label ? f.label : f.column,
      input,
      ...(f.required === true ? { required: true } : {}),
      ...(input === "select" && options ? { options } : {}),
    });
  }
  return {
    datasetId: typeof inner.datasetId === "string" ? inner.datasetId : null,
    fields,
    ...(typeof inner.submitLabel === "string" && inner.submitLabel
      ? { submitLabel: inner.submitLabel }
      : {}),
    ...(typeof inner.successMessage === "string" && inner.successMessage
      ? { successMessage: inner.successMessage }
      : {}),
  };
}

/** 结构自检错误码（编辑器按 console.form.editor.errors.<code> 映射文案）。 */
export type FormSpecErrorCode =
  | "titleRequired"
  | "titleTooLong"
  | "badField"
  | "inputInvalid"
  | "columnDuplicate"
  | "selectOptions"
  | "labelTooLong"
  | "submitLabelTooLong"
  | "successMessageTooLong";

/** 结构自检（保存前；与后端 form_spec 规则同源）：title 非空+上限、字段
 *  结构合法、input 枚举、column 唯一、select 非空 options、文案长度上限。
 *  datasetId 非空时的存在性/属主由服务端裁决（422 如实呈现），此处不查。 */
export function validateFormSpec(
  title: string,
  body: FormSpecBody,
): FormSpecErrorCode[] {
  const errors: FormSpecErrorCode[] = [];
  const trimmedTitle = title.trim();
  if (!trimmedTitle) errors.push("titleRequired");
  else if (trimmedTitle.length > FORM_TEXT_LIMITS.title) errors.push("titleTooLong");
  const seen = new Set<string>();
  for (const field of body.fields) {
    if (
      !field ||
      typeof field.column !== "string" ||
      !field.column ||
      typeof field.label !== "string"
    ) {
      errors.push("badField");
      continue;
    }
    if (!FORM_INPUT_TYPES.includes(field.input)) errors.push("inputInvalid");
    if (seen.has(field.column)) errors.push("columnDuplicate");
    seen.add(field.column);
    if (field.input === "select") {
      const options = (field.options ?? []).filter((o) => o.trim());
      if (options.length === 0) errors.push("selectOptions");
    }
    if ((field.label ?? "").length > FORM_TEXT_LIMITS.label) {
      errors.push("labelTooLong");
    }
  }
  if ((body.submitLabel?.trim().length ?? 0) > FORM_TEXT_LIMITS.submitLabel) {
    errors.push("submitLabelTooLong");
  }
  if (
    (body.successMessage?.trim().length ?? 0) > FORM_TEXT_LIMITS.successMessage
  ) {
    errors.push("successMessageTooLong");
  }
  return errors;
}

/** 提交前逐字段校验错误码（运行时按 console.form.runtime.errors.<code> 映射）。 */
export type FormValueErrorCode = "required" | "number" | "date" | "select" | "text";

export interface FormValuesValidation {
  /** 归一后的提交 values（仅通过校验的字段；非必填缺省不写键——不写 null/空串）。 */
  values: Record<string, unknown>;
  /** 逐字段错误：column → 机器码；空对象=全部通过。 */
  errors: Record<string, FormValueErrorCode>;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** values 提交前校验+归一（与后端公开提交类型校验同规则）：
 *  number 收数值或可 parseFloat 的数字串（NaN/Inf 拒）并归一为数值；
 *  date 须 YYYY-MM-DD（regex，拒绝时间部分）；select 须 ∈ options；
 *  text 收标量（数字/布尔 stringify，对象/数组拒）；非必填缺省跳过。 */
export function validateFormValues(
  fields: FormField[],
  raw: Record<string, unknown>,
): FormValuesValidation {
  const values: Record<string, unknown> = {};
  const errors: Record<string, FormValueErrorCode> = {};
  for (const field of fields) {
    const value = raw[field.column];
    if (value !== null && typeof value === "object") {
      errors[field.column] = "text";
      continue;
    }
    const text = value == null ? "" : String(value).trim();
    if (text === "") {
      if (field.required) errors[field.column] = "required";
      continue;
    }
    switch (field.input) {
      case "number": {
        const num = typeof value === "number" ? value : Number(text);
        if (Number.isFinite(num)) values[field.column] = num;
        else errors[field.column] = "number";
        break;
      }
      case "date": {
        const match = DATE_RE.exec(text);
        const month = match ? Number(match[2]) : 0;
        const day = match ? Number(match[3]) : 0;
        if (match && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          values[field.column] = text;
        } else {
          errors[field.column] = "date";
        }
        break;
      }
      case "select": {
        if ((field.options ?? []).includes(text)) values[field.column] = text;
        else errors[field.column] = "select";
        break;
      }
      default: {
        // text：标量 stringify（运行时输入本就是字符串；数字/布尔转字符串）。
        values[field.column] = text;
      }
    }
  }
  return { values, errors };
}
