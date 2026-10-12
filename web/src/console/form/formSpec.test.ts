// 表单 spec 纯函数测试（wire-form-builder 任务 4.1）：
// 列类型→输入建议、列勾选→字段（顺序=数据集列序）、信封组装、宽容解析、
// 结构自检（与后端规则同源：input 枚举/column 唯一/select 需 options/
// 文案长度）、values 提交前校验（number 收数值或数字串、date YYYY-MM-DD、
// select ∈ options、text 收标量、非必填缺省不写键）。
// 显隐联动（wire-form-field-linkage）：visibleWhen parse 归一（合法保留/
// 非法整键丢弃）、validate 新错误码（conditionBad/Self/Missing）、
// evaluateFieldVisibility 求值矩阵（与 api 侧同款对拍）、validateFormValues
// 联动感知（隐藏带值拒/隐藏空值跳过/隐藏必填不查）。
// 联动 v1+（wire-form-linkage-v2）：visibleWhenGroup/optionsFrom parse 归一
// 与校验新错误码（互斥×2/组形状/cases 形状/引用存在性）、组条件求值矩阵
// （all/any/不递归）、resolveSelectOptions 解析矩阵、空选项并入隐藏集、
// select 动态成员校验——golden 用例与 api 侧新增用例同表对拍。
import { describe, expect, it } from "vitest";
import type { DatasetColumn } from "../api";
import {
  buildFormEnvelope,
  evaluateFieldVisibility,
  fieldFromColumn,
  fieldsFromColumns,
  parseFormSpec,
  resolveSelectOptions,
  suggestInputType,
  validateFormSpec,
  validateFormValues,
  type FieldVisibleWhen,
  type FormField,
} from "./formSpec";

const COLUMNS: DatasetColumn[] = [
  { name: "city", type: "TEXT" },
  { name: "amount", type: "REAL" },
  { name: "count", type: "INTEGER" },
  { name: "reported_on", type: "DATE" },
  { name: "note", type: "" },
];

describe("suggestInputType / fieldFromColumn", () => {
  it("列类型→输入建议：数值列 number、日期列 date、其余（含拿不到类型）text", () => {
    expect(suggestInputType("INTEGER")).toBe("number");
    expect(suggestInputType("REAL")).toBe("number");
    expect(suggestInputType("DOUBLE PRECISION")).toBe("number");
    expect(suggestInputType("NUMERIC")).toBe("number");
    expect(suggestInputType("DATE")).toBe("date");
    expect(suggestInputType("DATETIME")).toBe("date");
    expect(suggestInputType("TEXT")).toBe("text");
    expect(suggestInputType("VARCHAR(64)")).toBe("text");
    expect(suggestInputType("")).toBe("text");
  });

  it("列→默认字段：label=列名、input 按列类型建议、非必填", () => {
    expect(fieldFromColumn({ name: "amount", type: "REAL" })).toEqual({
      column: "amount",
      label: "amount",
      input: "number",
    });
  });
});

describe("fieldsFromColumns（勾列成字段）", () => {
  it("字段顺序=数据集列序（与勾选先后无关），未勾列不生成字段", () => {
    const fields = fieldsFromColumns(COLUMNS, [
      "reported_on",
      "city",
      "amount",
    ]);
    expect(fields.map((f) => f.column)).toEqual([
      "city",
      "amount",
      "reported_on",
    ]);
    expect(fields.map((f) => f.input)).toEqual(["text", "number", "date"]);
  });

  it("空勾选=零字段", () => {
    expect(fieldsFromColumns(COLUMNS, [])).toEqual([]);
  });
});

describe("buildFormEnvelope（信封组装）", () => {
  it("submitLabel/successMessage 仅在非空时写入（trim 后）", () => {
    expect(
      buildFormEnvelope("门店日报", {
        datasetId: "ds-1",
        fields: [{ column: "city", label: "城市", input: "text" }],
        submitLabel: "  上报  ",
        successMessage: "   ",
      }),
    ).toEqual({
      title: "门店日报",
      spec: {
        datasetId: "ds-1",
        fields: [{ column: "city", label: "城市", input: "text" }],
        submitLabel: "上报",
      },
    });
  });
});

describe("parseFormSpec（宽容解析）", () => {
  it("信封（产物详情原样）与本体（内层直给）皆可解析", () => {
    const body = { datasetId: "ds-1", fields: [{ column: "a", label: "A", input: "text", required: true }] };
    expect(parseFormSpec({ title: "t", spec: body })).toEqual(body);
    expect(parseFormSpec(body)).toEqual(body);
  });

  it("无 fields 数组→null（非表单 spec）；字段逐个归一（缺 label 回退列名、非法 input 回退 text）", () => {
    expect(parseFormSpec({ title: "t", spec: { panels: [] } })).toBeNull();
    expect(parseFormSpec(null)).toBeNull();
    const parsed = parseFormSpec({
      datasetId: 42,
      fields: [
        { column: "a", input: "bogus" },
        { label: "无列名" },
        "junk",
      ],
    });
    expect(parsed).toEqual({
      datasetId: null,
      fields: [{ column: "a", label: "a", input: "text" }],
    });
  });
});

