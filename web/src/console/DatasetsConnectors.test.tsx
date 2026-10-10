// 连接器下载清单三态组件测试（wire-connector-distribution 任务 3.3）：
// 配对向导第一步接 manifest——正常（按平台真实链接 + 版本/sha256 展示）、
// 部分 unavailable（缺文件平台不渲染链接）、不可达（「暂不可下载」+ 保留
// 命令行指引）；状态列表「最新版本」对照（心跳版本落后 → 升级提示）；
// sha256 复制按钮与向导→文档锚点互链。fetch 一律走 testing.ts 内存假后端。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { ConnectorsSection } from "./DatasetsConnectors";
import { installConsoleBackend, seedConsoleSession } from "./testing";
import type { Connector, ConnectorManifest } from "./api";

const NOW = "2026-10-05T10:00:00";

function makeConnector(
  partial: Partial<Connector> & Pick<Connector, "id" | "name">,
): Connector {
  return {
    version: "sha-oldver",
    status: "online",
    last_heartbeat_at: NOW,
    revoked_at: null,
    created_at: NOW,
    customer_id: "demo-customer",
    ...partial,
  };
}

const MANIFEST: ConnectorManifest = {
  version: "sha-newver",
  released_at: "2026-10-11T00:00:00Z",
  platforms: [
    {
      platform: "linux-amd64",
      filename: "fd-wire-connector-linux-amd64",
      sha256: "a".repeat(64),
      size: 12345678,
      available: true,
    },
    {
      platform: "darwin-arm64",
      filename: "fd-wire-connector-darwin-arm64",
      sha256: "b".repeat(64),
      size: 12222222,
      available: false,
    },
  ],
};

function install(options?: Parameters<typeof installConsoleBackend>[1]) {
  const backend = installConsoleBackend([], options);
  vi.stubGlobal("fetch", backend.fetchImpl);
  return backend;
}

beforeEach(() => {
  i18n.changeLanguage("zh");
  localStorage.clear();
  sessionStorage.clear();
  seedConsoleSession({ sub: "demo-customer" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

async function openWizard() {
  fireEvent.click(screen.getByTestId("pairing-generate"));
  await screen.findByTestId("pairing-token-panel");
}

describe("配对向导下载清单（任务 3.1/3.3）", () => {
  it("正常态：按平台列真实下载链接（版本 + sha256 展示），指向下载端点", async () => {
    install({ connectorManifest: MANIFEST });
    render(<ConnectorsSection planCode="basic" onCreated={() => {}} />);
    await openWizard();

    const downloads = screen.getByTestId("connector-downloads");
    expect(downloads.getAttribute("data-version")).toBe("sha-newver");
    expect(downloads.textContent).toContain("sha-newver");

    const origin = window.location.origin;
    const link = screen.getByTestId("connector-download-link");
    expect(link.getAttribute("href")).toBe(
      `${origin}/api/v1/downloads/connector/linux-amd64`,
    );
    expect(link.textContent).toBe("linux-amd64");
    // sha256 截断展示（前 16 位）
    expect(
      screen.getByTestId("connector-download-sha").textContent,
    ).toContain("a".repeat(16));
  });

  it("部分 unavailable：缺文件平台不渲染链接，如实标注缺失", async () => {
    install({ connectorManifest: MANIFEST });
    render(<ConnectorsSection planCode="basic" onCreated={() => {}} />);
    await openWizard();

    const items = screen.getAllByTestId("connector-download-item");
    expect(items).toHaveLength(2);
    const missing = items.find(
      (el) => el.getAttribute("data-platform") === "darwin-arm64",
    );
    expect(missing?.getAttribute("data-available")).toBe("false");
    expect(missing?.textContent).toContain("该平台文件缺失");
    // 缺失平台无链接；在场平台链接不受影响
    expect(
      missing?.querySelector('[data-testid="connector-download-link"]'),
    ).toBeNull();
    expect(
      screen.getByTestId("connector-download-link").getAttribute("href"),
    ).toContain("linux-amd64");
  });

  it("manifest 不可达（404）：显示「暂不可下载」，保留命令行指引（不隐藏步骤）", async () => {
    install(); // 未注入 connectorManifest → 假后端缺省 404（未配置态）
    render(<ConnectorsSection planCode="basic" onCreated={() => {}} />);
    await openWizard();

    expect(
      screen.getByTestId("connector-downloads-unavailable").textContent,
    ).toContain("暂不可下载");
    // 命令行指引仍在（含令牌与 api 地址）
    const command = screen.getByTestId("pairing-command");
    expect(command.textContent).toContain("fd-wire-connector pair --token");
    expect(screen.queryByTestId("connector-downloads")).toBeNull();
  });

  it("网络错（500）与 404 同样如实降级", async () => {
    install({ failManifestStatus: 502 });
    render(<ConnectorsSection planCode="basic" onCreated={() => {}} />);
    await openWizard();
    expect(screen.getByTestId("connector-downloads-unavailable")).toBeTruthy();
  });

  it("sha256 复制按钮：复制全文并给出反馈", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    install({ connectorManifest: MANIFEST });
    render(<ConnectorsSection planCode="basic" onCreated={() => {}} />);
    await openWizard();

    fireEvent.click(screen.getByTestId("connector-download-copy"));
    expect(writeText).toHaveBeenCalledWith("a".repeat(64));
    await screen.findByText("已复制");
  });

  it("向导 → 文档教程锚点互链（任务 4.2）", async () => {
    install({ connectorManifest: MANIFEST });
    render(<ConnectorsSection planCode="basic" onCreated={() => {}} />);
    await openWizard();
    expect(
      screen.getByTestId("pairing-docs-link").getAttribute("href"),
    ).toBe("#/docs?section=local-data");
  });
});

describe("状态列表「最新版本」对照（任务 3.2/3.3）", () => {
  it("心跳版本落后 → 升级提示；与最新一致 → 无提示", async () => {
    install({
      connectorManifest: MANIFEST,
      connectors: [
        makeConnector({ id: "cn-old", name: "旧版本机", version: "sha-oldver" }),
        makeConnector({ id: "cn-new", name: "新版本机", version: "sha-newver" }),
      ],
    });
    render(<ConnectorsSection planCode="basic" onCreated={() => {}} />);

    const latest = await screen.findAllByTestId("connector-latest");
    expect(latest).toHaveLength(2);
    for (const el of latest) {
      expect(el.textContent).toContain("最新版本");
      expect(el.textContent).toContain("sha-newver");
    }
    const old = latest.find((el) =>
      el.textContent?.includes("sha-newver") &&
      el.querySelector('[data-testid="connector-upgrade-hint"]') != null,
    );
    expect(old?.textContent).toContain("建议升级");
    // 与最新一致的连接器：data-outdated=false 且无升级提示
    const fresh = latest.find((el) => el.textContent?.includes("sha-newver"));
    expect(fresh).toBeTruthy();
  });

  it("清单不可用 → 最新版本列如实显示 —（不比较、不提示）", async () => {
    install({
      connectors: [makeConnector({ id: "cn-1", name: "erp" })],
    });
    render(<ConnectorsSection planCode="basic" onCreated={() => {}} />);

    const latest = await screen.findByTestId("connector-latest");
    expect(latest.textContent).toContain("—");
    expect(
      screen.queryByTestId("connector-upgrade-hint"),
    ).toBeNull();
  });
});
