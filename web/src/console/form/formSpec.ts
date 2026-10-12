// 表单 spec 契约与纯函数（wire-form-builder 任务 4.1）。
//
// 存储形状：产物 spec 是信封 `{title, spec:{datasetId, fields[], submitLabel?,
// successMessage?}}`（内层即表单本体）；field = `{column, label,
// input: text|number|date|select, required?, options?, visibleWhen?}`（select
// 须带非空 options；column 表单内唯一；visibleWhen 为可选单显隐条件——
// wire-form-field-linkage）。结构自检（validateFormSpec）与提交前校验
// （validateFormValues）在此集中——FormEditor（保存前）与 FormRuntime
// （提交前）共用同一套规则，与后端 artifacts/form_spec.py 同源：前端先拦
// 只是体验层，后端仍是唯一裁决面（422 如实呈现）。
//
// 显隐联动（wire-form-field-linkage）：字段可带可选单条件 visibleWhen
// （当另一字段的值满足算子时显示）。evaluateFieldVisibility 纯函数求隐藏
// 集（运行时每次 values 变化重求）；validateFormValues 联动感知（隐藏字段
// 带值拒、必填只在可见时强制）。
import type { DatasetColumn } from "../api";

export const FORM_INPUT_TYPES = ["text", "number", "date", "select"] as const;
export type FormInputType = (typeof FORM_INPUT_TYPES)[number];

/** 显隐条件算子枚举（wire-form-field-linkage；与 api 侧同源冻结）。 */
export const FIELD_CONDITION_OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "empty",
  "notEmpty",
] as const;
export type FieldConditionOp = (typeof FIELD_CONDITION_OPS)[number];

/** 字段可选单显隐条件：当 `field`（同表单另一字段的 column）满足 `op`
 *  （必要时对照 `value`）时本字段可见。empty/notEmpty 不带 value；其余
 *  算子 value 必为标量且字符串形态 trim 非空。 */
export interface FieldVisibleWhen {
  field: string;
  op: FieldConditionOp;
  value?: string | number | boolean;
}

