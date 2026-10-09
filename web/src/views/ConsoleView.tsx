// 控制台容器（#/console/*）：登录引导/阻塞态 + 会话建立 + 布局壳 + 按 tab
// 切换子页（AI 对话构建默认、产物、我的数据、需求单占位、用量）。
// 身份流（wire-self-serve-launch 任务 4.4）：
//   拉登录配置 →（未配置=阻塞态，绝不假登录）→ 无会话=登录引导 →
//   会话过期先静默续期 → POST /api/console/session 建立映射/触发首登开户 →
//   key_once 明文展示一次（关闭后不可再查）→ 进入控制台。
// X-Customer-Id 开发占位已退场；子页请求一律自动附 Authorization: Bearer。
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ConsoleLayout,
  ConsolePlaceholder,
  type ConsoleTab,
} from "../console/ConsoleLayout";
import {
  beginLogin,
  clearSession,
  establishSession,
  fetchAuthConfig,
  isExpired,
  loadSession,
  logoutLocal,
  refreshSession,
  type ConsoleAuthConfig,
  type ConsoleAuthError,
  type ConsoleSession,
} from "../console/auth";
import { ChatPage } from "../console/ChatPage";
import { ArtifactsPage } from "../console/ArtifactsPage";
import { DatasetsPage } from "../console/DatasetsPage";
import { UsagePage } from "../console/UsagePage";
import { CONTACT_MAILTO } from "../views/HomeView";

type BootstrapPhase =
  | { kind: "loading" }
  | { kind: "blocked" }
  | { kind: "configError" }
  | { kind: "anonymous"; signInError?: string }
  | { kind: "sessionError"; reason?: string }
  | { kind: "ready"; session: ConsoleSession; keyOnce: string | null };

/** 静默续期提前量：距过期不足 5 分钟即尝试 refresh（有 refreshToken 才可能）。 */
const RENEW_AHEAD_MS = 5 * 60_000;

