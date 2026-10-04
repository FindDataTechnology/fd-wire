// i18n 双语键位一致性：zh 与 en 的键集合必须完全一致（全键化、无缺漏）。
import { describe, expect, it } from "vitest";
import zh from "./zh";
import en from "./en";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      keyPaths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [prefix];
}

describe("i18n zh/en 键位一致", () => {
  it("两语言键集合完全一致", () => {
    const zhKeys = new Set(keyPaths(zh));
    const enKeys = new Set(keyPaths(en));
    const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));
    const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));
    expect(missingInEn).toEqual([]);
    expect(missingInZh).toEqual([]);
  });

  it("叶子值均为非空字符串", () => {
    for (const [path, value] of [...leafEntries(zh), ...leafEntries(en)]) {
      expect(
        typeof value === "string" && value.trim().length > 0,
        `${path} 应为非空字符串`,
      ).toBe(true);
    }
  });
});

function leafEntries(
  value: unknown,
  prefix = "",
): Array<[string, unknown]> {
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      leafEntries(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [[prefix, value]];
}
