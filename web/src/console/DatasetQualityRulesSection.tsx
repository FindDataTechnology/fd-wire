// 质量规则区块（wire-quality-rules）：数据集详情页内的「质量规则」区块——
// 客户对单个数据集定义质量检查规则（六种指标 × 五种比较符 × 阈值；
// value_violations 另需允许值清单），并查看求值结果（pass/fail/error 三态）。
// - 规则 CRUD：GET/POST/PATCH/DELETE /api/v1/datasets/{id}/quality-rules；
// - 立即检查：POST .../run → 用返回结果就地刷新（结果列表重拉由 run 响应承担）；
// - 结果：GET .../results?limit=20（最近在前）；规则行内徽章取该规则最新一条
//   （按 result.id 最大者——append-only，id 即次序）；
// - canEdit=false 只读：隐藏全部写操作（添加/改名/启停/删除/立即检查）；
// - 三态齐备（loading / error+重试 / empty），照 DatasetVisibilitySection 结构；
// - 请求器为 api.ts requestJson 同语义的就地轻实现（Bearer 会话头、非 2xx 抛
//   ConsoleApiError 带后端 detail）——端点为本区块专属，不动 api.ts。
// i18n：console.dataset.qualityRules.*（zh/en 键位对仗，i18nKeys.test 把关）。
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { API_BASE } from "../catalog/api";
import { ConsoleApiError, apiErrorText } from "./api";
import { loadSession } from "./auth";
import { formatServerDate, truncate } from "./util";

/** 六种检查指标（前四种按列求值；row_count/key_uniqueness 是全表口径）。 */
export const QUALITY_RULE_METRICS = [
  "row_count",
  "null_count",
  "null_rate",
  "filled_rate",
  "value_violations",
  "key_uniqueness",
] as const;
export type QualityRuleMetric = (typeof QUALITY_RULE_METRICS)[number];

/** 五种比较符（阈值闭区间语义由服务端求值；前端只拼表达式）。 */
export const QUALITY_RULE_OPS = ["<", "<=", "=", ">=", ">"] as const;
export type QualityRuleOp = (typeof QUALITY_RULE_OPS)[number];

/** 除 row_count / key_uniqueness 外的指标都必须指定列。 */
export function metricNeedsColumn(metric: QualityRuleMetric): boolean {
  return metric !== "row_count" && metric !== "key_uniqueness";
}

export type QualityRuleCheck = {
  metric: QualityRuleMetric;
  /** 除 row_count / key_uniqueness 外必填。 */
  column?: string;
  op: QualityRuleOp;
  threshold: number;
  /** 仅 value_violations 必填（2-32 个）。 */
  allowed?: string[];
};

export type QualityRule = {
  id: string;
  dataset_id: string;
  name: string | null;
  enabled: boolean;
  check: QualityRuleCheck;
  updated_by: string | null;
  updated_at: string | null;
};

export type QualityRuleResultStatus = "pass" | "fail" | "error";

export type QualityRuleResult = {
  id: number;
  rule_id: string;
  status: QualityRuleResultStatus;
  element_count: number | null;
  unexpected_count: number | null;
  pass_rate: number | null;
  observed: number | null;
  channel: "query" | "snapshot";
  basis_at: string | null;
  error_text: string | null;
  created_at: string;
};

/** 人话化检查表达式：`null_rate(age) <= 0.05`（语言中立，原始口径拼出）。 */
export function describeQualityCheck(check: QualityRuleCheck): string {
  const head = check.column ? `${check.metric}(${check.column})` : check.metric;
  const base = `${head} ${check.op} ${check.threshold}`;
  if (check.metric === "value_violations" && check.allowed?.length) {
    return `${base} ∈ {${check.allowed.join(", ")}}`;
  }
  return base;
}

/** 某规则最近一次结果（结果按 id append-only，取最大 id 即最新）。 */
export function latestResultFor(
  results: QualityRuleResult[],
  ruleId: string,
): QualityRuleResult | null {
  let best: QualityRuleResult | null = null;
  for (const result of results) {
    if (result.rule_id !== ruleId) continue;
    if (best == null || result.id > best.id) best = result;
  }
  return best;
}

/** 本区块专属端点的轻量请求器（api.ts requestJson 同语义：Bearer 会话头、
 *  非 2xx 抛 ConsoleApiError（带后端 detail 文案）、204 → null）。 */
