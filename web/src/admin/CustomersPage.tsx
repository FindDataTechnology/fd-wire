// 客户管理页（#/admin/customers）：列表 + 新建（名称 + 三档档位下拉 +
// 计量身份映射键）+ 改档位/状态。开户仅本地档位关联——sub2api 代建账户
// 留给后续任务（页面如实标注）。
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AdminErrorBox,
  AdminStates,
} from "./AdminLayout";
import {
  createCustomer,
  fetchCustomers,
  fetchPlans,
  patchCustomer,
  type AdminCustomer,
  type AdminPlan,
} from "./api";

const STATUS_OPTIONS = ["active", "suspended", "closed"] as const;

export function CustomersPage() {
  const { t } = useTranslation();
  const [customers, setCustomers] = useState<AdminCustomer[] | null>(null);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [error, setError] = useState<{ status?: number; message: string; detail?: string } | null>(null);
  const [name, setName] = useState("");
  const [planCode, setPlanCode] = useState("starter");
  const [callerId, setCallerId] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setCustomers(null);
    try {
      const [items, planItems] = await Promise.all([
        fetchCustomers(),
        fetchPlans(),
      ]);
      setCustomers(items);
      setPlans(planItems);
    } catch (err) {
      setError(err as { status?: number; message: string });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setNotice(null);
    try {
      await createCustomer({
        name: name.trim(),
        plan_code: planCode,
        ...(callerId.trim() ? { sub2api_user_id: callerId.trim() } : {}),
      });
      setName("");
      setCallerId("");
      await load();
      setNotice(t("admin.customers.createdNotice"));
    } catch (err) {
      setError(err as { status?: number; message: string });
    } finally {
      setCreating(false);
    }
  };

  const changePlan = async (customer: AdminCustomer, nextPlan: string) => {
    setNotice(null);
    try {
      await patchCustomer(customer.id, { plan_code: nextPlan });
      await load();
    } catch (err) {
      setError(err as { status?: number; message: string });
    }
  };

  const changeStatus = async (customer: AdminCustomer, nextStatus: string) => {
    setNotice(null);
    try {
      await patchCustomer(customer.id, { status: nextStatus });
      await load();
    } catch (err) {
      setError(err as { status?: number; message: string });
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("admin.customers.title")}</h1>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            {t("admin.customers.subtitle")}
          </p>
        </div>
        <span
          data-testid="admin-customers-sub2api-note"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700"
        >
          {t("admin.customers.sub2apiNote")}
        </span>
      </div>

      <div
        data-testid="admin-customer-create"
        className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="new-customer-name" className="block text-xs text-slate-500">
              {t("admin.customers.nameLabel")}
            </label>
            <input
              id="new-customer-name"
              data-testid="new-customer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-48 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              placeholder={t("admin.customers.namePlaceholder")}
            />
          </div>
          <div>
            <label htmlFor="new-customer-plan" className="block text-xs text-slate-500">
              {t("admin.customers.planLabel")}
            </label>
            <select
              id="new-customer-plan"
              data-testid="new-customer-plan"
              value={planCode}
              onChange={(e) => setPlanCode(e.target.value)}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              {plans.map((plan) => (
                <option key={plan.code} value={plan.code}>
                  {plan.name}（{plan.monthly_price_yuan}）
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="new-customer-caller" className="block text-xs text-slate-500">
              {t("admin.customers.callerLabel")}
            </label>
            <input
              id="new-customer-caller"
              data-testid="new-customer-caller"
              value={callerId}
              onChange={(e) => setCallerId(e.target.value)}
              className="mt-1 w-44 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs"
              placeholder={t("admin.customers.callerPlaceholder")}
            />
          </div>
          <button
            type="button"
            data-testid="new-customer-submit"
            disabled={creating || !name.trim()}
            onClick={() => void submitCreate()}
            className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {creating ? t("admin.common.working") : t("admin.customers.create")}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          {t("admin.customers.callerHint")}
        </p>
      </div>

      {notice && (
        <p data-testid="admin-customers-notice" className="mt-3 text-xs text-emerald-600">
          {notice}
        </p>
      )}
      {error && <AdminErrorBox error={error} onRetry={() => void load()} />}

      <AdminStates
        loading={customers == null && !error}
        empty={(customers?.length ?? 0) === 0 && !error}
        emptyTestId="admin-customers-empty"
      >
        {customers != null && customers.length > 0 && (
          <table
            data-testid="admin-customer-table"
            className="mt-4 w-full border-collapse text-sm"
          >
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
              <th className="py-2 pr-4">{t("admin.customers.colName")}</th>
              <th className="py-2 pr-4">{t("admin.customers.colCaller")}</th>
              <th className="py-2 pr-4">{t("admin.customers.colPlan")}</th>
              <th className="py-2 pr-4">{t("admin.customers.colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {customers!.map((customer) => (
              <tr
                key={customer.id}
                data-testid="admin-customer-row"
                className="border-b border-slate-100"
              >
                <td className="py-2 pr-4 font-medium text-slate-800">
                  {customer.name}
                </td>
                <td className="py-2 pr-4 font-mono text-xs text-slate-500">
                  {customer.sub2api_user_id ?? "—"}
                </td>
                <td className="py-2 pr-4">
                  <select
                    data-testid="admin-customer-plan-select"
                    value={customer.plan_code}
                    onChange={(e) => void changePlan(customer, e.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  >
                    {plans.map((plan) => (
                      <option key={plan.code} value={plan.code}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-4">
                  <select
                    data-testid="admin-customer-status-select"
                    value={customer.status}
                    onChange={(e) => void changeStatus(customer, e.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {t(`admin.customers.status.${status}`)}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        )}
      </AdminStates>
    </div>
  );
}