describe("validateFormSpec（结构自检，与后端同源）", () => {
  const base = {
    datasetId: "ds-1" as string | null,
    fields: [
      { column: "city", label: "城市", input: "text" as const },
    ],
  };

  it("合法 spec 零错误；datasetId=null 的构建中间态同样零错误", () => {
    expect(validateFormSpec("门店日报", base)).toEqual([]);
    expect(
      validateFormSpec("门店日报", { ...base, datasetId: null }),
    ).toEqual([]);
  });

  it("title 空白/超长如实拒绝", () => {
    expect(validateFormSpec("   ", base)).toContain("titleRequired");
    expect(validateFormSpec("标".repeat(201), base)).toContain("titleTooLong");
  });

  it("input 越枚举、column 重复、select 无 options 逐条可断言", () => {
    expect(
      validateFormSpec("t", {
        datasetId: null,
        fields: [
          { column: "a", label: "A", input: "textarea" as never },
        ],
      }),
    ).toContain("inputInvalid");
    expect(
      validateFormSpec("t", {
        datasetId: null,
        fields: [
          { column: "a", label: "A", input: "text" },
          { column: "a", label: "A2", input: "text" },
        ],
      }),
    ).toContain("columnDuplicate");
    expect(
      validateFormSpec("t", {
        datasetId: null,
        fields: [{ column: "a", label: "A", input: "select" }],
      }),
    ).toContain("selectOptions");
    // 全空白 options 同样算缺
    expect(
      validateFormSpec("t", {
        datasetId: null,
        fields: [
          { column: "a", label: "A", input: "select", options: ["  ", ""] },
        ],
      }),
    ).toContain("selectOptions");
  });

  it("文案长度上限：label/submitLabel/successMessage", () => {
    expect(
      validateFormSpec("t", {
        datasetId: null,
        fields: [{ column: "a", label: "长".repeat(101), input: "text" }],
      }),
    ).toContain("labelTooLong");
    expect(
      validateFormSpec("t", {
        datasetId: null,
        fields: [],
        submitLabel: "长".repeat(51),
      }),
    ).toContain("submitLabelTooLong");
    expect(
      validateFormSpec("t", {
        datasetId: null,
        fields: [],
        successMessage: "长".repeat(201),
      }),
    ).toContain("successMessageTooLong");
  });
});

describe("validateFormValues（提交前校验+归一）", () => {
  const fields = [
    { column: "city", label: "城市", input: "text" as const, required: true },
    { column: "amount", label: "金额", input: "number" as const },
    { column: "reported_on", label: "日期", input: "date" as const },
    {
      column: "level",
      label: "级别",
      input: "select" as const,
      options: ["高", "低"],
    },
  ];

  it("必填缺失→required；非必填缺省不写键（不写 null/空串）", () => {
    const result = validateFormValues(fields, {});
    expect(result.errors).toEqual({ city: "required" });
    expect(result.values).toEqual({});
  });

  it("number 收数值或数字串并归一为数值；NaN/Infinity/非数字拒", () => {
    expect(
      validateFormValues(fields, { city: "沪", amount: "12.5" }).values,
    ).toEqual({ city: "沪", amount: 12.5 });
    expect(
      validateFormValues(fields, { city: "沪", amount: 7 }).values,
    ).toEqual({ city: "沪", amount: 7 });
    for (const bad of ["abc", "NaN", "Infinity", "-Infinity"]) {
      expect(
        validateFormValues(fields, { city: "x", amount: bad }).errors.amount,
      ).toBe("number");
    }
  });

  it("date 须 YYYY-MM-DD（拒绝时间部分与斜杠形态、月日越界）", () => {
    expect(
      validateFormValues(fields, { city: "x", reported_on: "2026-10-12" })
        .values.reported_on,
    ).toBe("2026-10-12");
    for (const bad of [
      "2026-10-12T00:00",
      "2026/10/12",
      "2026-13-01",
      "2026-10-32",
      "26-10-12",
    ]) {
      expect(
        validateFormValues(fields, { city: "x", reported_on: bad }).errors
          .reported_on,
      ).toBe("date");
    }
  });

  it("select 须 ∈ options；text 收标量（数字 stringify、对象拒）", () => {
    expect(
      validateFormValues(fields, { city: "x", level: "高" }).values.level,
    ).toBe("高");
    expect(
      validateFormValues(fields, { city: "x", level: "中" }).errors.level,
    ).toBe("select");
    expect(
      validateFormValues(fields, { city: "x" }).values,
    ).toEqual({ city: "x" });
    expect(
      validateFormValues(fields, { city: 42 }).values.city,
    ).toBe("42");
    expect(
      validateFormValues(fields, { city: { nested: true } }).errors.city,
    ).toBe("text");
    expect(
      validateFormValues(fields, { city: ["a"] }).errors.city,
    ).toBe("text");
  });

  it("全部通过→零错误，values 只含已知字段且空串可选字段被省略", () => {
    const result = validateFormValues(fields, {
      city: "京",
      amount: " 3.5 ",
      reported_on: "2026-01-31",
      level: "低",
      unknown_column: "忽略",
    });
    expect(result.errors).toEqual({});
    expect(result.values).toEqual({
      city: "京",
      amount: 3.5,
      reported_on: "2026-01-31",
      level: "低",
    });
  });
});

// ------------------------------------------- 显隐联动（wire-form-field-linkage）