async function qualityRequest(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<unknown> {
  const session = loadSession();
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(session?.idToken
          ? { Authorization: `Bearer ${session.idToken}` }
          : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    throw new ConsoleApiError(
      `network error fetching ${path}: ${(err as Error).message}`,
    );
  }
  if (!response.ok) {
    let detail: string | undefined;
    try {
      const data: unknown = await response.json();
      if (
        data &&
        typeof data === "object" &&
        typeof (data as { detail?: unknown }).detail === "string"
      ) {
        detail = (data as { detail: string }).detail;
      }
    } catch {
      /* 无 JSON body：保留 undefined（走兜底文案） */
    }
    throw new ConsoleApiError(
      `quality rules api ${response.status} for ${path}`,
      response.status,
      detail,
    );
  }
  if (response.status === 204) return null;
  return response.json();
}

/** 三态 → i18n 键（statusPass / statusFail / statusError）。 */
const STATUS_KEYS: Record<QualityRuleResultStatus, string> = {
  pass: "console.dataset.qualityRules.statusPass",
  fail: "console.dataset.qualityRules.statusFail",
  error: "console.dataset.qualityRules.statusError",
};

/** 三态徽章配色：pass 绿 / fail 红 / error 灰。 */
function statusBadgeClass(status: QualityRuleResultStatus): string {
  if (status === "pass") {
    return "rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 ring-1 ring-emerald-200";
  }
  if (status === "fail") {
    return "rounded-full bg-red-50 px-2 py-0.5 text-red-700 ring-1 ring-red-200";
  }
  return "rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 ring-1 ring-slate-200";
}

export function DatasetQualityRulesSection({
  datasetId,
  canEdit,
}: {
  datasetId: string;
  /** false = 只读档（如 viewer）：隐藏全部写操作，仅展示规则与结果。 */
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const [rules, setRules] = useState<QualityRule[] | null>(null);
  const [note, setNote] = useState("");
  const [results, setResults] = useState<QualityRuleResult[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false); // 增/删/启停/改名互斥
  const [running, setRunning] = useState(false); // 立即检查进行中
  const [actionError, setActionError] = useState<string | null>(null);
  // 添加表单草稿
  const [metric, setMetric] = useState<QualityRuleMetric>("row_count");
  const [column, setColumn] = useState("");
  const [op, setOp] = useState<QualityRuleOp>(">=");
  const [thresholdText, setThresholdText] = useState("");
  const [allowedText, setAllowedText] = useState("");
  // 行内改名
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      // 结果拉取失败不拖垮区块（降级为空结果——规则面仍可用）。
      const [rulesResp, resultsResp] = await Promise.all([
        qualityRequest(
          `/v1/datasets/${datasetId}/quality-rules`,
          "GET",
        ) as Promise<{ items: QualityRule[]; note: string }>,
        qualityRequest(
          `/v1/datasets/${datasetId}/quality-rules/results?limit=20`,
          "GET",
        ).catch(() => null) as Promise<{ items: QualityRuleResult[] } | null>,
      ]);
      setRules(rulesResp.items);
      setNote(rulesResp.note ?? "");
      setResults(resultsResp ? resultsResp.items : []);
    } catch {
      setLoadError(true);
    }
  }, [datasetId]);

  useEffect(() => {
    setRules(null);
    setResults(null);
    void load();
  }, [load]);

  /** 立即检查：POST run → 用返回结果就地刷新（canEdit 才有入口）。 */
  const run = async () => {
    if (running || busy) return;
    setRunning(true);
    setActionError(null);
    try {
      const ran = (await qualityRequest(
        `/v1/datasets/${datasetId}/quality-rules/run`,
        "POST",
      )) as { results: QualityRuleResult[]; ranAt: string };
      setResults(ran.results);
    } catch (err) {
      setActionError(
        apiErrorText(err, t("console.dataset.qualityRules.actionError")),
      );
    } finally {
      setRunning(false);
    }
  };

  // ── 添加表单 ──
  const threshold = Number(thresholdText);
  const needsColumn = metricNeedsColumn(metric);
  const needsAllowed = metric === "value_violations";
  const allowedValues = allowedText
    .split(/[,，]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const formValid =
    thresholdText.trim() !== "" &&
    Number.isFinite(threshold) &&
    (!needsColumn || column.trim() !== "") &&
    (!needsAllowed ||
      (allowedValues.length >= 2 && allowedValues.length <= 32));

  const addRule = async () => {
    if (!formValid || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await qualityRequest(`/v1/datasets/${datasetId}/quality-rules`, "POST", {
        check: {
          metric,
          ...(needsColumn ? { column: column.trim() } : {}),
          op,
          threshold,
          ...(needsAllowed ? { allowed: allowedValues } : {}),
        },
      });
      // 复位 + 刷新列表（新规则来自服务端，含 id/时间戳）。
      setMetric("row_count");
      setColumn("");
      setOp(">=");
      setThresholdText("");
      setAllowedText("");
      const next = (await qualityRequest(
        `/v1/datasets/${datasetId}/quality-rules`,
        "GET",
      )) as { items: QualityRule[] };
      setRules(next.items);
    } catch (err) {
      setActionError(
        apiErrorText(err, t("console.dataset.qualityRules.actionError")),
      );
    } finally {
      setBusy(false);
    }
  };

  /** 启停开关：PATCH {enabled}，响应就地替换该行。 */
  const toggleRule = async (rule: QualityRule) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const next = (await qualityRequest(
        `/v1/datasets/${datasetId}/quality-rules/${rule.id}`,
        "PATCH",
        { enabled: !rule.enabled },
      )) as QualityRule;
      setRules((current) =>
        (current ?? []).map((row) => (row.id === next.id ? next : row)),
      );
    } catch (err) {
      setActionError(
        apiErrorText(err, t("console.dataset.qualityRules.actionError")),
      );
    } finally {
      setBusy(false);
    }
  };

  /** 删除：先 window.confirm（removeConfirm 文案），确认后 DELETE。 */
  const removeRule = async (rule: QualityRule) => {
    if (busy) return;
    if (!window.confirm(t("console.dataset.qualityRules.removeConfirm"))) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await qualityRequest(
        `/v1/datasets/${datasetId}/quality-rules/${rule.id}`,
        "DELETE",
      );
      setRules((current) => (current ?? []).filter((row) => row.id !== rule.id));
    } catch (err) {
      setActionError(
        apiErrorText(err, t("console.dataset.qualityRules.actionError")),
      );
    } finally {
      setBusy(false);
    }
  };

  /** 改名：PATCH {name}（空串归 null，回落到检查表达式呈现）。 */
  const saveName = async (rule: QualityRule) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const next = (await qualityRequest(
        `/v1/datasets/${datasetId}/quality-rules/${rule.id}`,
        "PATCH",
        { name: nameDraft.trim() || null },
      )) as QualityRule;
      setRules((current) =>
        (current ?? []).map((row) => (row.id === next.id ? next : row)),
      );
      setRenamingId(null);
    } catch (err) {
      setActionError(
        apiErrorText(err, t("console.dataset.qualityRules.actionError")),
      );
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <section data-testid="quality-rules-section" className="mt-6">
        <h2 className="text-base font-semibold">
          {t("console.dataset.qualityRules.title")}
        </h2>
        <div
          data-testid="quality-rules-error"
          className="mt-2 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3"
        >
          <p className="text-xs text-red-700">
            {t("console.dataset.qualityRules.error")}
          </p>
          <button
            type="button"
            data-testid="quality-rules-retry"
            aria-label={t("console.dataset.qualityRules.error")}
            onClick={() => void load()}
            className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100"
          >
            ↻
          </button>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="quality-rules-section" className="mt-6">
      <h2 className="text-base font-semibold">
        {t("console.dataset.qualityRules.title")}
      </h2>
      <p className="mt-1 max-w-2xl text-xs text-slate-500">
        {t("console.dataset.qualityRules.subtitle")}
      </p>

      {rules == null && (
        <p
          data-testid="quality-rules-loading"
          className="mt-2 text-xs text-slate-400"
        >
          {t("console.dataset.qualityRules.loading")}
        </p>
      )}

      {rules != null && (
        <>
          {/* 操作条：立即检查（只读档隐藏）。 */}
          {canEdit && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="quality-rules-run"
                disabled={running || busy}
                onClick={() => void run()}
                className="rounded bg-slate-900 px-3 py-1 text-xs text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {running
                  ? t("console.dataset.qualityRules.running")
                  : t("console.dataset.qualityRules.runNow")}
              </button>
            </div>
          )}

          {/* 规则列表：人话化检查 + 最近结果徽章 + 启停/删除（只读档仅展示）。 */}
          {rules.length === 0 ? (
            <p
              data-testid="quality-rules-empty"
              className="mt-2 text-xs text-slate-400"
            >
              {t("console.dataset.qualityRules.empty")}
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {rules.map((rule) => {
                const latest =
                  latestResultFor(results ?? [], rule.id) ?? null;
                const checkText = describeQualityCheck(rule.check);
                return (
                  <li
                    key={rule.id}
                    data-testid={`quality-rule-item-${rule.id}`}
                    data-enabled={rule.enabled ? "true" : "false"}
                    className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {renamingId === rule.id ? (
                        <span className="flex items-center gap-1.5">
                          <input
                            data-testid="quality-rule-name-input"
                            value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveName(rule);
                            }}
                            className="w-40 rounded border border-slate-300 px-2 py-0.5 text-[11px]"
                          />
                          <button
                            type="button"
                            data-testid="quality-rule-name-save"
                            disabled={busy}
                            onClick={() => void saveName(rule)}
                            className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {t("console.dataset.qualityRules.save")}
                          </button>
                          <button
                            type="button"
                            data-testid="quality-rule-name-cancel"
                            onClick={() => setRenamingId(null)}
                            className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                          >
                            {t("console.dataset.qualityRules.cancel")}
                          </button>
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] text-slate-700">
                          {canEdit ? (
                            <button
                              type="button"
                              data-testid={`quality-rule-rename-${rule.id}`}
                              title={checkText}
                              onClick={() => {
                                setRenamingId(rule.id);
                                setNameDraft(rule.name ?? "");
                              }}
                              className="max-w-56 truncate text-left underline decoration-dotted underline-offset-2"
                            >
                              {rule.name ?? checkText}
                            </button>
                          ) : (
                            (rule.name ?? checkText)
                          )}
                        </span>
                      )}
                      <span className="font-mono text-[11px] text-slate-500">
                        {checkText}
                      </span>
                      {latest != null && (
                        <span
                          data-testid={`quality-rule-result-badge-${rule.id}`}
                          data-status={latest.status}
                          className={statusBadgeClass(latest.status)}
                        >
                          {t(STATUS_KEYS[latest.status])}
                          {latest.status === "error" && latest.error_text
                            ? `：${truncate(latest.error_text, 40)}`
                            : ""}
                        </span>
                      )}
                      {canEdit && (
                        <span className="ml-auto flex items-center gap-1.5">
                          <button
                            type="button"
                            data-testid={`quality-rule-toggle-${rule.id}`}
                            data-enabled={rule.enabled ? "true" : "false"}
                            disabled={busy}
                            onClick={() => void toggleRule(rule)}
                            className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {t(
                              rule.enabled
                                ? "console.dataset.qualityRules.enabled"
                                : "console.dataset.qualityRules.disabled",
                            )}
                          </button>
                          <button
                            type="button"
                            data-testid={`quality-rule-delete-${rule.id}`}
                            disabled={busy}
                            onClick={() => void removeRule(rule)}
                            className="rounded border border-red-200 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {t("console.dataset.qualityRules.delete")}
                          </button>
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {note.trim() !== "" && (
            <p
              data-testid="quality-rules-server-note"
              className="mt-2 max-w-2xl text-[11px] text-slate-400"
            >
              {note}
            </p>
          )}

          {/* 添加表单（只读档隐藏）：metric/column/op/threshold/allowed。 */}
          {canEdit && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1.5">
                  <span className="text-slate-500">
                    {t("console.dataset.qualityRules.metricLabel")}
                  </span>
                  <select
                    data-testid="quality-rule-metric"
                    value={metric}
                    onChange={(e) =>
                      setMetric(e.target.value as QualityRuleMetric)
                    }
                    className="rounded border border-slate-300 bg-white px-1.5 py-1"
                  >
                    {QUALITY_RULE_METRICS.map((value) => (
                      <option key={value} value={value}>
                        {t(`console.dataset.qualityRules.metric.${value}`)}
                      </option>
                    ))}
                  </select>
                </label>
                {needsColumn && (
                  <label className="flex items-center gap-1.5">
                    <span className="text-slate-500">
                      {t("console.dataset.qualityRules.column")}
                    </span>
                    <input
                      data-testid="quality-rule-column"
                      value={column}
                      onChange={(e) => setColumn(e.target.value)}
                      className="w-28 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[11px]"
                    />
                  </label>
                )}
                <label className="flex items-center gap-1.5">
                  <span className="text-slate-500">
                    {t("console.dataset.qualityRules.op")}
                  </span>
                  <select
                    data-testid="quality-rule-op"
                    value={op}
                    onChange={(e) => setOp(e.target.value as QualityRuleOp)}
                    className="rounded border border-slate-300 bg-white px-1.5 py-1 font-mono"
                  >
                    {QUALITY_RULE_OPS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5">
                  <span className="text-slate-500">
                    {t("console.dataset.qualityRules.threshold")}
                  </span>
                  <input
                    data-testid="quality-rule-threshold"
                    type="number"
                    step="any"
                    value={thresholdText}
                    onChange={(e) => setThresholdText(e.target.value)}
                    className="w-24 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[11px]"
                  />
                </label>
                {needsAllowed && (
                  <label className="flex items-center gap-1.5">
                    <span className="text-slate-500">
                      {t("console.dataset.qualityRules.allowedValues")}
                    </span>
                    <input
                      data-testid="quality-rule-allowed"
                      value={allowedText}
                      onChange={(e) => setAllowedText(e.target.value)}
                      className="w-56 rounded border border-slate-300 bg-white px-2 py-1 text-[11px]"
                    />
                  </label>
                )}
                <button
                  type="button"
                  data-testid="quality-rule-add"
                  disabled={!formValid || busy}
                  onClick={() => void addRule()}
                  className="rounded bg-slate-900 px-2.5 py-1 text-xs text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {t("console.dataset.qualityRules.add")}
                </button>
              </div>
            </div>
          )}

          {actionError && (
            <p
              data-testid="quality-rules-action-error"
              className="mt-2 text-xs text-red-600"
            >
              {actionError}
            </p>
          )}

          {/* 求值结果：状态徽章 + observed vs threshold + 计数/通过率 +
              snapshot 通道的基准时刻（basisAt）。 */}
          <h3 className="mt-4 text-sm font-semibold">
            {t("console.dataset.qualityRules.results")}
          </h3>
          {results == null ? (
            <p
              data-testid="quality-rules-results-loading"
              className="mt-1.5 text-xs text-slate-400"
            >
              {t("console.dataset.qualityRules.loading")}
            </p>
          ) : results.length === 0 ? (
            <p
              data-testid="quality-rules-results-empty"
              className="mt-1.5 text-xs text-slate-400"
            >
              {t("console.dataset.qualityRules.resultsEmpty")}
            </p>
          ) : (
            <ul
              data-testid="quality-rules-results"
              className="mt-1.5 space-y-1.5"
            >
              {results.map((result) => {
                const rule = rules.find((row) => row.id === result.rule_id);
                return (
                  <li
                    key={result.id}
                    data-testid="quality-rule-result-row"
                    data-rule-id={result.rule_id}
                    data-status={result.status}
                    data-channel={result.channel}
                    className="flex flex-wrap items-center gap-2 rounded border border-slate-100 bg-slate-50/40 px-2.5 py-1.5 text-[11px]"
                  >
                    <span
                      data-status={result.status}
                      className={statusBadgeClass(result.status)}
                    >
                      {t(STATUS_KEYS[result.status])}
                    </span>
                    <span className="font-mono text-slate-600">
                      {rule ? describeQualityCheck(rule.check) : result.rule_id}
                    </span>
                    <span className="text-slate-500">
                      {t("console.dataset.qualityRules.observed")}：
                      {result.observed ?? "—"}
                      {rule
                        ? ` / ${t("console.dataset.qualityRules.threshold")}：${rule.check.threshold}`
                        : ""}
                    </span>
                    {result.element_count != null && (
                      <span className="text-slate-500">
                        {t("console.dataset.qualityRules.elementCount")}：
                        {result.element_count.toLocaleString()}
                      </span>
                    )}
                    {result.unexpected_count != null && (
                      <span className="text-slate-500">
                        {t("console.dataset.qualityRules.unexpectedCount")}：
                        {result.unexpected_count}
                      </span>
                    )}
                    {result.pass_rate != null && (
                      <span className="text-slate-500">
                        {t("console.dataset.qualityRules.passRate")}：
                        {(result.pass_rate * 100).toFixed(1)}%
                      </span>
                    )}
                    {result.channel === "snapshot" &&
                      result.basis_at != null && (
                        <span
                          data-testid="quality-rule-result-basis"
                          className="text-slate-400"
                        >
                          {t("console.dataset.qualityRules.basisAt")}：
                          {formatServerDate(result.basis_at)}
                        </span>
                      )}
                    {result.status === "error" && result.error_text != null && (
                      <span className="text-slate-400">
                        {truncate(result.error_text, 60)}
                      </span>
                    )}
                    <span className="ml-auto text-slate-400">
                      {formatServerDate(result.created_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-2 max-w-2xl text-[11px] text-slate-400">
            {t("console.dataset.qualityRules.rulesNote")}
          </p>
        </>
      )}
    </section>
  );
}
