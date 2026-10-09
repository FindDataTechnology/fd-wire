// 紧凑页脚（#/console/* 工作台用，wire-ux-consolidation 任务 1.1）：
// 单行 版权 + ICP + 公安备——无跨服务行、无 GitHub；宽度对齐控制台宽容器。
import { useTranslation } from "react-i18next";
import {
  FOOTER_ICP_NUMBER,
  FOOTER_ICP_URL,
  FOOTER_MPS_NUMBER,
  FOOTER_MPS_URL,
} from "./footerConstants";

export function ConsoleFooter() {
  const { t } = useTranslation();

  return (
    <footer
      data-testid="console-footer"
      className="mx-auto max-w-7xl px-4 py-4 text-xs text-slate-400"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span data-testid="console-footer-org">
          © {new Date().getFullYear()} {t("footer.org")}
        </span>
        <a
          data-testid="footer-icp"
          href={FOOTER_ICP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-slate-600"
        >
          {FOOTER_ICP_NUMBER}
        </a>
        <a
          data-testid="footer-mps"
          href={FOOTER_MPS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-slate-600"
        >
          {FOOTER_MPS_NUMBER}
        </a>
      </div>
    </footer>
  );
}
