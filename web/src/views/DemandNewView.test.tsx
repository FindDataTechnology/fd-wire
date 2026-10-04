import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { DemandNewView } from "./DemandNewView";

beforeEach(() => {
  i18n.changeLanguage("zh");
});

afterEach(() => {
  cleanup();
});

describe("DemandNewView（需求单提交占位）", () => {
  it("展示预填指标 code 与占位说明", () => {
    render(<DemandNewView indicator="CN_COAL" />);
    expect(screen.getByText("提交数据需求单")).toBeTruthy();
    expect(screen.getByTestId("demand-prefilled-code").textContent).toBe("CN_COAL");
    expect(screen.getByText("预填指标")).toBeTruthy();
    expect(screen.getByText("返回目录").getAttribute("href")).toBe("#/catalog");
  });

  it("无预填指标时不渲染 code 区块", () => {
    render(<DemandNewView indicator={null} />);
    expect(screen.queryByTestId("demand-prefilled-code")).toBeNull();
    expect(screen.getByText("提交数据需求单")).toBeTruthy();
  });
});
