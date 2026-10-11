"""form 产物 spec 结构校验（wire-form-builder 任务 1.1，design D1 第①层）
与提交 values 校验（任务 3.3，design D3）。

纯函数零依赖（不触库、不触引擎——artifacts 库内可独立测试）。校验对象是
spec 信封的 ``spec.spec`` 部分：``{datasetId, fields[], submitLabel?,
successMessage?}``，field = ``{column, label, input, required?, options?}``：

- ``datasetId``：null（构建中间态——可保存不可提交）或非空字符串；
- ``fields``：数组（可为空）；每项必须是对象：
  - ``column`` 非空字符串且表单内唯一（绑定数据集列名）；
  - ``label`` 非空字符串 ≤200；
  - ``input`` ∈ :data:`FIELD_INPUTS`（text/number/date/select）；
  - ``required`` 可省略（缺省 false 语义），在则必须是布尔值；
  - ``input=select`` 必带 ``options``（非空字符串列表）；
- ``submitLabel`` / ``successMessage`` 可省略，在则须为非空字符串 ≤200。

**列名是否仍在数据集中不在保存时裁决**（design D1 第③层定案——数据集列
会演进，钉死校验会让旧版本表单无法重存；列漂移的真相在提交时暴露，422
如实）。datasetId 的存在/属主校验是第②层，在 service 层经 datasets 库
会话完成（见 ``artifacts.service._require_form_dataset``）。

返回错误文案（None=合法）；文案带字段定位（如 ``fields[2].column 重复:
region``）逐条可断言。
"""

from __future__ import annotations

import math
import re

#: 表单字段输入形态枚举（提交面按此做类型校验的依据）
FIELD_INPUTS: tuple[str, ...] = ("text", "number", "date", "select")
#: 文案字段（label / submitLabel / successMessage）长度上限
TEXT_LIMIT = 200

#: date 输入的口径：YYYY-MM-DD（拒绝时间部分——design D3）
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _text_error(value: object, *, what: str) -> str | None:
    """非空字符串 ≤ :data:`TEXT_LIMIT` 校验；返回错误文案或 None。"""
    if not isinstance(value, str) or not value.strip():
        return f"{what} 必须是非空字符串"
    if len(value) > TEXT_LIMIT:
        return f"{what} 长度超过 {TEXT_LIMIT} 上限"
    return None


def validate_form_spec(inner: object) -> str | None:
    """form spec 结构校验（``spec.spec`` 部分）；返回错误文案（None=合法）。

    调用方（``artifacts.service``）已先过通用口径 validate_spec（信封
    title 非空 + spec.spec 非空对象）——本函数只管 form 结构层。
    """
    if not isinstance(inner, dict):
        return "spec.spec 必须是 JSON 对象"
    dataset_id = inner.get("datasetId")
    if dataset_id is not None and (
        not isinstance(dataset_id, str) or not dataset_id.strip()
    ):
        return "spec.spec.datasetId 必须是 null 或非空字符串（数据集 id）"
    fields = inner.get("fields")
    if not isinstance(fields, list):
        return "spec.spec.fields 必须是数组"
    seen_columns: set[str] = set()
    for index, field in enumerate(fields):
        where = f"fields[{index}]"
        if not isinstance(field, dict):
            return f"{where} 必须是 JSON 对象"
        column = field.get("column")
        if not isinstance(column, str) or not column.strip():
            return f"{where}.column 必须是非空字符串（绑定数据集列名）"
        if column in seen_columns:
            return f"{where}.column 重复: {column}"
        seen_columns.add(column)
        label_error = _text_error(field.get("label"), what=f"{where}.label")
        if label_error is not None:
            return label_error
        input_kind = field.get("input")
        if input_kind not in FIELD_INPUTS:
            return (
                f"{where}.input 必须是 {'/'.join(FIELD_INPUTS)}"
                f"（收到 {input_kind!r}）"
            )
        required = field.get("required", False)
        if not isinstance(required, bool):
            return f"{where}.required 必须是布尔值（可省略，缺省 false）"
        if input_kind == "select":
            options = field.get("options")
            if (
                not isinstance(options, list)
                or not options
                or not all(
                    isinstance(option, str) and option.strip()
                    for option in options
                )
            ):
                return f"{where}.options 必须是非空字符串列表（input=select 必带）"
    for key in ("submitLabel", "successMessage"):
        if key in inner:
            error = _text_error(inner[key], what=f"spec.spec.{key}")
            if error is not None:
                return error
    return None


# ------------------------------------------------------- 提交 values 校验（D3）


def _field_label(field: dict, column: str) -> str:
    """字段的人读定位（label 优先，缺席回退 column）。"""
    label = field.get("label")
    if isinstance(label, str) and label.strip():
        return label
    return column


