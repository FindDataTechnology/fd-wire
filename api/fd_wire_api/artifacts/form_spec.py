"""form 产物 spec 结构校验（wire-form-builder 任务 1.1，design D1 第①层）
与提交 values 校验（任务 3.3，design D3）；字段显隐联动（wire-form-field-
linkage 任务 1-2）。

纯函数零依赖（不触库、不触引擎——artifacts 库内可独立测试）。校验对象是
spec 信封的 ``spec.spec`` 部分：``{datasetId, fields[], submitLabel?,
successMessage?}``，field = ``{column, label, input, required?, options?,
visibleWhen?}``：

- ``datasetId``：null（构建中间态——可保存不可提交）或非空字符串；
- ``fields``：数组（可为空）；每项必须是对象：
  - ``column`` 非空字符串且表单内唯一（绑定数据集列名）；
  - ``label`` 非空字符串 ≤200；
  - ``input`` ∈ :data:`FIELD_INPUTS`（text/number/date/select）；
  - ``required`` 可省略（缺省 false 语义），在则必须是布尔值；
  - ``input=select`` 必带 ``options``（非空字符串列表）；
  - ``visibleWhen`` 可省略（缺省恒可见），在则须是单条件显隐规则
    ``{field, op, value?}``（形状见 :data:`VISIBLE_WHEN_OPS`；``field``
    须引用同表单**另一**字段列——自引用/引用不存在列均拒）；
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

#: visibleWhen 算子枚举（单条件显隐——wire-form-field-linkage）
VISIBLE_WHEN_OPS: tuple[str, ...] = (
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "empty",
    "notEmpty",
)

#: 无值算子（条件只看控制列空值，规则里不得带 value 键）
_VALUELESS_OPS: frozenset[str] = frozenset({"empty", "notEmpty"})

#: gt/gte/lt/lte 的数值口径：双端须同匹配该正则才按数值比较（双端十进制
#: ——防 JS ``Number("0x10")`` 与 Python ``float()`` 的解析分歧，否则回退
#: 字符串字典序）
_DECIMAL_RE = re.compile(r"^-?\d+(\.\d+)?([eE][+-]?\d+)?$")


def _text_error(value: object, *, what: str) -> str | None:
    """非空字符串 ≤ :data:`TEXT_LIMIT` 校验；返回错误文案或 None。"""
    if not isinstance(value, str) or not value.strip():
        return f"{what} 必须是非空字符串"
    if len(value) > TEXT_LIMIT:
        return f"{what} 长度超过 {TEXT_LIMIT} 上限"
    return None


def _visible_when_error(rule: object, where: str) -> str | None:
    """visibleWhen 形状校验（不含引用存在性——那需全字段列齐后二趟）。

    规则（wire-form-field-linkage 冻结契约）：
    - 必须是 JSON 对象 ``{field, op, value?}``；
    - ``field``：非空字符串（引用同表单另一字段的 column）；
    - ``op`` ∈ :data:`VISIBLE_WHEN_OPS`；
    - ``empty``/``notEmpty``：不得带 ``value`` 键（在则拒）；
    - 其余算子：``value`` 必须是非空标量（str/int/float/bool——dict/list/
      null 拒；字符串形态 trim 后非空，空串/纯空白拒）。
    """
    if not isinstance(rule, dict):
        return f"{where}.visibleWhen 必须是 JSON 对象（{{field, op, value?}}）"
    target = rule.get("field")
    if not isinstance(target, str) or not target.strip():
        return f"{where}.visibleWhen.field 必须是非空字符串（同表单另一字段的 column）"
    op = rule.get("op")
    if op not in VISIBLE_WHEN_OPS:
        return (
            f"{where}.visibleWhen.op 必须是 {'/'.join(VISIBLE_WHEN_OPS)}"
            f"（收到 {op!r}）"
        )
    if op in _VALUELESS_OPS:
        if "value" in rule:
            return f"{where}.visibleWhen.{op} 不得带 value 键"
        return None
    if "value" not in rule:
        return f"{where}.visibleWhen.value 必须是非空标量（op={op} 必带）"
    raw = rule["value"]
    if raw is None or not isinstance(raw, (str, int, float)):  # bool ⊂ int 过
        return f"{where}.visibleWhen.value 必须是非空标量（收到 {raw!r}）"
    if isinstance(raw, str) and not raw.strip():
        return f"{where}.visibleWhen.value 必须是非空标量（收到 {raw!r}）"
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
        if "visibleWhen" in field:
            rule_error = _visible_when_error(field["visibleWhen"], where)
            if rule_error is not None:
                return rule_error
    # visibleWhen 引用存在性（二趟——支持前向引用，须全字段列齐后裁决）
    for index, field in enumerate(fields):
        if not isinstance(field, dict):
            continue
        rule = field.get("visibleWhen")
        if not isinstance(rule, dict):  # 非对象已在首趟拦
            continue
        where = f"fields[{index}]"
        target = rule.get("field")
        if target == field.get("column"):
            return f"{where}.visibleWhen.field 不能自引用本字段: {target}"
        if target not in seen_columns:
            return f"{where}.visibleWhen.field 引用了不存在的字段列: {target}"
    for key in ("submitLabel", "successMessage"):
        if key in inner:
            error = _text_error(inner[key], what=f"spec.spec.{key}")
            if error is not None:
                return error
    return None


# --------------------------------------------- 字段显隐求值（wire-form-field-linkage）


def _scalar_text(value: object) -> str:
    """标量的字符串形态：bool 按 JSON 口径 true/false，其余按 ``str()``。"""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _is_blank_value(value: object) -> bool:
    """空值口径：缺键/None/字符串形态 trim 后为空（数字 0、bool False 非空）。"""
    return value is None or _scalar_text(value).strip() == ""


def evaluate_hidden_columns(fields: object, values: object) -> set[str]:
    """按提交 raw ``values`` 求带 visibleWhen 字段的隐藏列集合——纯函数。

    与 web 侧逐字同规（冻结契约）：
    - 无 visibleWhen 的字段恒可见（不在返回集合中）；求值只看 values 本身，
      **不递归**判控制字段自身的可见性（控制字段值在 values 里即参与比较）；
    - ``ctrl = values.get(visibleWhen.field)``（缺键/null → 空值）；
    - ``empty``：ctrl 为空值 → 可见；``notEmpty`` 反之；
    - **带值算子在 ctrl 为空值时一律为假（含 neq）**；
    - 非空时 ``lhs = String(ctrl).trim()``、``rhs = String(value).trim()``：
      eq/neq/contains 按字符串；gt/gte/lt/lte 双端同匹配
      :data:`_DECIMAL_RE` 才按 float 数值比较，否则按字符串字典序。

    防御位：fields 非数组/values 非对象 → 空集（``validate_form_values``
    先做入参形态校验再调本函数；未知算子按可见收——保存校验已拦）。
    """
    if not isinstance(fields, list):
        return set()
    row = values if isinstance(values, dict) else {}
    comparators = {
        "gt": lambda lhs, rhs: lhs > rhs,
        "gte": lambda lhs, rhs: lhs >= rhs,
        "lt": lambda lhs, rhs: lhs < rhs,
        "lte": lambda lhs, rhs: lhs <= rhs,
    }
    hidden: set[str] = set()
    for field in fields:
        if not isinstance(field, dict):
            continue
        rule = field.get("visibleWhen")
        if not isinstance(rule, dict):
            continue
        column = field.get("column")
        if not isinstance(column, str) or not column:
            continue
        target = rule.get("field")
        ctrl = row.get(target) if isinstance(target, str) else None
        blank = _is_blank_value(ctrl)
        op = rule.get("op")
        if op == "empty":
            visible = blank
        elif op == "notEmpty":
            visible = not blank
        elif blank:
            visible = False  # 带值算子在 ctrl 为空值时一律为假（含 neq）
        else:
            lhs = _scalar_text(ctrl).strip()
            rhs_raw = rule.get("value")
            rhs = (
                _scalar_text(rhs_raw).strip()
                if isinstance(rhs_raw, (str, int, float))
                else ""
            )
            if op == "eq":
                visible = lhs == rhs
            elif op == "neq":
                visible = lhs != rhs
            elif op == "contains":
                visible = rhs in lhs
            elif op in comparators:
                if _DECIMAL_RE.match(lhs) and _DECIMAL_RE.match(rhs):
                    lhs, rhs = float(lhs), float(rhs)
                visible = comparators[op](lhs, rhs)
            else:
                visible = True  # 未知算子防御位：按可见收
        if not visible:
            hidden.add(column)
    return hidden


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
    - **显隐联动**（wire-form-field-linkage）：先用提交 raw ``values`` 经
      :func:`evaluate_hidden_columns` 求 hidden 集，再逐字段——隐藏字段是
      已定义列（不触发未定义列拒）：携带非空值（非 None、非纯空白串）即拒
      （不做静默丢弃）；值为 None/空白/未传 → 跳过不写键且 **required 不
      检查**（隐藏必填不算缺失）；
    - 可见字段照旧：必填字段缺失/空串/仅空白/null → 文案；
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
    hidden = evaluate_hidden_columns(fields, values)
    normalized: dict = {}
    for column, field in known.items():  # 声明序（首个错误即返回）
        value = values.get(column)
        if column in hidden:
            if value is None or (isinstance(value, str) and not value.strip()):
                continue  # 隐藏字段空值/未传 = 跳过不写键（required 不检查）
            return None, (
                f"字段 {_field_label(field, column)}（{column}）"
                "当前不可见，不能携带值"
            )
        if value is None or (isinstance(value, str) and not value.strip()):
            if field.get("required", False):
                return None, f"必填字段 {_field_label(field, column)}（{column}）缺失或为空"
            continue  # 非必填未传/空 = 跳过，不写键
        normalized_value, error = _normalize_field_value(column, field, value)
        if error is not None:
            return None, error
        normalized[column] = normalized_value
    return normalized, None