export function ConsoleView({
  tab = "chat",
  conversationId = null,
}: {
  tab?: ConsoleTab;
  conversationId?: number | null;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<BootstrapPhase>({ kind: "loading" });
  // 会话建立只跑一轮；retry 由显式事件触发（bootstrapToken 重新计数）。
  const [bootstrapToken, setBootstrapToken] = useState(0);
  const configRef = useRef<ConsoleAuthConfig | null>(null);

  const bootstrap = useCallback(async () => {
    setPhase({ kind: "loading" });
    let config: ConsoleAuthConfig;
    try {
      config = await fetchAuthConfig();
    } catch {
      setPhase({ kind: "configError" });
      return;
    }
    configRef.current = config;
    // 配置未下发：阻塞态提示，不发起任何认证跳转或受保护请求。
    if (!config.configured) {
      setPhase({ kind: "blocked" });
      return;
    }
    let session = loadSession();
    if (!session) {
      setPhase({ kind: "anonymous" });
      return;
    }
    // 过期/临期先静默续期；续期失败回落登录引导。
    if (isExpired(session, RENEW_AHEAD_MS)) {
      const renewed = await refreshSession(config, session);
      if (!renewed) {
        clearSession();
        setPhase({ kind: "anonymous" });
        return;
      }
      session = renewed;
    }
    try {
      const establishment = await establishSession(session.idToken);
      const next: ConsoleSession = {
        ...session,
        customer: establishment.customer,
      };
      setPhase({ kind: "ready", session: next, keyOnce: establishment.keyOnce });
    } catch (err) {
      const authErr = err as ConsoleAuthError;
      if (authErr?.status === 401) {
        // 令牌被服务端拒绝：清会话回登录引导（不静默重放坏令牌）。
        clearSession();
        setPhase({ kind: "anonymous" });
        return;
      }
      setPhase({ kind: "sessionError", reason: authErr?.detail });
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap, bootstrapToken]);

  // 静默续期兜底：控制台挂载期间周期检查临期（有 refreshToken 才会实际发请求）。
  useEffect(() => {
    const handle = window.setInterval(() => {
      const session = loadSession();
      const config = configRef.current;
      if (!session || !config || !session.refreshToken) return;
      if (!isExpired(session, RENEW_AHEAD_MS)) return;
      void refreshSession(config, session);
    }, 60_000);
    return () => window.clearInterval(handle);
  }, []);

  const signIn = async () => {
    const config = configRef.current;
    if (!config?.configured) return;
    try {
      await beginLogin(config, window.location.hash.replace(/^#/, "") || "/console");
    } catch (err) {
      setPhase({ kind: "anonymous", signInError: (err as Error).message });
    }
  };

  if (phase.kind === "loading") {
    return (
      <p className="text-xs text-slate-400" data-testid="console-boot-loading">
        {t("console.auth.loading")}
      </p>
    );
  }

  if (phase.kind === "blocked") {
    return (
      <div
        data-testid="console-blocked"
        className="max-w-xl rounded-lg border border-amber-200 bg-amber-50/50 p-8"
      >
        <h1 className="text-xl font-semibold">{t("console.auth.blockedTitle")}</h1>
        <p className="mt-3 text-sm text-slate-600">
          {t("console.auth.blockedBody")}
        </p>
      </div>
    );
  }

  if (phase.kind === "configError") {
    return (
      <div
        data-testid="console-config-error"
        className="max-w-xl rounded-lg border border-red-200 bg-red-50 p-8"
      >
        <h1 className="text-xl font-semibold">
          {t("console.auth.configErrorTitle")}
        </h1>
        <button
          type="button"
          data-testid="console-config-retry"
          onClick={() => setBootstrapToken((n) => n + 1)}
          className="mt-4 rounded border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-100"
        >
          {t("console.auth.retry")}
        </button>
      </div>
    );
  }

  if (phase.kind === "anonymous") {
    return (
      <div
        data-testid="console-signin"
        className="max-w-xl rounded-lg border border-slate-200 p-8"
      >
        <h1 className="text-xl font-semibold">{t("console.auth.anonymousTitle")}</h1>
        <p className="mt-3 text-sm text-slate-600">
          {t("console.auth.anonymousBody")}
        </p>
        {phase.signInError && (
          <p
            data-testid="console-signin-error"
            className="mt-3 break-all font-mono text-[11px] text-red-500"
          >
            {phase.signInError}
          </p>
        )}
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            data-testid="console-signin-button"
            onClick={() => void signIn()}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
          >
            {t("console.auth.signIn")}
          </button>
          <a
            href="#/login"
            className="text-xs text-slate-500 underline hover:text-slate-900"
          >
            {t("console.auth.loginPageLink")}
          </a>
        </div>
      </div>
    );
  }

  if (phase.kind === "sessionError") {
    return (
      <div
        data-testid="console-session-error"
        className="max-w-xl rounded-lg border border-red-200 bg-red-50 p-8"
      >
        <h1 className="text-xl font-semibold">
          {t("console.auth.sessionErrorTitle")}
        </h1>
        {phase.reason && (
          <p
            data-testid="console-session-error-detail"
            className="mt-3 break-all text-sm text-red-600"
          >
            {phase.reason}
          </p>
        )}
        <p className="mt-2 text-xs text-slate-500">{t("console.auth.upgradeHint")}</p>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            data-testid="console-session-retry"
            onClick={() => setBootstrapToken((n) => n + 1)}
            className="rounded border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-100"
          >
            {t("console.auth.retry")}
          </button>
          <a
            href={CONTACT_MAILTO}
            className="text-xs text-slate-500 underline hover:text-slate-900"
          >
            {t("console.usage.upgradeCta")}
          </a>
        </div>
      </div>
    );
  }

  // ready：布局壳 + 子页。key_once 明文仅此一次展示。
  const session = phase.session;
  const customer = session.customer;
  const keyOnce = phase.keyOnce;
  const logout = () => {
    logoutLocal();
    window.location.hash = "#/";
  };

  return (
    <ConsoleLayout
      tab={tab}
      customerName={customer?.name ?? session.identity}
      planCode={customer?.plan_code ?? ""}
      identity={session.identity}
      onLogout={logout}
    >
      {keyOnce != null && (
        <div
          data-testid="console-key-once"
          className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4"
        >
          <h2 className="text-sm font-semibold text-emerald-800">
            {t("console.keyOnce.title")}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-white px-2 py-1 font-mono text-xs text-slate-800">
              {keyOnce}
            </code>
            <button
              type="button"
              data-testid="console-key-copy"
              onClick={() => {
                if (keyOnce != null) void navigator.clipboard?.writeText(keyOnce);
              }}
              className="rounded border border-emerald-300 bg-white px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100"
            >
              {t("console.keyOnce.copy")}
            </button>
          </div>
          <p className="mt-2 text-xs text-emerald-700">
            {t("console.keyOnce.hint")}
          </p>
        </div>
      )}
      {tab === "chat" && (
        <ChatPage key={`chat:${conversationId ?? "new"}`} conversationId={conversationId} />
      )}
      {tab === "artifacts" && <ArtifactsPage />}
      {tab === "datasets" && (
        <DatasetsPage planCode={customer?.plan_code ?? ""} />
      )}
      {tab === "demands" && (
        <ConsolePlaceholder
          titleKey="console.demandsPlaceholder.title"
          bodyKey="console.demandsPlaceholder.body"
        />
      )}
      {tab === "usage" && <UsagePage />}
    </ConsoleLayout>
  );
}