def _normalize_field_value(
    column: str, field: dict, value: object
) -> tuple[object, str | None]:
    """单字段值类型校验与归一；返回 (归一值, None) 或 (None, 错误文案)。

    规则（design D3）：
    - ``number``：int/float 或可 ``float()`` 的字符串（NaN/Inf/非有限拒），
      归一为数值（字符串解析结果为 float；原生 int/float 保持原类型）；
      布尔值不是数值（Python bool 是 int 子类——显式拒）；
    - ``date``：字符串且 ``^\\d{4}-\\d{2}-\\d{2}$``（regex 口径，拒时间部分）；
    - ``select``：值必须 ∈ options（字符串精确匹配）；
    - ``text``：字符串原样；数字/布尔标量 stringify（布尔按 JSON 口径
      true/false）；list/dict 一律拒。
    """
    where = f"字段 {_field_label(field, column)}（{column}）"
    input_kind = field.get("input")
    if input_kind == "number":
        if isinstance(value, bool):
            return None, f"{where} 必须是数值（收到布尔值 {value}）"
        if isinstance(value, (int, float)):
            if not math.isfinite(float(value)):
                return None, f"{where} 必须是有限数值（收到 {value!r}）"
            return value, None
        if isinstance(value, str):
            try:
                number = float(value.strip())
            except ValueError:
                return None, (
                    f"{where} 必须是数值或可解析为数值的字符串（收到 {value!r}）"
                )
            if not math.isfinite(number):
                return None, f"{where} 必须是有限数值（收到 {value!r}）"
            return number, None
        return None, f"{where} 必须是数值或可解析为数值的字符串（收到 {value!r}）"
    if input_kind == "date":
        if not isinstance(value, str) or not _DATE_RE.match(value):
            return None, f"{where} 必须是 YYYY-MM-DD 格式日期（收到 {value!r}）"
        return value, None
    if input_kind == "select":
        options = field.get("options")
        options = options if isinstance(options, list) else []
        if not isinstance(value, str) or value not in options:
            return None, f"{where} 必须是选项之一 {options}（收到 {value!r}）"
        return value, None
    # text（保存校验已拦越枚举 input；未知 input 兜底按 text 收——防御位）
    if isinstance(value, str):
        return value, None
    if isinstance(value, bool):
        return ("true" if value else "false"), None
    if isinstance(value, (int, float)):
        if not math.isfinite(float(value)):
            return None, f"{where} 必须是有限数值（收到 {value!r}）"
        return str(value), None
    return None, f"{where} 必须是字符串或标量（收到 {value!r}）"


def validate_form_values(
    fields: object, values: object
) -> tuple[dict | None, str | None]:
    """表单提交 values 校验（wire-form-builder design D3）——纯函数零依赖。

    入参：``fields`` = 钉死版本 ``spec.spec.fields``（字段定义数组）；
    ``values`` = 提交载荷的整行值。返回 ``(归一后 values, None)`` 或
    ``(None, 错误文案)``——文案字段级定位、可直接作 422 detail。

    规则：
    - ``values`` 必须是 JSON 对象；
    - 只收 ``fields`` 声明过的列——未定义列即拒（文案带可用列）；
    - 必填字段缺失/空串/仅空白/null → 文案；
    - 非必填字段未传/传 null/空串 = 跳过（**不写键**——下游 insert 不落
      null 键，design D3「未勾字段不传即缺省」）；
    - 其余值按 ``_normalize_field_value`` 类型校验并归一。
    """
    if not isinstance(values, dict):
        return None, "values 必须是 JSON 对象（整行值）"
    if not isinstance(fields, list):
        return None, "表单字段定义缺失（fields 必须是数组）"
    known: dict[str, dict] = {}
    for field in fields:
        if not isinstance(field, dict):  # 防御位：保存校验已拦非对象字段
            continue
        column = field.get("column")
        if isinstance(column, str) and column:
            known[column] = field
    unknown = sorted(
        key for key in values if not isinstance(key, str) or key not in known
    )
    if unknown:
        available = "、".join(known) if known else "无"
        return None, (
            f"values 含未在表单中定义的列 {unknown[0]!r}（表单字段: {available}）"
        )
    normalized: dict = {}
    for column, field in known.items():  # 声明序（首个错误即返回）
        value = values.get(column)
        if value is None or (isinstance(value, str) and not value.strip()):
            if field.get("required", False):
                return None, f"必填字段 {_field_label(field, column)}（{column}）缺失或为空"
            continue  # 非必填未传/空 = 跳过，不写键
        normalized_value, error = _normalize_field_value(column, field, value)
        if error is not None:
            return None, error
        normalized[column] = normalized_value
    return normalized, None
