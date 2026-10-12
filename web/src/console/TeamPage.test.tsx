// 「团队」页测试（wire-team-spaces 任务 5）：
// - 导航接线：ConsoleLayout team tab（keys 之后）+ parseHash + ConsoleView
//   挂载（GET /api/console/team 自动拉取）；
// - owner 视角：成员名单（sub 截短 + 角色徽标 + 加入时间；owner 行徽标
//   「所有者」不可撤、成员行有移除按钮）+ 邀请区 + 待用邀请列表
//   （码/角色/过期倒计时 + 作废按钮）；
// - 生成邀请：席位二选一 → POST body {role}（wire 形状冻结）→ **一次性码
//   醒目整段展示（仅此一次显示提示 + 复制按钮）**；
// - 撤销成员 / 作废邀请：DELETE 路径 + 名单/列表重载；
// - editor/viewer 视角：团队管理面 owner-only（spec），成员进页即 403 →
//   amber 无权块（组件内只读渲染分支留作防御路径）；
// - 403 无权：amber 提示块而非崩溃；普通失败条 + 重试恢复；
// - api client 翻译层：wire snake_case（logto_sub/created_at/expires_at…）↔
//   TS camelCase（logtoSub/createdAt/expiresAt…）双向收口 + 信封形状
//   （GET {me,members,invites}、POST 201 裸邀请项、DELETE {deleted:true}）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../i18n";
import i18n from "../i18n";
import { TeamPage, inviteRemaining, shortSub } from "./TeamPage";
import { ConsoleLayout } from "./ConsoleLayout";
import { ConsoleView } from "../views/ConsoleView";
import { parseHash } from "../App";
import {
  installConsoleBackend,
  makeIdToken,
  seedConsoleSession,
  type FakeResponse,
  type FakeTeamInviteSeed,
  type FakeTeamMemberSeed,
} from "./testing";
import {
  ConsoleApiError,
  createTeamInvite,
  getTeam,
  removeTeamMember,
  revokeTeamInvite,
} from "./api";

const OWNER_SUB = "demo-customer";
const EDITOR_SUB = "editor-sub-12345678";
const VIEWER_SUB = "viewer-sub-999";

/** owner 三人名单种子（bearer=owner sub）。 */
function seedOwnerTeam(): FakeTeamMemberSeed[] {
  return [
    {
      logtoSub: OWNER_SUB,
      role: "owner",
      createdAt: "2026-09-01T08:00:00",
    },
    {
      logtoSub: EDITOR_SUB,
      role: "editor",
      createdAt: "2026-10-02T10:30:00",
      invitedBySub: OWNER_SUB,
    },
    {
      logtoSub: VIEWER_SUB,
      role: "viewer",
      createdAt: "2026-10-05T16:00:00",
      invitedBySub: OWNER_SUB,
    },
  ];
}

/** 待用邀请种子（90 分钟后过期——倒计时远离分钟边界）。 */
function seedInvites(): FakeTeamInviteSeed[] {
  return [
    {
      id: 5,
      code: "wsi-seed5",
      role: "viewer",
      expiresAt: new Date(Date.now() + 90 * 60_000).toISOString(),
      createdAt: "2026-10-12T08:00:00",
    },
  ];
}