describe("parseFormSpec（visibleWhen 归一）", () => {
  it("合法 visibleWhen 保留（value 保持原标量类型——数字仍是数字）", () => {
    const parsed = parseFormSpec({
      datasetId: "ds-1",
      fields: [
        { column: "type", label: "类型", input: "text" },
        {
          column: "detail",
          label: "明细",
          input: "text",
          visibleWhen: { field: "type", op: "gt", value: 3 },
        },
        {
          column: "note",
          label: "备注",
          input: "text",
          visibleWhen: { field: "type", op: "empty" },
        },
      ],
    });
    expect(parsed?.fields[1]?.visibleWhen).toEqual({
      field: "type",
      op: "gt",
      value: 3,
    });
    expect(parsed?.fields[2]?.visibleWhen).toEqual({
      field: "type",
      op: "empty",
    });
  });

  it("非法 visibleWhen 整键丢弃（宽容解析绝不整单失败）：field 缺/op 越枚举/带值算子缺 value/value trim 空/value 非标量/empty 带 value/非对象", () => {
    const parsed = parseFormSpec({
      datasetId: null,
      fields: [
        // field 缺失（空串同样丢）
        { column: "a", label: "A", input: "text", visibleWhen: { field: "", op: "eq", value: "x" } },
        // op 越枚举
        { column: "b", label: "B", input: "text", visibleWhen: { field: "a", op: "bogus", value: "x" } },
        // 带值算子缺 value
        { column: "c", label: "C", input: "text", visibleWhen: { field: "a", op: "eq" } },
        // value 字符串形态 trim 空
        { column: "d", label: "D", input: "text", visibleWhen: { field: "a", op: "eq", value: "  " } },
        // value 非标量（对象/数组）
        { column: "e", label: "E", input: "text", visibleWhen: { field: "a", op: "eq", value: { x: 1 } } },
        { column: "f", label: "F", input: "text", visibleWhen: { field: "a", op: "contains", value: ["x"] } },
        // empty 族带 value → 丢
        { column: "g", label: "G", input: "text", visibleWhen: { field: "a", op: "empty", value: "x" } },
        { column: "h", label: "H", input: "text", visibleWhen: { field: "a", op: "notEmpty", value: true } },
        // 非对象形状
        { column: "i", label: "I", input: "text", visibleWhen: "junk" },
      ],
    });
    expect(parsed?.fields.map((f) => f.column)).toEqual([
      "a", "b", "c", "d", "e", "f", "g", "h", "i",
    ]);
    expect(parsed?.fields.every((f) => f.visibleWhen === undefined)).toBe(true);
  });
});

describe("validateFormSpec（显隐条件新错误码）", () => {
  const condBody = (visibleWhen: unknown) => ({
    datasetId: null as string | null,
    fields: [
      { column: "type", label: "类型", input: "text" as const },
      {
        column: "detail",
        label: "明细",
        input: "text" as const,
        visibleWhen: visibleWhen as FormField["visibleWhen"],
      },
    ],
  });

  it("合法单条件零错误", () => {
    expect(
      validateFormSpec("t", condBody({ field: "type", op: "eq", value: "其他" })),
    ).toEqual([]);
    expect(
      validateFormSpec("t", condBody({ field: "type", op: "empty" })),
    ).toEqual([]);
  });

  it("conditionBad：形状/op 越枚举/value 非法逐类可断言", () => {
    expect(
      validateFormSpec("t", condBody({ field: "type", op: "bogus", value: "x" })),
    ).toContain("conditionBad");
    expect(
      validateFormSpec("t", condBody({ field: "", op: "eq", value: "x" })),
    ).toContain("conditionBad");
    expect(
      validateFormSpec("t", condBody({ field: "type", op: "eq" })),
    ).toContain("conditionBad");
    expect(
      validateFormSpec("t", condBody({ field: "type", op: "eq", value: "  " })),
    ).toContain("conditionBad");
    expect(
      validateFormSpec("t", condBody({ field: "type", op: "empty", value: "x" })),
    ).toContain("conditionBad");
  });

  it("conditionSelf：自引用（条件不能引用字段自身）", () => {
    expect(
      validateFormSpec("t", condBody({ field: "detail", op: "notEmpty" })),
    ).toContain("conditionSelf");
  });

  it("conditionMissing：引用字段不存在", () => {
    expect(
      validateFormSpec("t", condBody({ field: "nope", op: "eq", value: "x" })),
    ).toContain("conditionMissing");
  });
});

