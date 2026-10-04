import { describe, expect, it } from "vitest";
import {
  API_BASE,
  buildIndicatorDetailUrl,
  buildIndicatorsUrl,
  demandNewHref,
  displayName,
  displayDescription,
  fetchIndicators,
  fetchIndicator,
  CatalogApiError,
} from "./api";
import { failingBackend } from "./testing";

describe("buildIndicatorsUrl", () => {
  it("默认基址为同源 /api，空查询无参数", () => {
    expect(API_BASE).toBe("/api");
    expect(buildIndicatorsUrl()).toBe("/api/v1/catalog/indicators");
  });

  it("空值参数不下发，取值参数按序拼接", () => {
    expect(
      buildIndicatorsUrl({ q: "  cpi ", domain: "", status: "", page: 0 }),
    ).toBe("/api/v1/catalog/indicators?q=cpi");
    expect(
      buildIndicatorsUrl({ q: "cpi", domain: "macro", status: "registered", page: 2, page_size: 20 }),
    ).toBe("/api/v1/catalog/indicators?q=cpi&domain=macro&status=registered&page=2&page_size=20");
  });
});

describe("buildIndicatorDetailUrl", () => {
  it("id 做 encodeURIComponent", () => {
    expect(buildIndicatorDetailUrl("ind-001")).toBe("/api/v1/catalog/indicators/ind-001");
    expect(buildIndicatorDetailUrl("a b/c")).toBe("/api/v1/catalog/indicators/a%20b%2Fc");
  });
});

describe("displayName / displayDescription", () => {
  it("中文优先，英文兜底，code 兜底", () => {
    expect(displayName({ name_zh: "物价", name_en: "CPI", code: "CN_CPI" })).toBe("物价");
    expect(displayName({ name_zh: "  ", name_en: "CPI", code: "CN_CPI" })).toBe("CPI");
    expect(displayName({ name_zh: null, name_en: null, code: "CN_CPI" })).toBe("CN_CPI");
  });

  it("描述中文优先英文兜底，全空为 null", () => {
    expect(displayDescription({ description_zh: "desc", description_en: "e" })).toBe("desc");
    expect(displayDescription({ description_zh: null, description_en: "e" })).toBe("e");
    expect(displayDescription({ description_zh: null, description_en: null })).toBeNull();
  });
});

describe("demandNewHref", () => {
  it("导流到需求单占位路由并预填 code", () => {
    expect(demandNewHref("CN_COAL")).toBe("#/console/demands/new?indicator=CN_COAL");
    expect(demandNewHref("A B")).toBe("#/console/demands/new?indicator=A%20B");
  });
});

describe("fetch error mapping", () => {
  it("非 2xx → CatalogApiError 带 status", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = failingBackend(503);
    try {
      await expect(fetchIndicators()).rejects.toMatchObject({
        name: "CatalogApiError",
        status: 503,
      });
      await expect(fetchIndicator("nope")).rejects.toBeInstanceOf(CatalogApiError);
    } finally {
      globalThis.fetch = original;
    }
  });
});
