// 内部后台容器（#/admin/*）：布局壳 + 按左侧栏切换五页（客户/账本/需求单/
// 目录治理/用量）。X-Admin-Token 开发占位值在此持有，变更即重挂载子页
// （新令牌重新请求）。
import { useState } from "react";
import {
  AdminLayout,
  parseAdminSection,
  type AdminSection,
} from "./AdminLayout";
import { loadAdminToken, saveAdminToken } from "./api";
import { CustomersPage } from "./CustomersPage";
import { LedgerPage } from "./LedgerPage";
import { DemandsPage } from "./DemandsPage";
import { CatalogGovernancePage } from "./CatalogGovernancePage";
import { UsageOverviewPage } from "./UsageOverviewPage";

export function AdminView({
  section = "customers",
}: {
  section?: AdminSection;
}) {
  const [token, setToken] = useState(loadAdminToken);
  const active: AdminSection = parseAdminSection(section);

  return (
    <AdminLayout
      section={active}
      token={token}
      onTokenSave={(raw) => setToken(saveAdminToken(raw))}
    >
      {active === "customers" && <CustomersPage key={`customers:${token}`} token={token} />}
      {active === "ledger" && <LedgerPage key={`ledger:${token}`} token={token} />}
      {active === "demands" && <DemandsPage key={`demands:${token}`} token={token} />}
      {active === "catalog" && (
        <CatalogGovernancePage key={`catalog:${token}`} token={token} />
      )}
      {active === "usage" && (
        <UsageOverviewPage key={`usage:${token}`} token={token} />
      )}
    </AdminLayout>
  );
}