describe("evaluateFieldVisibility（求值矩阵——与 api 侧同款对拍）", () => {
  /** 单条件求值：ctrl 字段 + 带条件 target，返回 target 是否隐藏。 */
  function hiddenWith(cond: FieldVisibleWhen, ctrl: Record<string, unknown>) {
    return evaluateFieldVisibility(
      [
        { column: "ctrl", label: "控制", input: "text" },
        { column: "target", label: "目标", input: "text", visibleWhen: cond },
      ],
      ctrl,
    );
  }

  it("① eq 命中可见（ctrl=「其他」value=「其他」）；不命中隐藏", () => {
    const cond: FieldVisibleWhen = { field: "ctrl", op: "eq", value: "其他" };
    expect(hiddenWith(cond, { ctrl: "其他" }).has("target")).toBe(false);
    expect(hiddenWith(cond, { ctrl: "标准" }).has("target")).toBe(true);
  });

  it("①补 eq 纯标量比较：布尔 true → \"true\"（与字符串 \"true\" 命中）", () => {
    expect(
      hiddenWith({ field: "ctrl", op: "eq", value: "true" }, { ctrl: true }).has(
        "target",
      ),
    ).toBe(false);
  });

  it("② eq 不走数值归一：\"100\" vs \"100.0\" → 隐藏", () => {
    expect(
      hiddenWith({ field: "ctrl", op: "eq", value: "100.0" }, { ctrl: "100" }).has(
        "target",
      ),
    ).toBe(true);
  });

  it("③ gt 数值比较：\"1200\">\"1000\" 可见；\"9\" vs \"10\" 走数值序（字典序会误判）", () => {
    expect(
      hiddenWith({ field: "ctrl", op: "gt", value: "1000" }, { ctrl: "1200" }).has(
        "target",
      ),
    ).toBe(false);
    // 数值 9 < 10 → 条件假（若按字典序 \"9\">\"10\" 会误判可见）
    expect(
      hiddenWith({ field: "ctrl", op: "gt", value: "10" }, { ctrl: "9" }).has(
        "target",
      ),
    ).toBe(true);
  });

  it("③补 gte/lt/lte：数值序含等值边界", () => {
    expect(
      hiddenWith({ field: "ctrl", op: "gte", value: "10" }, { ctrl: "10" }).has(
        "target",
      ),
    ).toBe(false);
    expect(
      hiddenWith({ field: "ctrl", op: "lt", value: "10" }, { ctrl: "10" }).has(
        "target",
      ),
    ).toBe(true);
    expect(
      hiddenWith({ field: "ctrl", op: "lte", value: "10" }, { ctrl: "10" }).has(
        "target",
      ),
    ).toBe(false);
  });

  it("④ gt 双非数值串走字典序：\"abc\" vs \"abd\" → 隐藏", () => {
    expect(
      hiddenWith({ field: "ctrl", op: "gt", value: "abd" }, { ctrl: "abc" }).has(
        "target",
      ),
    ).toBe(true);
  });

  it("⑤ gt 混合（一方非数值串）：\"12\" vs \"abc\" 走字典序（\"1\"<\"a\"）→ 隐藏", () => {
    expect(
      hiddenWith({ field: "ctrl", op: "gt", value: "abc" }, { ctrl: "12" }).has(
        "target",
      ),
    ).toBe(true);
  });

  it("⑥ empty：缺键可见、\"  \" 可见、\"0\" 隐藏、数字 0 隐藏（0 不是空值）", () => {
    const cond: FieldVisibleWhen = { field: "ctrl", op: "empty" };
    expect(hiddenWith(cond, {}).has("target")).toBe(false);
    expect(hiddenWith(cond, { ctrl: "  " }).has("target")).toBe(false);
    expect(hiddenWith(cond, { ctrl: "0" }).has("target")).toBe(true);
    expect(hiddenWith(cond, { ctrl: 0 }).has("target")).toBe(true);
  });

  it("⑦ notEmpty：\"x\" 可见、缺键隐藏（null 同缺键）", () => {
    const cond: FieldVisibleWhen = { field: "ctrl", op: "notEmpty" };
    expect(hiddenWith(cond, { ctrl: "x" }).has("target")).toBe(false);
    expect(hiddenWith(cond, {}).has("target")).toBe(true);
    expect(hiddenWith(cond, { ctrl: null }).has("target")).toBe(true);
  });

  it("⑧ 空值控制字段下带值算子全假（含 neq）→ 隐藏", () => {
    expect(
      hiddenWith({ field: "ctrl", op: "neq", value: "x" }, {}).has("target"),
    ).toBe(true);
    expect(
      hiddenWith({ field: "ctrl", op: "neq", value: "x" }, { ctrl: "" }).has(
        "target",
      ),
    ).toBe(true);
    expect(
      hiddenWith({ field: "ctrl", op: "gt", value: "1" }, { ctrl: null }).has(
        "target",
      ),
    ).toBe(true);
  });

  it("⑨ contains：\"华东大区\" 含 \"华东\" → 可见；不含 → 隐藏", () => {
    expect(
      hiddenWith({ field: "ctrl", op: "contains", value: "华东" }, { ctrl: "华东大区" }).has(
        "target",
      ),
    ).toBe(false);
    expect(
      hiddenWith({ field: "ctrl", op: "contains", value: "华北" }, { ctrl: "华东大区" }).has(
        "target",
      ),
    ).toBe(true);
  });

  it("⑩ 不递归：条件引用的字段自身隐藏但其值仍在 values → 照常比较", () => {
    // B 由 A 控制（A 空 → B 隐藏）；C 由 B 控制——B 虽隐藏，值 \"y\" 仍在
    // values，C 按值比较照常命中可见。
    const fields: FormField[] = [
      { column: "a", label: "A", input: "text" },
      {
        column: "b",
        label: "B",
        input: "text",
        visibleWhen: { field: "a", op: "notEmpty" },
      },
      {
        column: "c",
        label: "C",
        input: "text",
        visibleWhen: { field: "b", op: "eq", value: "y" },
      },
    ];
    const hidden = evaluateFieldVisibility(fields, { b: "y" });
    expect(hidden.has("b")).toBe(true); // B 自身隐藏（A 空）
    expect(hidden.has("c")).toBe(false); // C 不看 B 的可见性，只看 values
    expect([...hidden]).toEqual(["b"]);
  });

  it("无 visibleWhen 字段恒可见（零条件→空隐藏集）", () => {
    const fields: FormField[] = [
      { column: "a", label: "A", input: "text" },
      { column: "b", label: "B", input: "text", required: true },
    ];
    expect(evaluateFieldVisibility(fields, {}).size).toBe(0);
    expect(evaluateFieldVisibility(fields, { a: "x" }).size).toBe(0);
  });
});

