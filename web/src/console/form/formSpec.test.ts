// 表单 spec 纯函数测试（wire-form-builder 任务 4.1）：
// 列类型→输入建议、列勾选→字段（顺序=数据集列序）、信封组装、宽容解析、
// 结构自检（与后端规则同源：input 枚举/column 唯一/select 需 options/
// 文案长度）、values 提交前校验（number 收数值或数字串、date YYYY-MM-DD、
// select ∈ options、text 收标量、非必填缺省不写键）。
import { describe, expect, it } from "vitest";
import type { DatasetColumn } from "../api";
import {
  buildFormEnvelope,
  fieldFromColumn,
  fieldsFromColumns,
  parseFormSpec,
  suggestInputType,
  validateFormSpec,
  validateFormValues,
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
