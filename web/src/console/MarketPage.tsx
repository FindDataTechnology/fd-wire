/**
 * 数据市场（wire-dataset-marketplace 任务 6.2）：登录客户检索其他客户
 * 开放的数据集，订阅（open 模式）或申请（approval 模式）后只读使用。
 *
 * 红线纪律：
 * - 列表由服务端在 **SQL 层**只查 visibility='market'——私有数据永不出现在
 *   本页（前端不做也不该做"过滤"兜底，服务端保证）；
 * - 详情响应只含元数据 + 列 schema + 行数，**无任何数据值**——本页只渲染
 *   服务端给的白名单字段，不请求样本行。
 *
 * 订阅语义：open → 订阅即得；approval → 服务端把订阅动作转成访问申请
 * （`subscribed:false` + `access_request`），按钮态按此显示。
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  apiErrorText,
  fetchMarketDataset,
  fetchMarketDatasets,
  subscribeMarketDataset,
  unsubscribeMarketDataset,
  type MarketDatasetCard,
  type MarketDatasetDetail,
} from "./api";

//: 无头浏览器的 noindex 纪律（与 ShareView 同款）——市场页不进搜索引擎。
function useNoIndex(): void {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);
}

interface MarketItemProps {
  item: MarketDatasetCard;
  onSubscribe: (id: string) => Promise<void>;
  onUnsubscribe: (id: string) => Promise<void>;
  onOpenDetail: (id: string) => void;
  busy: boolean;
}

function MarketItem({ item, onSubscribe, onUnsubscribe, onOpenDetail, busy }: MarketItemProps) {
  const { t } = useTranslation();
  const approval = item.access_mode === "approval";
  const [subscribed, setSubscribed] = useState(item.subscribed);

  useEffect(() => {
    setSubscribed(item.subscribed);
  }, [item.subscribed]);

  return (
    <li
      data-testid={`market-item-${item.id}`}
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onOpenDetail(item.id)}
          className="text-left"
        >
          <h3 className="text-sm font-semibold text-slate-800 hover:underline">
            {item.name}
          </h3>
          {item.description && (
            <p className="mt-1 line-clamp-2 text-xs text-slate-500">
              {item.description}
            </p>
          )}
        </button>
        <button
          type="button"
          data-testid={`market-subscribe-${item.id}`}
          disabled={busy}
          onClick={async () => {
            if (subscribed) {
              await onUnsubscribe(item.id);
              setSubscribed(false);
            } else {
              await onSubscribe(item.id);
              // approval 模式下订阅转申请：不置 subscribed（等批准）。
              if (!approval) setSubscribed(true);
            }
          }}
          className={`shrink-0 rounded-md px-3 py-1.5 text-xs transition-colors disabled:opacity-40 ${
            subscribed
              ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
              : "bg-slate-900 text-white hover:bg-slate-700"
          }`}
        >
          {subscribed
            ? t("console.market.unsubscribe")
            : approval
              ? t("console.market.requestAccess")
              : t("console.market.subscribe")}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        {item.domain && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
            {item.domain}
          </span>
        )}
        {item.tags.slice(0, 4).map((tag) => (
          <span key={tag} className="rounded bg-slate-50 px-1.5 py-0.5">
            #{tag}
          </span>
        ))}
        <span>{t("console.market.rowsLabel", { count: item.row_count })}</span>
        {item.published_at && (
          <span>{t("console.market.publishedAt", { at: item.published_at })}</span>
        )}
      </div>
    </li>
  );
}

export function MarketPage() {
  const { t } = useTranslation();
  useNoIndex();

  const [items, setItems] = useState<MarketDatasetCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [domain, setDomain] = useState("");
  const [tag, setTag] = useState("");
  const [detail, setDetail] = useState<MarketDatasetDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchMarketDatasets({
        q: q.trim() || undefined,
        domain: domain.trim() || undefined,
        tag: tag.trim() || undefined,
      });
      setItems(page.items);
      setTotal(page.total);
    } catch (err) {
      setError(apiErrorText(err, t("console.market.loadError")));
    } finally {
      setLoading(false);
    }
  }, [q, domain, tag, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubscribe = useCallback(
    async (id: string) => {
      setBusy(true);
      setActionError(null);
      try {
        await subscribeMarketDataset(id);
        await load();
      } catch (err) {
        setActionError(apiErrorText(err, t("console.market.actionError")));
      } finally {
        setBusy(false);
      }
    },
    [load, t],
  );

  const handleUnsubscribe = useCallback(
    async (id: string) => {
      setBusy(true);
      setActionError(null);
      try {
        await unsubscribeMarketDataset(id);
        await load();
      } catch (err) {
        setActionError(apiErrorText(err, t("console.market.actionError")));
      } finally {
        setBusy(false);
      }
    },
    [load, t],
  );

  const openDetail = useCallback(
    async (id: string) => {
      setActionError(null);
      try {
        setDetail(await fetchMarketDataset(id));
      } catch (err) {
        setActionError(apiErrorText(err, t("console.market.actionError")));
      }
    },
    [t],
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header>
        <h1 className="text-lg font-semibold text-slate-900">
          {t("console.market.title")}
        </h1>
        <p className="mt-1 text-xs text-slate-500">{t("console.market.subtitle")}</p>
      </header>

      <form
        className="mt-4 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <input
          data-testid="market-search-input"
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={t("console.market.searchPlaceholder")}
          className="min-w-56 flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm"
        />
        <input
          type="text"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder={t("console.market.domainPlaceholder")}
          className="w-32 rounded-md border border-slate-200 px-3 py-1.5 text-sm"
        />
        <input
          type="text"
          value={tag}
          onChange={(event) => setTag(event.target.value)}
          placeholder={t("console.market.tagPlaceholder")}
          className="w-32 rounded-md border border-slate-200 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700"
        >
          {t("console.market.search")}
        </button>
      </form>

      {actionError && (
        <p data-testid="market-action-error" className="mt-3 text-xs text-rose-600">
          {actionError}
        </p>
      )}

      {loading && (
        <p className="mt-6 text-sm text-slate-500">{t("console.market.loading")}</p>
      )}
      {error && !loading && (
        <div className="mt-6 text-sm text-rose-600">
          {error}
          <button
            type="button"
            onClick={() => void load()}
            className="ml-2 text-xs underline"
          >
            {t("console.market.retry")}
          </button>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <p data-testid="market-empty" className="mt-6 text-sm text-slate-500">
          {t("console.market.empty")}
        </p>
      )}
      {!loading && !error && items.length > 0 && (
        <>
          <p className="mt-4 text-xs text-slate-400">
            {t("console.market.total", { total })}
          </p>
          <ul data-testid="market-list" className="mt-2 space-y-3">
            {items.map((item) => (
              <MarketItem
                key={item.id}
                item={item}
                busy={busy}
                onSubscribe={handleSubscribe}
                onUnsubscribe={handleUnsubscribe}
                onOpenDetail={openDetail}
              />
            ))}
          </ul>
        </>
      )}

      {detail && (
        <section
          data-testid="market-detail"
          className="mt-6 rounded-lg border border-slate-200 bg-slate-50/60 p-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">
              {t("console.market.detailTitle")}：{detail.name}
            </h2>
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="text-xs text-slate-500 underline"
            >
              {t("console.market.close")}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {t("console.market.rowsLabel", { count: detail.row_count })}
          </p>
          <h3 className="mt-3 text-xs font-semibold text-slate-600">
            {t("console.market.columnsTitle")}
          </h3>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {detail.columns.map((column) => (
              <li
                key={column.name}
                className="rounded bg-white px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200"
              >
                {column.name}
                <span className="ml-1 text-slate-400">{column.type}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
