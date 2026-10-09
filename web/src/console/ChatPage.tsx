// AI 构建入口（#/console/chat，tab 显示名「AI 构建」，id 保持 chat 路由兼容；
// wire-ux-consolidation 任务 2.1）：旧对话页（会话列表/消息流/输入框）退役，
// 客户面整体替换为壹座试用引导卡——
// - 主按钮「去壹座试用」→ finddatatech.cloud/demo（公示测试账号与导览在彼处）；
// - 次级链接「已有壹座账号？直接进入」→ platform.finddatatech.cloud；
// - 卡片上不出现任何测试账号的邮箱/口令明文，也不发起任何网络请求。
import { useTranslation } from "react-i18next";
import { YIZUO_DEMO_URL, YIZUO_PLATFORM_URL } from "../components/footerConstants";

export function ChatPage() {
  const { t } = useTranslation();

  return (
    <div
      data-testid="chat-guide"
      className="mx-auto max-w-xl rounded-lg border border-slate-200 p-8"
    >
      <h1 className="text-xl font-semibold">{t("console.chatGuide.title")}</h1>
      <p className="mt-3 text-sm text-slate-600">{t("console.chatGuide.body")}</p>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <a
          data-testid="chat-guide-demo-cta"
          href={YIZUO_DEMO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white transition-colors hover:bg-slate-700"
        >
          {t("console.chatGuide.tryCta")}
        </a>
        <a
          data-testid="chat-guide-enter-link"
          href={YIZUO_PLATFORM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-500 underline hover:text-slate-900"
        >
          {t("console.chatGuide.haveAccount")}
        </a>
      </div>
    </div>
  );
}