describe("validateFormValues（显隐联动感知）", () => {
  const fields: FormField[] = [
    {
      column: "type",
      label: "类型",
      input: "select",
      options: ["其他", "标准"],
      required: true,
    },
    {
      column: "detail",
      label: "明细",
      input: "text",
      required: true,
      visibleWhen: { field: "type", op: "eq", value: "其他" },
    },
  ];

  it("隐藏字段带值→\"hidden\" 错误（不进 values）", () => {
    const result = validateFormValues(fields, { type: "标准", detail: "x" });
    expect(result.errors).toEqual({ detail: "hidden" });
    expect(result.values).toEqual({ type: "标准" });
  });

  it("隐藏字段空值→跳过（不写键、无错误、不查 required）", () => {
    const result = validateFormValues(fields, { type: "标准" });
    expect(result.errors).toEqual({});
    expect(result.values).toEqual({ type: "标准" });
    expect("detail" in result.values).toBe(false);
  });

  it("可见字段既有行为逐字不变：必填缺失→required、带值归一入载荷", () => {
    expect(validateFormValues(fields, { type: "其他" }).errors).toEqual({
      detail: "required",
    });
    const ok = validateFormValues(fields, { type: "其他", detail: " 备注 " });
    expect(ok.errors).toEqual({});
    expect(ok.values).toEqual({ type: "其他", detail: "备注" });
  });
});

// ------------------------------- 条件组合与选项联动（wire-form-linkage-v2）

describe("parseFormSpec（visibleWhenGroup / optionsFrom 归一）", () => {
  it("合法 visibleWhenGroup 保留（mode/conditions 逐条归一，value 保标量类型）", () => {
    const parsed = parseFormSpec({
      datasetId: "ds-1",
      fields: [
        { column: "type", label: "类型", input: "text" },
        { column: "amount", label: "金额", input: "number" },
        {
          column: "detail",
          label: "明细",
          input: "text",
          visibleWhenGroup: {
            mode: "any",
            conditions: [
              { field: "type", op: "eq", value: "其他" },
              { field: "amount", op: "gt", value: 3 },
              { field: "amount", op: "empty" },
            ],
          },
        },
      ],
    });
    expect(parsed?.fields[2]?.visibleWhenGroup).toEqual({
      mode: "any",
      conditions: [
        { field: "type", op: "eq", value: "其他" },
        { field: "amount", op: "gt", value: 3 },
        { field: "amount", op: "empty" },
      ],
    });
  });

  it("非法 visibleWhenGroup 整键丢弃：mode 越枚举/conditions 空/超 10 条/任一条非法/非对象", () => {
    const eleven = Array.from({ length: 11 }, () => ({
      field: "a",
      op: "eq",
      value: "x",
    }));
    const parsed = parseFormSpec({
      datasetId: null,
      fields: [
        { column: "a", label: "A", input: "text" },
        {
          column: "b",
          label: "B",
          input: "text",
          visibleWhenGroup: { mode: "bogus", conditions: [{ field: "a", op: "eq", value: "x" }] },
        },
        {
          column: "c",
          label: "C",
          input: "text",
          visibleWhenGroup: { mode: "all", conditions: [] },
        },
        {
          column: "d",
          label: "D",
          input: "text",
          visibleWhenGroup: { mode: "all", conditions: eleven },
        },
        {
          column: "e",
          label: "E",
          input: "text",
          visibleWhenGroup: {
            mode: "all",
            conditions: [
              { field: "a", op: "eq", value: "x" },
              { field: "a", op: "bogus", value: "x" },
            ],
          },
        },
        { column: "f", label: "F", input: "text", visibleWhenGroup: "junk" },
        {
          column: "g",
          label: "G",
          input: "text",
          visibleWhenGroup: { mode: "all", conditions: "junk" },
        },
      ],
    });
    expect(parsed?.fields.map((f) => f.column)).toEqual([
      "a", "b", "c", "d", "e", "f", "g",
    ]);
    expect(
      parsed?.fields.every((f) => f.visibleWhenGroup === undefined),
    ).toBe(true);
  });

  it("合法 optionsFrom 保留（cases/fallback 归一）；非 select 字段携带即丢", () => {
    const parsed = parseFormSpec({
      datasetId: null,
      fields: [
        { column: "region", label: "大区", input: "text" },
        {
          column: "city",
          label: "城市",
          input: "select",
          optionsFrom: {
            field: "region",
            cases: { 华东: ["上海", "杭州"], 华南: ["广州"] },
            fallback: ["其他"],
          },
        },
        {
          column: "note",
          label: "备注",
          input: "text",
          optionsFrom: { field: "region", cases: { 华东: ["上海"] } },
        },
      ],
    });
    expect(parsed?.fields[1]?.optionsFrom).toEqual({
      field: "region",
      cases: { 华东: ["上海", "杭州"], 华南: ["广州"] },
      fallback: ["其他"],
    });
    expect(parsed?.fields[2]?.optionsFrom).toBeUndefined();
  });

  it("非法 optionsFrom 整键丢弃：field 缺/cases 非对象/键空白/列表空/列表含空白串或非串/fallback 形状", () => {
    const parsed = parseFormSpec({
      datasetId: null,
      fields: [
        { column: "region", label: "大区", input: "text" },
        // field 缺失
        { column: "a", label: "A", input: "select", optionsFrom: { cases: { x: ["1"] } } },
        // cases 非对象（数组/字符串）
        { column: "b", label: "B", input: "select", optionsFrom: { field: "region", cases: ["x"] } },
        { column: "c", label: "C", input: "select", optionsFrom: { field: "region", cases: "junk" } },
        // 键空白
        { column: "d", label: "D", input: "select", optionsFrom: { field: "region", cases: { "  ": ["1"] } } },
        // 列表空 / 含空白串 / 含非字符串
        { column: "e", label: "E", input: "select", optionsFrom: { field: "region", cases: { x: [] } } },
        { column: "f", label: "F", input: "select", optionsFrom: { field: "region", cases: { x: ["1", " "] } } },
        { column: "g", label: "G", input: "select", optionsFrom: { field: "region", cases: { x: ["1", 2] } } },
        // fallback 形状（空列表/含空白串）
        { column: "h", label: "H", input: "select", optionsFrom: { field: "region", cases: { x: ["1"] }, fallback: [] } },
        { column: "i", label: "I", input: "select", optionsFrom: { field: "region", cases: { x: ["1"] }, fallback: [" "] } },
      ],
    });
    expect(parsed?.fields.map((f) => f.column)).toEqual([
      "region", "a", "b", "c", "d", "e", "f", "g", "h", "i",
    ]);
    expect(parsed?.fields.slice(1).every((f) => f.optionsFrom === undefined)).toBe(true);
  });
});