export interface FormField {
  /** 目标数据集列名（提交 values 的键）。 */
  column: string;
  /** 呈现名（缺省=列名）。 */
  label: string;
  input: FormInputType;
  required?: boolean;
  /** select 专属：候选选项（保存时须非空）。 */
  options?: string[];
  /** 可选显隐条件（缺省无条件=恒可见）。 */
  visibleWhen?: FieldVisibleWhen;
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

/** visibleWhen 逐键校验（wire-form-field-linkage）：field 非空 string、
 *  op ∈ 枚举、value 标量且字符串形态 trim 非空（empty 族不得带 value）。
 *  合法则保留（value 保持原标量类型），非法返回 undefined（整键丢弃——
 *  宽容解析绝不整单失败）。自引用/引用不存在属保存校验（编辑器草稿）面，
 *  解析层不裁决（历史已存 spec 照常呈现）。 */
export function normalizeVisibleWhen(raw: unknown): FieldVisibleWhen | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const cond = raw as Record<string, unknown>;
  const field = cond.field;
  const op = cond.op;
  if (typeof field !== "string" || !field.trim()) return undefined;
  if (
    typeof op !== "string" ||
    !FIELD_CONDITION_OPS.includes(op as FieldConditionOp)
  ) {
    return undefined;
  }
  const kind = op as FieldConditionOp;
  const value = cond.value;
  if (kind === "empty" || kind === "notEmpty") {
    if (value !== undefined) return undefined;
    return { field, op: kind };
  }
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return undefined;
  }
  if (String(value).trim() === "") return undefined;
  return { field, op: kind, value };
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
    const visibleWhen = normalizeVisibleWhen(f.visibleWhen);
    fields.push({
      column: f.column,
      label: typeof f.label === "string" && f.label ? f.label : f.column,
      input,
      ...(f.required === true ? { required: true } : {}),
      ...(input === "select" && options ? { options } : {}),
      ...(visibleWhen ? { visibleWhen } : {}),
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
  | "successMessageTooLong"
  | "conditionBad"
  | "conditionSelf"
  | "conditionMissing";

/** 单个 visibleWhen 的草稿校验（编辑器保存前自检用；历史已存 spec 的
 *  解析层不裁决）：形状/op 越枚举/value 非法 → "conditionBad"；
 *  自引用 → "conditionSelf"；引用字段不存在 → "conditionMissing"；
 *  合法 → 无错误。 */
function visibleWhenError(
  field: FormField,
  columns: Set<string>,
): FormSpecErrorCode | null {
  const cond = field.visibleWhen;
  if (!cond || typeof cond !== "object") return "conditionBad";
  const op = cond.op;
  if (
    typeof cond.field !== "string" ||
    !cond.field.trim() ||
    typeof op !== "string" ||
    !FIELD_CONDITION_OPS.includes(op as FieldConditionOp)
  ) {
    return "conditionBad";
  }
  const emptyFamily = op === "empty" || op === "notEmpty";
  const value = cond.value;
  if (emptyFamily) {
    if (value !== undefined) return "conditionBad";
  } else if (
    (typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean") ||
    String(value).trim() === ""
  ) {
    return "conditionBad";
  }
  if (cond.field === field.column) return "conditionSelf";
  if (!columns.has(cond.field)) return "conditionMissing";
  return null;
}

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
  // 全量列名集（conditionMissing 的引用存在性对照——先收集后校验，字段
  // 顺序不影响结果）。
  const allColumns = new Set(
    body.fields
      .filter(
        (f) =>
          f && typeof f.column === "string" && (f.column as string).length > 0,
      )
      .map((f) => f.column),
  );
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
    if (field.visibleWhen !== undefined) {
      const condError = visibleWhenError(field, allColumns);
      if (condError) errors.push(condError);
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

/** 数值串判定（gt/gte/lt/lte 数值比较的前置）：lhs 与 rhs 双双匹配才走
 *  Number() 数值比较，否则字符串字典序（与 api 侧同款冻结口径）。 */
const NUMERIC_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

/** 显隐条件求值（wire-form-field-linkage，与 api 侧同规纯函数）：
 *  返回当前 values 下的**隐藏** column 集（不在集内=可见）。
 *
 * 规则：无 visibleWhen → 可见。空值 = 缺键 / null / undefined /
 *  String(ctrl).trim()===""（数字 0 与 false 不是空值）。empty：ctrl 为
 * 空值 → 条件真（显示本字段）；notEmpty 反之。带值算子在 ctrl 为空值时
 * 一律条件假（含 neq）→ 隐藏。非空时 lhs=String(ctrl).trim()（bool →
 * "true"/"false"）、rhs=String(value).trim()；eq/neq 精确串比、contains
 * 子串、比较族走 NUMERIC_RE 双匹配数值比否则字典序。**不递归**：条件只看
 * values，不看控制字段自身的可见性。 */
export function evaluateFieldVisibility(
  fields: FormField[],
  values: Record<string, unknown>,
): Set<string> {
  const hidden = new Set<string>();
  for (const field of fields) {
    const cond = field.visibleWhen;
    if (!cond) continue;
    const ctrl = values[cond.field];
    const ctrlEmpty = ctrl == null || String(ctrl).trim() === "";
    let visible: boolean;
    if (cond.op === "empty") {
      visible = ctrlEmpty;
    } else if (cond.op === "notEmpty") {
      visible = !ctrlEmpty;
    } else {
      if (ctrlEmpty) {
        visible = false;
      } else {
        const lhs = String(ctrl).trim();
        const rhs = String(cond.value).trim();
        switch (cond.op) {
          case "eq":
            visible = lhs === rhs;
            break;
          case "neq":
            visible = lhs !== rhs;
            break;
          case "contains":
            visible = lhs.includes(rhs);
            break;
          default: {
            // gt/gte/lt/lte：双方皆为数值串才数值比较，否则字典序。
            if (NUMERIC_RE.test(lhs) && NUMERIC_RE.test(rhs)) {
              const a = Number(lhs);
              const b = Number(rhs);
              visible =
                cond.op === "gt"
                  ? a > b
                  : cond.op === "gte"
                    ? a >= b
                    : cond.op === "lt"
                      ? a < b
                      : a <= b;
            } else {
              visible =
                cond.op === "gt"
                  ? lhs > rhs
                  : cond.op === "gte"
                    ? lhs >= rhs
                    : cond.op === "lt"
                      ? lhs < rhs
                      : lhs <= rhs;
            }
          }
        }
      }
    }
    if (!visible) hidden.add(field.column);
  }
  return hidden;
}

/** 提交前逐字段校验错误码（运行时按 console.form.runtime.errors.<code> 映射）。 */
export type FormValueErrorCode =
  | "required"
  | "number"
  | "date"
  | "select"
  | "text"
  | "hidden";

export interface FormValuesValidation {
  /** 归一后的提交 values（仅通过校验的字段；非必填缺省不写键——不写 null/空串）。 */
  values: Record<string, unknown>;
  /** 逐字段错误：column → 机器码；空对象=全部通过。 */
  errors: Record<string, FormValueErrorCode>;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** values 提交前校验+归一（与后端公开提交类型校验同规则；显隐联动感知）：
 *  先求 hidden 集——hidden 字段 raw 值非空（trim 后）→ errors="hidden"
 *  （隐藏不可携带值）、值为空→跳过不写键、required 不查；可见字段现有
 *  行为逐字不变。number 收数值或可 parseFloat 的数字串（NaN/Inf 拒）并
 *  归一为数值；date 须 YYYY-MM-DD（regex，拒绝时间部分）；select 须 ∈
 *  options；text 收标量（数字/布尔 stringify，对象/数组拒）；非必填缺省
 *  跳过。 */
export function validateFormValues(
  fields: FormField[],
  raw: Record<string, unknown>,
): FormValuesValidation {
  const values: Record<string, unknown> = {};
  const errors: Record<string, FormValueErrorCode> = {};
  const hidden = evaluateFieldVisibility(fields, raw);
  for (const field of fields) {
    const value = raw[field.column];
    if (hidden.has(field.column)) {
      // 隐藏字段：带值（trim 后非空）即拒；空值跳过（不写键、不查 required）。
      const text = value == null ? "" : String(value).trim();
      if (text !== "") errors[field.column] = "hidden";
      continue;
    }
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
