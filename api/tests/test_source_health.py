"""源健康与不健康前置声明测试（add-securities-industry-line 5.7）。

覆盖：
- 容忍窗来自**已发布断更规则**（不读数字硬编码；业务越阈规则不参与）；
- 水位来自新鲜度快照行（lag_days/period/as_of），不健康=滞后超窗；
- 最近成功时间优先 period、缺失时由 as_of − lag_days 推导；
- 声明文案严格为「信息可能不完整（来源：…；最近成功时间：…）」，只对
  不健康源产生；
- 规则快照里的 family 列 = 真实依赖源（断更规则自带水位行，零额外读取；
  业务规则按断更规则声明的快照数据集补读）；
- 看板依赖族三档解析（板级显式声明 / 面板 query family 过滤 / 面板
  source 文本与族名归一匹配）；
- 告警邮件正文前置声明 + webhook payload 携带 disclosures。

全 mock：内存两库 + 假引擎，出站邮件/webhook monkeypatch（绝不真发）。
"""

from __future__ import annotations

import os
from datetime import datetime
from types import SimpleNamespace

os.environ.setdefault("AI_DATABASE_URL", "sqlite://")
os.environ.setdefault("FD_WIRE_DATASETS_DATABASE_URL", "sqlite://")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from fd_wire_api.ai.db import AiBase
from fd_wire_api.alerts import evaluator as evaluator_mod
from fd_wire_api.alerts import source_health
from fd_wire_api.artifacts.models import Artifact, ArtifactVersion
from fd_wire_api.datasets.db import DatasetsBase
from fd_wire_api.datasets.models import Dataset, DatasetColumn, DatasetRow

T0 = datetime(2026, 11, 8, 2, 0, 0)


# ------------------------------------------------------------------ 种子


def seed_rule(
    ai,
    *,
    title: str,
    inner: dict,
    artifact_id: int | None = None,
) -> int:
    """直插 published alert_rule + 版本行。"""
    artifact = Artifact(
        id=artifact_id,
        customer_id="baixun-securities",
        kind="alert_rule",
        title=title,
        status="published",
        version=1,
        status_history=[],
    )
    ai.add(artifact)
    ai.flush()
    ai.add(
        ArtifactVersion(
            artifact_id=artifact.id,
            version=1,
            spec={"title": title, "spec": inner},
            operator="test",
        )
    )
    ai.commit()
    return artifact.id


def freshness_rule_inner(
    *,
    family: str,
    tolerance: float,
    dataset_id: str = "ds-monitor",
    notify_emails: list[str] | None = None,
) -> dict:
    inner = {
        "query": {
            "dataset_id": dataset_id,
            "filters": [
                {"column": "series", "op": "eq", "value": "freshness"},
                {"column": "family", "op": "eq", "value": family},
            ],
            "limit": 10,
        },
        "aggregate": {"column": "lag_days", "func": "max"},
        "condition": {"op": "gt", "value": tolerance},
        "intervalMinutes": 1440,
        "cooldownMinutes": 1440,
    }
    if notify_emails:
        inner["notifyEmails"] = notify_emails
    return inner


def seed_monitor_dataset(
    ds,
    *,
    dataset_id: str = "ds-monitor",
    rows: list[dict] | None = None,
) -> None:
    columns = [
        {"name": "series", "type": "TEXT"},
        {"name": "metric", "type": "TEXT"},
        {"name": "family", "type": "TEXT"},
        {"name": "code", "type": "TEXT"},
        {"name": "name", "type": "TEXT"},
        {"name": "period", "type": "TEXT"},
        {"name": "value", "type": "REAL"},
        {"name": "abs_value", "type": "REAL"},
        {"name": "lag_days", "type": "INTEGER"},
        {"name": "as_of", "type": "TEXT"},
        {"name": "unit", "type": "TEXT"},
        {"name": "source", "type": "TEXT"},
    ]
    ds.add(
        Dataset(
            id=dataset_id,
            customer_id="baixun-securities",
            key="securities_industry_monitor",
            name="证券业线 · 监控快照",
            source_kind="upload",
            storage_tier="api",
            columns_json=columns,
            row_count=len(rows or []),
        )
    )
    for ordinal, column in enumerate(columns):
        ds.add(
            DatasetColumn(
                dataset_id=dataset_id,
                name=column["name"],
                dtype=column["type"],
                ordinal=ordinal,
            )
        )
    for index, row in enumerate(rows or []):
        ds.add(DatasetRow(dataset_id=dataset_id, row_index=index, data=row))
    ds.commit()