describe("validateFormSpec（条件组合与选项联动新错误码）", () => {
  const groupBody = (detail: Record<string, unknown>) => ({
    datasetId: null as string | null,
    fields: [
      { column: "type", label: "类型", input: "text" as const },
      { column: "amount", label: "金额", input: "number" as const },
      { column: "detail", label: "明细", input: "text" as const, ...detail },
    ],
  });

  it("合法组零错误（all/any、1..10 条、含 empty 族、前向引用支持）", () => {
    expect(
      validateFormSpec("t", groupBody({
        visibleWhenGroup: {
          mode: "all",
          conditions: [
            { field: "type", op: "eq", value: "其他" },
            { field: "amount", op: "empty" },
          ],
        },
      })),
    ).toEqual([]);
    // 前向引用：条件引用其后定义的字段同样合法（全列齐后二趟裁决）
    expect(
      validateFormSpec("t", {
        datasetId: null,
        fields: [
          {
            column: "a",
            label: "A",
            input: "text" as const,
            visibleWhenGroup: {
              mode: "any",
              conditions: [{ field: "later", op: "notEmpty" }],
            },
          },
          { column: "later", label: "L", input: "text" as const },
        ],
      }),
    ).toEqual([]);
  });

  it("conditionGroupBad：mode 越枚举/conditions 空/超 10 条/组内单条件非法逐类可断言", () => {
    expect(
      validateFormSpec("t", groupBody({
        visibleWhenGroup: { mode: "bogus" as never, conditions: [{ field: "type", op: "eq", value: "x" }] },
      })),
    ).toContain("conditionGroupBad");
    expect(
      validateFormSpec("t", groupBody({
        visibleWhenGroup: { mode: "all", conditions: [] },
      })),
    ).toContain("conditionGroupBad");
    expect(
      validateFormSpec("t", groupBody({
        visibleWhenGroup: {
          mode: "all",
          conditions: Array.from({ length: 11 }, () => ({
            field: "type",
            op: "notEmpty",
          })),
        },
      })),
    ).toContain("conditionGroupBad");
    expect(
      validateFormSpec("t", groupBody({
        visibleWhenGroup: {
          mode: "all",
          conditions: [
            { field: "type", op: "eq", value: "x" },
            { field: "amount", op: "eq" },
          ],
        },
      })),
    ).toContain("conditionGroupBad");
  });

  it("conditionExclusive：visibleWhen 与 visibleWhenGroup 并存拒", () => {
    expect(
      validateFormSpec("t", groupBody({
        visibleWhen: { field: "type", op: "notEmpty" },
        visibleWhenGroup: {
          mode: "any",
          conditions: [{ field: "type", op: "notEmpty" }],
        },
      })),
    ).toContain("conditionExclusive");
  });

  it("组内自引用→conditionSelf；引用不存在→conditionMissing（沿用单条件错误码）", () => {
    expect(
      validateFormSpec("t", groupBody({
        visibleWhenGroup: {
          mode: "all",
          conditions: [
            { field: "type", op: "notEmpty" },
            { field: "detail", op: "notEmpty" },
          ],
        },
      })),
    ).toContain("conditionSelf");
    expect(
      validateFormSpec("t", groupBody({
        visibleWhenGroup: {
          mode: "any",
          conditions: [{ field: "nope", op: "notEmpty" }],
        },
      })),
    ).toContain("conditionMissing");
  });

  const selectBody = (city: Record<string, unknown>) => ({
    datasetId: null as string | null,
    fields: [
      { column: "region", label: "大区", input: "text" as const },
      { column: "city", label: "城市", input: "select" as const, ...city },
    ],
  });

  it("select 带 optionsFrom（无静态 options）零错误；两者并存→optionsExclusive；都无→selectOptions", () => {
    expect(
      validateFormSpec("t", selectBody({
        optionsFrom: { field: "region", cases: { 华东: ["上海"] } },
      })),
    ).toEqual([]);
    expect(
      validateFormSpec("t", selectBody({
        options: ["上海"],
        optionsFrom: { field: "region", cases: { 华东: ["上海"] } },
      })),
    ).toContain("optionsExclusive");
    // 互斥的边界：空 options 占位同样算携带（恰有其一——编辑器负责切源清键）
    expect(
      validateFormSpec("t", selectBody({
        options: [],
        optionsFrom: { field: "region", cases: { 华东: ["上海"] } },
      })),
    ).toContain("optionsExclusive");
    expect(
      validateFormSpec("t", selectBody({})),
    ).toContain("selectOptions");
  });

  it("optionsFromBad：field 缺/cases 键空白/空列表/空白串选项/fallback 形状逐类可断言", () => {
    expect(
      validateFormSpec("t", selectBody({
        optionsFrom: { cases: { x: ["1"] } } as never,
      })),
    ).toContain("optionsFromBad");
    expect(
      validateFormSpec("t", selectBody({
        optionsFrom: { field: "region", cases: { "  ": ["1"] } },
      })),
    ).toContain("optionsFromBad");
    expect(
      validateFormSpec("t", selectBody({
        optionsFrom: { field: "region", cases: { x: [] } },
      })),
    ).toContain("optionsFromBad");
    expect(
      validateFormSpec("t", selectBody({
        optionsFrom: { field: "region", cases: { x: ["1", " "] } },
      })),
    ).toContain("optionsFromBad");
    expect(
      validateFormSpec("t", selectBody({
        optionsFrom: { field: "region", cases: { x: ["1"] }, fallback: [] },
      })),
    ).toContain("optionsFromBad");
  });

  it("optionsFromSelf：控制字段自引用；optionsFromMissing：引用不存在", () => {
    expect(
      validateFormSpec("t", selectBody({
        optionsFrom: { field: "city", cases: { x: ["1"] } },
      })),
    ).toContain("optionsFromSelf");
    expect(
      validateFormSpec("t", selectBody({
        optionsFrom: { field: "nope", cases: { x: ["1"] } },
      })),
    ).toContain("optionsFromMissing");
  });
});

