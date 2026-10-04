// 控制台容器（#/console/*）：布局壳 + 按 tab 切换子页（AI 对话构建默认、
// 产物草稿、需求单/用量占位）。X-Customer-Id 开发占位值在此持有，
// 变更即重挂载子页（新身份重新拉取）。
import { useState } from "react";
import { loadCustomerId, saveCustomerId } from "../console/customer";
import {
  ConsoleLayout,
  ConsolePlaceholder,
  type ConsoleTab,
} from "../console/ConsoleLayout";
import { ChatPage } from "../console/ChatPage";
import { ArtifactsPage } from "../console/ArtifactsPage";

export function ConsoleView({
  tab = "chat",
  conversationId = null,
}: {
  tab?: ConsoleTab;
  conversationId?: number | null;
}) {
  const [customerId, setCustomerId] = useState(loadCustomerId);

  return (
    <ConsoleLayout
      tab={tab}
      customerId={customerId}
      onCustomerIdSave={(raw) => setCustomerId(saveCustomerId(raw))}
    >
      {tab === "chat" && (
        <ChatPage
          key={`chat:${customerId}:${conversationId ?? "new"}`}
          customerId={customerId}
          conversationId={conversationId}
        />
      )}
      {tab === "artifacts" && (
        <ArtifactsPage key={`artifacts:${customerId}`} customerId={customerId} />
      )}
      {tab === "demands" && (
        <ConsolePlaceholder
          titleKey="console.demandsPlaceholder.title"
          bodyKey="console.demandsPlaceholder.body"
        />
      )}
      {tab === "usage" && (
        <ConsolePlaceholder
          titleKey="console.usagePlaceholder.title"
          bodyKey="console.usagePlaceholder.body"
        />
      )}
    </ConsoleLayout>
  );
}