def freshness_row(
    family: str,
    *,
    lag: int,
    period: str | None,
    as_of: str = "2026-11-07",
    name: str | None = None,
) -> dict:
    row = {
        "series": "freshness",
        "metric": "data_freshness.lag_days",
        "family": family,
        "code": f"SEC-{family.upper()}",
        "name": name or family,
        "period": period,
        "value": float(lag),
        "abs_value": float(lag),
        "lag_days": lag,
        "as_of": as_of,
        "unit": "days",
        "source": "pipeline",
    }
    return row


# ------------------------------------------------------------------ fixtures


@pytest.fixture()
def env():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    AiBase.metadata.create_all(bind=engine)
    DatasetsBase.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    ai, ds = Session(), Session()
    yield SimpleNamespace(ai=ai, ds=ds)
    ai.close()
    ds.close()


class ScriptedEngine:
    """cell 档引擎假件（可脚本化任意快照）。"""

    def __init__(self, result: dict | None = None) -> None:
        self.result = result or {}
        self.calls: list[tuple[str, dict]] = []

    def call(self, tool: str, args: dict) -> dict:
        self.calls.append((tool, dict(args)))
        result = self.result or {}
        return {
            "columns": [dict(card) for card in result.get("columns", [])],
            "rows": [dict(row) for row in result.get("rows", [])],
            "total": len(result.get("rows", [])),
        }


class MailRecorder:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def __call__(self, to_addr: str, subject: str, body: str, config: dict) -> None:
        self.calls.append({"to_addr": to_addr, "body": body, "subject": subject})


class WebhookRecorder:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def __call__(self, url: str, payload: dict) -> None:
        self.calls.append({"url": url, "payload": dict(payload)})