describe("evaluateFieldVisibility（条件组合与动态选项求值——与 api 侧同款对拍）", () => {
  function hiddenGroupWith(
    mode: "all" | "any",
    conditions: FieldVisibleWhen[],
    values: Record<string, unknown>,
  ): boolean {
    return evaluateFieldVisibility(
      [
        { column: "kind", label: "K", input: "text" },
        { column: "amount", label: "M", input: "number" },
        {
          column: "target",
          label: "T",
          input: "text",
          visibleWhenGroup: { mode, conditions },
        },
      ],
      values,
    ).has("target");
  }

  it("① all：全部条件真才可见；任一假即隐藏", () => {
    const conditions: FieldVisibleWhen[] = [
      { field: "kind", op: "eq", value: "VIP" },
      { field: "amount", op: "notEmpty" },
    ];
    expect(hiddenGroupWith("all", conditions, { kind: "VIP", amount: "1" })).toBe(false);
    // amount 空 → notEmpty 假 → 隐藏
    expect(hiddenGroupWith("all", conditions, { kind: "VIP" })).toBe(true);
    // kind 不命中 → eq 假 → 隐藏
    expect(hiddenGroupWith("all", conditions, { kind: "普通", amount: "1" })).toBe(true);
  });

  it("② any：至少一真即可见；全假隐藏（空值控制字段下带值算子全假）", () => {
    const conditions: FieldVisibleWhen[] = [
      { field: "kind", op: "eq", value: "VIP" },
      { field: "amount", op: "gt", value: "100" },
    ];
    expect(hiddenGroupWith("any", conditions, { kind: "VIP" })).toBe(false);
    expect(hiddenGroupWith("any", conditions, { amount: "1200" })).toBe(false);
    expect(hiddenGroupWith("any", conditions, { kind: "普通", amount: "9" })).toBe(true);
    expect(hiddenGroupWith("any", conditions, {})).toBe(true);
  });

  it("③ 组内不递归：控制字段自身隐藏但其值在 raw values 即参与比较", () => {
    // b（被 a 控制，a 空 → b 隐藏）；c 组条件引用 b——b 虽隐藏，值 "y" 仍
    // 在 values，c 按值比较照常命中可见。
    const fields: FormField[] = [
      { column: "a", label: "A", input: "text" },
      {
        column: "b",
        label: "B",
        input: "text",
        visibleWhen: { field: "a", op: "notEmpty" },
      },
      {
        column: "c",
        label: "C",
        input: "text",
        visibleWhenGroup: {
          mode: "all",
          conditions: [{ field: "b", op: "eq", value: "y" }],
        },
      },
    ];
    const hidden = evaluateFieldVisibility(fields, { b: "y" });
    expect(hidden.has("b")).toBe(true);
    expect(hidden.has("c")).toBe(false);
  });

  it("④ 组条件与单条件字段同表单共存、互不干扰；无联动字段恒可见", () => {
    const fields: FormField[] = [
      { column: "kind", label: "K", input: "text" },
      {
        column: "single",
        label: "S",
        input: "text",
        visibleWhen: { field: "kind", op: "eq", value: "VIP" },
      },
      {
        column: "grouped",
        label: "G",
        input: "text",
        visibleWhenGroup: {
          mode: "any",
          conditions: [{ field: "kind", op: "notEmpty" }],
        },
      },
    ];
    const hidden = evaluateFieldVisibility(fields, { kind: "普通" });
    expect([...hidden]).toEqual(["single"]);
  });

  it("⑤ optionsFrom 解析后选项为空 → 并入隐藏集（与条件隐藏取并集）", () => {
    const fields: FormField[] = [
      { column: "region", label: "大区", input: "text" },
      {
        column: "cond_hidden",
        label: "C",
        input: "text",
        visibleWhen: { field: "region", op: "eq", value: "X" },
      },
      {
        column: "city",
        label: "城市",
        input: "select",
        // 无 fallback：控制值空/未命中 → 解析 [] → 隐藏
        optionsFrom: { field: "region", cases: { 华东: ["上海"] } },
      },
    ];
    expect(evaluateFieldVisibility(fields, {})).toEqual(
      new Set(["cond_hidden", "city"]),
    );
    expect(evaluateFieldVisibility(fields, { region: "华东" })).toEqual(
      new Set(["cond_hidden"]),
    );
    expect(evaluateFieldVisibility(fields, { region: "X" })).toEqual(
      new Set(["city"]),
    );
  });
});