beforeEach(() => {
  i18n.changeLanguage("zh");
  localStorage.clear();
  sessionStorage.clear();
  seedConsoleSession();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe("TeamPage 导航接线（ConsoleLayout tab + hash 路由 + 挂载）", () => {
  it("左侧栏含「团队」tab（顺序：数据面 Key 之后），href 指向 #/console/team", () => {
    render(
      <ConsoleLayout
        tab="team"
        customerName="演示客户"
        planCode="basic"
        identity="demo@test"
        onLogout={() => {}}
      >
        <TeamPage />
      </ConsoleLayout>,
    );
    const nav = screen.getByTestId("console-nav");
    const ids = [...nav.querySelectorAll("a")].map((a) =>
      a.getAttribute("data-testid"),
    );
    expect(ids.indexOf("console-nav-keys")).toBeLessThan(
      ids.indexOf("console-nav-team"),
    );
    expect(screen.getByTestId("console-nav-team").getAttribute("href")).toBe(
      "#/console/team",
    );
    expect(screen.getByTestId("console-nav-team").textContent).toContain(
      "团队",
    );
  });

  it("parseHash：#/console/team 解析为 team tab", () => {
    expect(parseHash("#/console/team")).toEqual({
      name: "console",
      tab: "team",
    });
  });

  it("ConsoleView：team tab 挂载团队页（GET /api/console/team 自动拉取）", async () => {
    const backend = installConsoleBackend([], {
      teamMembers: seedOwnerTeam(),
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<ConsoleView tab="team" />);
    expect(await screen.findByTestId("team-page")).toBeTruthy();
    expect(
      backend.calls.some(
        (c) =>
          c.url.pathname === "/api/console/team" &&
          c.method === "GET" &&
          c.headers["authorization"]?.startsWith("Bearer "),
      ),
    ).toBe(true);
  });
});

describe("TeamPage owner 视角（名单 + 邀请区 + 待用邀请）", () => {
  it("成员名单：sub 截短 + 角色徽标 + 加入时间；owner 行徽标「所有者」不可撤", async () => {
    const backend = installConsoleBackend([], {
      teamMembers: seedOwnerTeam(),
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<TeamPage />);

    const rows = await screen.findAllByTestId("team-member-row");
    expect(rows).toHaveLength(3);
    // sub 截短显示（title 悬浮给全文）。
    const ownerSub = screen
      .getAllByTestId("team-member-sub")
      .find((el) => el.getAttribute("title") === OWNER_SUB)!;
    expect(ownerSub.textContent).toBe(shortSub(OWNER_SUB));
    expect(
      screen
        .getAllByTestId("team-member-sub")
        .find((el) => el.getAttribute("title") === EDITOR_SUB)!
        .textContent,
    ).toBe("editor-s…");
    // 角色徽标：owner 行「所有者」（indigo 徽标），其余 editor/viewer。
    const badges = screen.getAllByTestId("team-member-role-badge");
    expect(
      badges.find((el) => el.getAttribute("data-role") === "owner")!
        .textContent,
    ).toContain("所有者");
    expect(badges.map((el) => el.getAttribute("data-role")).sort()).toEqual(
      ["editor", "owner", "viewer"],
    );
    // 加入时间呈现（YYYY-MM-DD HH:mm）。
    expect(
      screen
        .getAllByTestId("team-member-joined")
        .find((el) => el.textContent.includes("2026-10-02 10:30"))!,
    ).toBeTruthy();
    // owner 行不可撤：无 data-sub=owner 的移除按钮；成员行各有一个。
    expect(
      screen
        .getAllByTestId("team-member-remove")
        .map((el) => el.getAttribute("data-sub"))
        .sort(),
    ).toEqual([EDITOR_SUB, VIEWER_SUB].sort());
    // 页顶自己的席位徽标。
    expect(screen.getByTestId("team-my-role-badge").getAttribute("data-role")).toBe(
      "owner",
    );
  });

  it("待用邀请列表：码/角色徽标/过期倒计时 + 作废按钮；空态如实", async () => {
    const backend = installConsoleBackend([], {
      teamMembers: seedOwnerTeam(),
      teamInvites: seedInvites(),
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<TeamPage />);

    const row = await screen.findByTestId("team-invite-row");
    expect(row.getAttribute("data-invite-id")).toBe("5");
    expect(screen.getByTestId("team-invite-row-code").textContent).toBe(
      "wsi-seed5",
    );
    expect(
      screen.getByTestId("team-invite-role-badge").getAttribute("data-role"),
    ).toBe("viewer");
    // 倒计时（90 分钟 → 1 小时档位；未过期）。
    const remaining = screen.getByTestId("team-invite-remaining");
    expect(remaining.getAttribute("data-expired")).toBe("false");
    expect(remaining.textContent).toContain("剩");
    expect(remaining.textContent).toContain("小时");
    expect(
      screen.getByTestId("team-invite-revoke").getAttribute("data-invite-id"),
    ).toBe("5");
  });

  it("过期邀请如实呈现「已过期」", async () => {
    const backend = installConsoleBackend([], {
      teamMembers: seedOwnerTeam(),
      teamInvites: [
        {
          id: 9,
          code: "wsi-old9",
          role: "editor",
          expiresAt: "2026-10-01T00:00:00",
          createdAt: "2026-09-30T00:00:00",
        },
      ],
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<TeamPage />);

    const remaining = await screen.findByTestId("team-invite-remaining");
    expect(remaining.getAttribute("data-expired")).toBe("true");
    expect(remaining.textContent).toContain("已过期");
  });
});

describe("TeamPage 生成邀请（一次性码整段展示）", () => {
  it("席位二选一 → 生成：POST body {role} 冻结形状 → 码醒目整段展示 + 仅此一次提示 + 复制按钮", async () => {
    const backend = installConsoleBackend([], {
      teamMembers: seedOwnerTeam(),
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<TeamPage />);
    await screen.findAllByTestId("team-member-row");
    expect(screen.getByTestId("team-invites-empty").textContent).toContain(
      "暂无待用邀请",
    );

    // 席位二选一（editor/viewer）。
    const roleSelect = screen.getByTestId(
      "team-invite-role-select",
    ) as HTMLSelectElement;
    expect(
      [...roleSelect.querySelectorAll("option")].map((o) => o.value),
    ).toEqual(["editor", "viewer"]);
    fireEvent.change(roleSelect, { target: { value: "viewer" } });
    fireEvent.click(screen.getByTestId("team-invite-create"));

    // 请求体冻结契约：wire 即 {role}（snake/camel 无歧义字段，形状锁死）。
    const call = await waitFor(() => {
      const found = backend.calls.find(
        (c) =>
          c.url.pathname === "/api/console/team/invites" &&
          c.method === "POST",
      );
      expect(found).toBeTruthy();
      return found!;
    });
    expect(call.body).toEqual({ role: "viewer" });
    expect(call.headers["authorization"]).toMatch(/^Bearer /);

    // 一次性码：醒目整段展示（wsi- 前缀）+ 仅此一次提示 + 复制按钮。
    const once = await screen.findByTestId("team-invite-once");
    expect(screen.getByTestId("team-invite-code").textContent).toMatch(
      /^wsi-/,
    );
    expect(once.textContent).toContain("仅此一次显示");
    expect(screen.getByTestId("team-invite-once-hint").textContent).toContain(
      "无法再查看",
    );
    expect(screen.getByTestId("team-invite-copy").textContent).toContain(
      "复制",
    );
    // 待用邀请列表同步入列（重载）。
    expect(await screen.findByTestId("team-invite-row")).toBeTruthy();
    expect(backend.getTeamInvites()).toHaveLength(1);
  });
});

describe("TeamPage 撤销成员 / 作废邀请", () => {
  it("移除成员：DELETE /members/{sub}（路径段编码）→ 行消失", async () => {
    const backend = installConsoleBackend([], {
      teamMembers: seedOwnerTeam(),
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<TeamPage />);
    await screen.findAllByTestId("team-member-row");

    fireEvent.click(
      screen
        .getAllByTestId("team-member-remove")
        .find((el) => el.getAttribute("data-sub") === EDITOR_SUB)!,
    );
    await waitFor(() => {
      expect(
        backend.calls.some(
          (c) =>
            c.url.pathname ===
              `/api/console/team/members/${encodeURIComponent(EDITOR_SUB)}` &&
            c.method === "DELETE",
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getAllByTestId("team-member-row")).toHaveLength(2);
    });
  });

  it("作废邀请：DELETE /invites/{id} → 列表回空态", async () => {
    const backend = installConsoleBackend([], {
      teamMembers: seedOwnerTeam(),
      teamInvites: seedInvites(),
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<TeamPage />);
    await screen.findByTestId("team-invite-row");

    fireEvent.click(screen.getByTestId("team-invite-revoke"));
    await waitFor(() => {
      expect(
        backend.calls.some(
          (c) =>
            c.url.pathname === "/api/console/team/invites/5" &&
            c.method === "DELETE",
        ),
      ).toBe(true);
    });
    expect(await screen.findByTestId("team-invites-empty")).toBeTruthy();
    expect(backend.getTeamInvites()).toHaveLength(0);
  });
});

describe("TeamPage editor/viewer 视角（团队管理 owner-only）", () => {
  // spec「团队管理与审计」：四端点（含成员名单）MUST owner-only——成员进
  // 团队页只能拿到 403，渲染 amber 无权块，不崩溃、无操作面。
  it("viewer：403 amber 无权块（真后端文案），非崩溃非失败条", async () => {
    const backend = installConsoleBackend([], {
      teamMembers: [
        ...seedOwnerTeam(),
        // bearer（demo-customer）坐 viewer 席位 → GET /team 403。
        { logtoSub: OWNER_SUB, role: "viewer", createdAt: "2026-10-06T09:00:00" },
      ],
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<TeamPage />);

    const forbidden = await screen.findByTestId("team-forbidden");
    expect(forbidden.textContent).toContain("无权查看团队信息");
    expect(forbidden.textContent).toContain("团队成员权限不足（团队管理仅 owner）");
    expect(screen.queryByTestId("team-error")).toBeNull();
    expect(screen.queryByTestId("team-member-remove")).toBeNull();
    expect(screen.queryByTestId("team-invite-section")).toBeNull();
  });

  it("editor：同样 403 amber 无权块", async () => {
    const backend = installConsoleBackend([], {
      teamMembers: [
        ...seedOwnerTeam(),
        { logtoSub: OWNER_SUB, role: "editor", createdAt: "2026-10-06T09:00:00" },
      ],
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<TeamPage />);

    const forbidden = await screen.findByTestId("team-forbidden");
    expect(forbidden.textContent).toContain("团队成员权限不足（团队管理仅 owner）");
  });
});

describe("TeamPage 错误处理（403 无权 / 普通失败 + 重试）", () => {
  it("403：amber 无权提示块（非崩溃、非红色失败条），detail 如实附注", async () => {
    const backend = installConsoleBackend([], {
      failTeamStatus: 403,
      failTeamDetail: "团队成员权限不足（团队管理仅 owner）",
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<TeamPage />);

    const forbidden = await screen.findByTestId("team-forbidden");
    expect(forbidden.textContent).toContain("无权查看团队信息");
    expect(forbidden.textContent).toContain("团队成员权限不足");
    // 不是红色失败条，也不是崩溃。
    expect(screen.queryByTestId("team-error")).toBeNull();
    expect(screen.getByTestId("team-page")).toBeTruthy();
  });

  it("普通失败：红色失败条 + 重试恢复", async () => {
    const backend = installConsoleBackend([], {
      failTeamStatus: 503,
    });
    vi.stubGlobal("fetch", backend.fetchImpl);
    render(<TeamPage />);

    const error = await screen.findByTestId("team-error");
    expect(error.textContent).toContain("团队信息加载失败");
    // 重试：换健康后端恢复。
    vi.stubGlobal(
      "fetch",
      installConsoleBackend([], { teamMembers: seedOwnerTeam() }).fetchImpl,
    );
    fireEvent.click(screen.getByTestId("team-retry"));
    expect(await screen.findAllByTestId("team-member-row")).toHaveLength(3);
  });
});

describe("TeamPage 纯函数（sub 截短 / 邀请倒计时）", () => {
  it("shortSub：超 10 位截前 8 位 + …，短值原样", () => {
    expect(shortSub("abc")).toBe("abc");
    expect(shortSub("abcdefghij")).toBe("abcdefghij");
    expect(shortSub("abcdefghijk")).toBe("abcdefgh…");
  });

  it("inviteRemaining：毫秒差 → 时/分（ceil）；过期/坏值 → null", () => {
    const now = Date.parse("2026-10-12T09:00:00Z");
    expect(inviteRemaining("2026-10-12T10:30:00Z", now)).toEqual({
      hours: 1,
      minutes: 30,
    });
    expect(inviteRemaining("2026-10-12T09:00:01Z", now)).toEqual({
      hours: 0,
      minutes: 1,
    });
    expect(inviteRemaining("2026-10-12T08:59:59Z", now)).toBeNull();
    expect(inviteRemaining("not-a-date", now)).toBeNull();
  });
});

describe("api client 翻译层（wire snake_case ↔ TS camelCase + 信封形状）", () => {
  it("getTeam：解 {me,members,invites} 信封，字段翻译 snake→camel", async () => {
    const backend = installConsoleBackend([], {
      teamMembers: seedOwnerTeam(),
      teamInvites: seedInvites(),
    });
    vi.stubGlobal("fetch", backend.fetchImpl);

    const team = await getTeam();
    expect(team.me).toEqual({ sub: OWNER_SUB, role: "owner" });
    expect(team.members).toHaveLength(3);
    expect(team.members[1]).toEqual({
      logtoSub: EDITOR_SUB,
      role: "editor",
      createdAt: "2026-10-02T10:30:00",
      invitedBySub: OWNER_SUB,
    });
    // owner 首建行为 null（wire 缺省 invited_by_sub）。
    expect(team.members[0]!.invitedBySub).toBeNull();
    expect(team.invites[0]).toMatchObject({
      id: 5,
      code: "wsi-seed5",
      role: "viewer",
      expiresAt: expect.any(String),
      createdAt: "2026-10-12T08:00:00",
    });
    const call = backend.calls.find(
      (c) => c.url.pathname === "/api/console/team",
    )!;
    expect(call.method).toBe("GET");
    expect(call.headers["authorization"]).toMatch(/^Bearer /);
  });

  it("createTeamInvite：POST body 冻结为 wire 形状 {role}；响应翻译 camelCase", async () => {
    const backend = installConsoleBackend([], {});
    vi.stubGlobal("fetch", backend.fetchImpl);

    const created = await createTeamInvite("editor");
    const call = backend.calls.find(
      (c) =>
        c.url.pathname === "/api/console/team/invites" && c.method === "POST",
    )!;
    expect(call.body).toEqual({ role: "editor" });
    expect(call.headers["authorization"]).toMatch(/^Bearer /);
    expect(created.code).toMatch(/^wsi-/);
    expect(created.role).toBe("editor");
    expect(typeof created.id).toBe("number");
    expect(typeof created.expiresAt).toBe("string");
  });

  it("revokeTeamInvite / removeTeamMember：DELETE 路径（sub 段编码）+ {deleted:true}", async () => {
    const backend = installConsoleBackend([], {
      teamMembers: [
        ...seedOwnerTeam(),
        // 带 URL 保留字符的 sub（| 须百分号编码进路径段）。
        { logtoSub: "logto|sub-1", role: "viewer", createdAt: "2026-10-08T09:00:00" },
      ],
      teamInvites: [{ id: 7, role: "editor" }],
    });
    vi.stubGlobal("fetch", backend.fetchImpl);

    await expect(revokeTeamInvite(7)).resolves.toEqual({ deleted: true });
    expect(
      backend.calls.some(
        (c) =>
          c.url.pathname === "/api/console/team/invites/7" &&
          c.method === "DELETE",
      ),
    ).toBe(true);

    const removed = await removeTeamMember("logto|sub-1");
    expect(removed).toEqual({ deleted: true });
    expect(
      backend.calls.some(
        (c) =>
          c.url.pathname === "/api/console/team/members/logto%7Csub-1" &&
          c.method === "DELETE",
      ),
    ).toBe(true);
  });

  it("removeTeamMember：owner 行 409 → ConsoleApiError 带 status + detail", async () => {
    const backend = installConsoleBackend([], { teamMembers: seedOwnerTeam() });
    vi.stubGlobal("fetch", backend.fetchImpl);

    const err = await removeTeamMember(OWNER_SUB).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConsoleApiError);
    expect((err as ConsoleApiError).status).toBe(409);
    expect((err as ConsoleApiError).detail).toContain("所有者");
  });
});

describe("假后端信封对齐（逐端点锁死生产形状）", () => {
  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${makeIdToken()}`,
    Accept: "application/json",
  });
  const bodyOf = (res: FakeResponse) => res.json();

  it("GET /api/console/team → {me,members,invites}；三段均 snake_case", async () => {
    const backend = installConsoleBackend([], {
      teamMembers: seedOwnerTeam(),
      teamInvites: seedInvites(),
    });
    const res = await backend.fetchImpl("/api/console/team", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await bodyOf(res)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["invites", "me", "members"]);
    expect(Object.keys(body["me"] as object).sort()).toEqual(["role", "sub"]);
    const member = (body["members"] as Array<Record<string, unknown>>).find(
      (m) => m["logto_sub"] === EDITOR_SUB,
    )!;
    expect(Object.keys(member).sort()).toEqual(
      ["created_at", "invited_by_sub", "logto_sub", "role"].sort(),
    );
    const invite = (body["invites"] as Array<Record<string, unknown>>)[0]!;
    expect(Object.keys(invite).sort()).toEqual(
      ["code", "created_at", "expires_at", "id", "role"].sort(),
    );
  });

  it("POST /api/console/team/invites → 201 裸邀请项（{id,code,role,expires_at}）", async () => {
    const backend = installConsoleBackend([], {});
    const res = await backend.fetchImpl("/api/console/team/invites", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ role: "viewer" }),
    });
    expect(res.status).toBe(201);
    const created = (await bodyOf(res)) as Record<string, unknown>;
    expect(Object.keys(created).sort()).toEqual(
      ["code", "expires_at", "id", "role"].sort(),
    );
    expect(String(created["code"])).toMatch(/^wsi-/);
    expect(created["role"]).toBe("viewer");
  });

  it("owner-only 门禁：viewer POST/DELETE 一律 403 detail「团队成员权限不足」", async () => {
    const backend = installConsoleBackend([], {
      teamMembers: [{ logtoSub: "demo-customer", role: "viewer" }],
    });
    const post = await backend.fetchImpl("/api/console/team/invites", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ role: "editor" }),
    });
    expect(post.status).toBe(403);
    expect(JSON.stringify(await bodyOf(post))).toContain("团队成员权限不足");

    const delInvite = await backend.fetchImpl(
      "/api/console/team/invites/1",
      { method: "DELETE", headers: authHeaders() },
    );
    expect(delInvite.status).toBe(403);

    const delMember = await backend.fetchImpl(
      "/api/console/team/members/someone",
      { method: "DELETE", headers: authHeaders() },
    );
    expect(delMember.status).toBe(403);
    // 门禁下零半写：邀请/成员状态不变。
    expect(backend.getTeamInvites()).toHaveLength(0);
  });

  it("DELETE 两端点 → {deleted:true}；owner 撤 owner 行 409；失存 404", async () => {
    const backend = installConsoleBackend([], {
      teamMembers: seedOwnerTeam(),
      teamInvites: seedInvites(),
    });
    const delInvite = await backend.fetchImpl(
      "/api/console/team/invites/5",
      { method: "DELETE", headers: authHeaders() },
    );
    expect(delInvite.status).toBe(200);
    expect(await bodyOf(delInvite)).toEqual({ deleted: true });

    const ownerConflict = await backend.fetchImpl(
      `/api/console/team/members/${encodeURIComponent(OWNER_SUB)}`,
      { method: "DELETE", headers: authHeaders() },
    );
    expect(ownerConflict.status).toBe(409);
    expect(JSON.stringify(await bodyOf(ownerConflict))).toContain("owner");

    const missing = await backend.fetchImpl(
      "/api/console/team/members/ghost-sub",
      { method: "DELETE", headers: authHeaders() },
    );
    expect(missing.status).toBe(404);

    const removed = await backend.fetchImpl(
      `/api/console/team/members/${encodeURIComponent(EDITOR_SUB)}`,
      { method: "DELETE", headers: authHeaders() },
    );
    expect(removed.status).toBe(200);
    expect(await bodyOf(removed)).toEqual({ deleted: true });
  });
});