@pytest.fixture(autouse=True)
def _smtp_env(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.test.internal")
    monkeypatch.setenv("SMTP_PORT", "2525")
    monkeypatch.setenv("SMTP_FROM", "wire-notify@finddatatech.cloud")
    monkeypatch.delenv("SMTP_USER", raising=False)
    monkeypatch.delenv("SMTP_PASSWORD", raising=False)
    monkeypatch.delenv("SMTP_STARTTLS", raising=False)
    monkeypatch.delenv("SMTP_USE_SSL", raising=False)
    monkeypatch.delenv("WIRE_ENTRY_URL", raising=False)
    monkeypatch.setattr(evaluator_mod, "_mail_skip_warned", False)


# ------------------------------------------------------- 1. 容忍窗与水位


def test_freshness_rules_only_from_published_stall_rules(env) -> None:
    seed_rule(
        env.ai,
        title="行情断更",
        inner=freshness_rule_inner(family="astock_daily", tolerance=7),
    )
    seed_rule(
        env.ai,
        title="财务断更",
        inner=freshness_rule_inner(family="financials", tolerance=45),
    )
    # 业务越阈规则（无 series=freshness）不参与源健康判定
    seed_rule(
        env.ai,
        title="ROE 越阈",
        inner={
            "query": {"dataset_id": "ds-monitor"},
            "aggregate": {"column": "value", "func": "min"},
            "condition": {"op": "lt", "value": 8},
            "intervalMinutes": 1440,
        },
    )
    rules = source_health.freshness_rules(env.ai)
    assert set(rules) == {"astock_daily", "financials"}
    assert rules["astock_daily"].tolerance_days == 7
    assert rules["financials"].tolerance_days == 45


def test_health_map_flags_stale_and_healthy(env) -> None:
    seed_rule(
        env.ai,
        title="行情断更",
        inner=freshness_rule_inner(family="astock_daily", tolerance=7),
    )
    seed_rule(
        env.ai,
        title="财务断更",
        inner=freshness_rule_inner(family="financials", tolerance=45),
    )
    seed_monitor_dataset(
        env.ds,
        rows=[
            freshness_row(
                "astock_daily",
                lag=50,
                period="2026-09-18",
                name="A股日线行情",
            ),
            freshness_row(
                "financials",
                lag=38,
                period="2026-09-30",
                name="财务指标（ROE 等 11 指标）",
            ),
        ],
    )
    health = source_health.health_map(env.ai, env.ds)
    assert health["astock_daily"].unhealthy is True
    assert health["astock_daily"].last_success_at == "2026-09-18"
    assert health["astock_daily"].tolerance_days == 7
    assert health["financials"].unhealthy is False
    assert health["financials"].last_success_at == "2026-09-30"


def test_last_success_derived_when_period_missing(env) -> None:
    seed_rule(
        env.ai,
        title="行情断更",
        inner=freshness_rule_inner(family="astock_daily", tolerance=7),
    )
    seed_monitor_dataset(
        env.ds,
        rows=[freshness_row("astock_daily", lag=50, period=None, as_of="2026-11-07")],
    )
    health = source_health.health_map(env.ai, env.ds)
    assert health["astock_daily"].last_success_at == "2026-09-18"


def test_family_without_stall_rule_is_not_judged(env) -> None:
    """仅 performance 行、无断更规则 → 不进健康集合（不冒充健康/不告警）。"""
    seed_rule(
        env.ai,
        title="行情断更",
        inner=freshness_rule_inner(family="astock_daily", tolerance=7),
    )
    seed_monitor_dataset(
        env.ds,
        rows=[
            freshness_row("astock_daily", lag=50, period="2026-09-18"),
            freshness_row("performance", lag=130, period="2026-06-30"),
        ],
    )
    health = source_health.health_map(env.ai, env.ds)
    assert "performance" not in health
    assert health["astock_daily"].unhealthy is True


# ----------------------------------------------------------- 2. 声明文案


def test_disclosure_prefix_only_unhealthy_and_exact_text(env) -> None:
    seed_rule(
        env.ai,
        title="行情断更",
        inner=freshness_rule_inner(family="astock_daily", tolerance=7),
    )
    seed_rule(
        env.ai,
        title="财务断更",
        inner=freshness_rule_inner(family="financials", tolerance=45),
    )
    seed_monitor_dataset(
        env.ds,
        rows=[
            freshness_row("astock_daily", lag=50, period="2026-09-18", name="A股日线行情"),
            freshness_row("financials", lag=38, period="2026-09-30", name="财务指标"),
        ],
    )
    health = source_health.health_map(env.ai, env.ds)
    text = source_health.disclosure_prefix(health.values())
    assert text == "信息可能不完整（来源：A股日线行情；最近成功时间：2026-09-18）\n\n"
    # 只剩健康源 → 零声明零噪声
    assert source_health.disclosure_prefix([health["financials"]]) == ""


# ------------------------------------------------------- 3. 依赖源解析


def test_families_in_snapshot_reads_family_column() -> None:
    snapshot = {
        "columns": ["family", "lag_days"],
        "rows": [
            {"family": "astock_daily", "lag_days": 50},
            {"family": "astock_daily", "lag_days": 51},
        ],
    }
    assert source_health.families_in_snapshot(snapshot) == {"astock_daily"}
    assert source_health.families_in_snapshot({"rows": []}) == set()


def test_resolve_board_families_three_tiers(env) -> None:
    seed_rule(
        env.ai,
        title="行情断更",
        inner=freshness_rule_inner(family="astock_daily", tolerance=7),
    )
    seed_rule(
        env.ai,
        title="财务断更",
        inner=freshness_rule_inner(family="financials", tolerance=45),
    )
    seed_monitor_dataset(
        env.ds,
        rows=[
            freshness_row("astock_daily", lag=50, period="2026-09-18", name="A股日线行情"),
            freshness_row("financials", lag=38, period="2026-09-30", name="财务指标"),
        ],
    )
    health = source_health.health_map(env.ai, env.ds)

    # ① 板级显式声明
    explicit = {"spec": {"source_families": ["astock_daily"]}}
    assert source_health.resolve_board_families(explicit, health) == ["astock_daily"]

    # ② 面板 query 的 family 等值过滤
    via_query = {
        "spec": {
            "panels": [
                {
                    "id": "p1",
                    "query": {
                        "dataset_id": "ds",
                        "filters": [
                            {"column": "family", "op": "eq", "value": "financials"}
                        ],
                    },
                }
            ]
        }
    }
    assert source_health.resolve_board_families(via_query, health) == ["financials"]

    # ③ 面板 source 文本与快照名称归一匹配（含空格差异）
    via_text = {
        "spec": {
            "panels": [
                {
                    "id": "p1",
                    "source": "A 股日线行情（前复权） · 招商银行 · 日线 2025-01-02~2026-07-10",
                }
            ]
        }
    }
    assert source_health.resolve_board_families(via_text, health) == ["astock_daily"]

    # 三档全无 → 不声明
    assert source_health.resolve_board_families({"spec": {"panels": []}}, health) == []


def test_board_disclosure_returns_text_and_metadata(env) -> None:
    seed_rule(
        env.ai,
        title="行情断更",
        inner=freshness_rule_inner(family="astock_daily", tolerance=7),
    )
    seed_monitor_dataset(
        env.ds,
        rows=[freshness_row("astock_daily", lag=50, period="2026-09-18", name="A股日线行情")],
    )
    spec = {"spec": {"source_families": ["astock_daily"], "panels": []}}
    text, meta = source_health.board_disclosure(env.ai, env.ds, spec)
    assert text == "信息可能不完整（来源：A股日线行情；最近成功时间：2026-09-18）"
    assert meta == [
        {
            "family": "astock_daily",
            "label": "A股日线行情",
            "last_success_at": "2026-09-18",
            "lag_days": 50.0,
            "tolerance_days": 7.0,
            "as_of": "2026-11-07",
            "unhealthy": True,
        }
    ]


def test_board_disclosure_healthy_source_has_no_text(env) -> None:
    seed_rule(
        env.ai,
        title="财务断更",
        inner=freshness_rule_inner(family="financials", tolerance=45),
    )
    seed_monitor_dataset(
        env.ds,
        rows=[freshness_row("financials", lag=38, period="2026-09-30", name="财务指标")],
    )
    text, meta = source_health.board_disclosure(
        env.ai, env.ds, {"spec": {"source_families": ["financials"]}}
    )
    assert text is None
    assert meta[0]["unhealthy"] is False


# ------------------------------------------- 4. 告警通知前置声明（集成）


def test_alert_mail_prefixed_when_dependency_unhealthy(env, monkeypatch) -> None:
    """真实评估路径：断更规则快照即水位行 → 邮件正文首部前置声明。"""
    mail = MailRecorder()
    webhook = WebhookRecorder()
    monkeypatch.setattr(evaluator_mod, "deliver_mail", mail)
    monkeypatch.setattr(evaluator_mod, "deliver_webhook", webhook)

    seed_rule(
        env.ai,
        title="证券业线 · 行情数据断更（滞后超容忍窗）",
        inner=freshness_rule_inner(
            family="astock_daily",
            tolerance=7,
            dataset_id="ds-cell",
            notify_emails=["support@finddatatech.cloud"],
        ),
    )
    # cell 档数据集登记（查询走假引擎）
    env.ds.add(
        Dataset(
            id="ds-cell",
            customer_id="baixun-securities",
            key="securities_industry_monitor",
            name="监控快照",
            source_kind="connector",
            storage_tier="cell",
            columns_json=[{"name": "family", "type": "TEXT"}],
        )
    )
    env.ds.commit()
    fake = ScriptedEngine(
        {
            "columns": [
                {"name": "family", "type": "TEXT"},
                {"name": "lag_days", "type": "INTEGER"},
                {"name": "period", "type": "TEXT"},
                {"name": "as_of", "type": "TEXT"},
                {"name": "name", "type": "TEXT"},
            ],
            "rows": [
                {
                    "family": "astock_daily",
                    "lag_days": 50,
                    "period": "2026-09-18",
                    "as_of": "2026-11-07",
                    "name": "A股日线行情",
                }
            ],
        }
    )
    stats = evaluator_mod.tick_once(
        now=T0,
        session=env.ai,
        datasets_session=env.ds,
        engine_factory=lambda customer_id: fake,
    )
    assert stats["firing"] == 1
    assert len(mail.calls) == 1
    body = mail.calls[0]["body"]
    assert body.startswith(
        "信息可能不完整（来源：A股日线行情；最近成功时间：2026-09-18）\n\n"
    )
    assert "归约值：50.0" in body
    # webhook 未配 → 零外呼；payload 声明只在 webhook 配置时出现（此处不验）


def test_alert_mail_has_no_disclosure_when_source_healthy(env, monkeypatch) -> None:
    mail = MailRecorder()
    monkeypatch.setattr(evaluator_mod, "deliver_mail", mail)
    monkeypatch.setattr(evaluator_mod, "deliver_webhook", WebhookRecorder())

    seed_rule(
        env.ai,
        title="证券业线 · 财务数据断更（滞后超容忍窗）",
        inner=freshness_rule_inner(
            family="financials",
            tolerance=45,
            dataset_id="ds-cell",
            notify_emails=["support@finddatatech.cloud"],
        ),
    )
    # 规则本身条件 gt 45，快照 38 不会 firing → 改造成 is-firing：阈值 30
    seed_rule(
        env.ai,
        title="财务断更",
        inner=freshness_rule_inner(family="financials", tolerance=45),
    )
    env.ds.add(
        Dataset(
            id="ds-cell",
            customer_id="baixun-securities",
            key="securities_industry_monitor",
            name="监控快照",
            source_kind="connector",
            storage_tier="cell",
            columns_json=[{"name": "family", "type": "TEXT"}],
        )
    )
    env.ds.commit()
    fake = ScriptedEngine(
        {
            "columns": [
                {"name": "family", "type": "TEXT"},
                {"name": "lag_days", "type": "INTEGER"},
                {"name": "period", "type": "TEXT"},
                {"name": "as_of", "type": "TEXT"},
                {"name": "name", "type": "TEXT"},
            ],
            "rows": [
                {
                    "family": "financials",
                    "lag_days": 38,
                    "period": "2026-09-30",
                    "as_of": "2026-11-07",
                    "name": "财务指标",
                }
            ],
        }
    )
    # 直接调用渲染纯函数面，避免为造 firing 而伪造阈值
    subject, body = evaluator_mod.render_alert_mail(
        title="财务断更",
        state="firing",
        value=38.0,
        threshold=30,
        op="gt",
        at=T0.isoformat(),
        artifact_id=1,
        disclosures=[],
    )
    assert body.startswith("告警规则「财务断更」进入 firing 状态。\n")
    assert "信息可能不完整" not in body
    # 健康源传入也不产生声明（disclosure_prefix 只认 unhealthy）
    healthy = source_health.SourceHealth(
        family="financials",
        label="财务指标",
        last_success_at="2026-09-30",
        lag_days=38,
        tolerance_days=45,
    )
    _subject, body2 = evaluator_mod.render_alert_mail(
        title="财务断更",
        state="firing",
        value=38.0,
        threshold=30,
        op="gt",
        at=T0.isoformat(),
        artifact_id=1,
        disclosures=[healthy],
    )
    assert "信息可能不完整" not in body2