describe("resolveSelectOptions（动态选项解析——与 api 侧同款对拍）", () => {
  const field: FormField = {
    column: "city",
    label: "城市",
    input: "select",
    optionsFrom: {
      field: "region",
      cases: { 华东: ["上海", "杭州"], 华南: ["广州"] },
      fallback: ["其他"],
    },
  };

  it("① 命中 cases 取其列表（trim 字符串形态命中：带空白仍命中）", () => {
    expect(resolveSelectOptions(field, { region: "华东" })).toEqual([
      "上海",
      "杭州",
    ]);
    expect(resolveSelectOptions(field, { region: " 华东 " })).toEqual([
      "上海",
      "杭州",
    ]);
  });

  it("② 未命中/控制值空 → fallback；无 fallback → []", () => {
    expect(resolveSelectOptions(field, { region: "华北" })).toEqual(["其他"]);
    expect(resolveSelectOptions(field, {})).toEqual(["其他"]);
    expect(resolveSelectOptions(field, { region: "  " })).toEqual(["其他"]);
    expect(resolveSelectOptions(field, { region: null })).toEqual(["其他"]);
    const noFallback: FormField = {
      ...field,
      optionsFrom: { field: "region", cases: { 华东: ["上海"] } },
    };
    expect(resolveSelectOptions(noFallback, { region: "华北" })).toEqual([]);
    expect(resolveSelectOptions(noFallback, {})).toEqual([]);
  });

  it("③ 无 optionsFrom → 静态 options 原样（raw values 不影响）", () => {
    const staticField: FormField = {
      column: "level",
      label: "级别",
      input: "select",
      options: ["高", "低"],
    };
    expect(resolveSelectOptions(staticField, { anything: "x" })).toEqual([
      "高",
      "低",
    ]);
  });
});

describe("validateFormValues（动态选项联动感知）", () => {
  const fields: FormField[] = [
    { column: "region", label: "大区", input: "text" },
    {
      column: "city",
      label: "城市",
      input: "select",
      required: true,
      optionsFrom: { field: "region", cases: { 华东: ["上海", "杭州"] } },
    },
  ];

  it("select 值须 ∈ 当前解析后选项：命中收、伪造值拒（客户端先拦口径）", () => {
    expect(
      validateFormValues(fields, { region: "华东", city: "上海" }).values,
    ).toEqual({ region: "华东", city: "上海" });
    expect(
      validateFormValues(fields, { region: "华东", city: "广州" }).errors.city,
    ).toBe("select");
  });

  it("空选项字段按隐藏同规：带值拒 hidden、空值跳过不写键、required 不查", () => {
    // 控制值未命中且无 fallback → 解析 [] → 并入隐藏集
    const rejected = validateFormValues(fields, { region: "华北", city: "上海" });
    expect(rejected.errors).toEqual({ city: "hidden" });
    expect(rejected.values).toEqual({ region: "华北" });
    const skipped = validateFormValues(fields, { region: "华北" });
    expect(skipped.errors).toEqual({});
    expect(skipped.values).toEqual({ region: "华北" });
    expect("city" in skipped.values).toBe(false);
  });
});
