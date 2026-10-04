"""内部后台 API 测试（wire-platform-v1 任务 7.1）。

覆盖：
- 鉴权 fail-closed（env 未配置一律 403；缺头/错头 401）
- 客户 CRUD（开户本地档位关联 / 改档 / 改状态 / 重复与未知档位裁决）
- 客户用量只读联查（sub2api_user_id 承载 caller 身份映射）
- 账本只读联查（过滤参数与 422/404）
- 需求单派发（全客户列表 + 状态过滤 + 迁移转发 service 层语义）
- 目录治理（registered 列表只读 + 审核意见 append-only + 镜像不可写）
- 用量分轨聚合（credential_track × source + 时间窗）

测试库布局：admin/billing/metering/demands/catalog 各域表全部落在同一个
临时 sqlite 文件（对应生产单平台库口径）；demands 走 dependency_overrides，
catalog 经 catalog_settings 指库（与其既有测试同款手法）。
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from fd_wire_api.admin import reset_admin_runtime
from fd_wire_api.admin.db import AdminBase, get_session
from fd_wire_api.app import app
from fd_wire_api.billing import METERING_RECORDS_DDL, Base as BillingBase, LedgerKind, seed_plans
from fd_wire_api.billing.ledger import Ledger
from fd_wire_api.catalog import catalog_settings, init_db as init_catalog_db
from fd_wire_api.catalog import reset_engines as reset_catalog_engines
from fd_wire_api.catalog.db import sync_session
from fd_wire_api.catalog.models import CatalogSyncState, IndicatorSnapshot
from fd_wire_api.demands.db import Base as DemandsBase
from fd_wire_api.demands.db import get_db as get_demands_db
from fd_wire_api.metering.db import to_utc
from fd_wire_api.metering.models import MeteringRecord

ADMIN_TOKEN = "test-admin-token"
AUTH = {"X-Admin-Token": ADMIN_TOKEN}


def _ts(value: str) -> datetime:
    return to_utc(datetime.fromisoformat(value))


@pytest.fixture()
def admin_env(tmp_path, monkeypatch):
    """单库联查环境：admin/billing/metering/demands/catalog 同一临时文件库。"""
    db_url = f"sqlite:///{tmp_path/'admin.db'}"
    monkeypatch.setenv("FD_WIRE_ADMIN_DATABASE_URL", db_url)
    monkeypatch.setenv("FD_WIRE_ADMIN_TOKEN", ADMIN_TOKEN)
    # 需求单默认引擎不落本机文件（本测试不经它，仅防 import 副作用）
    monkeypatch.setenv("FD_WIRE_DATABASE_URL", "sqlite://")
    # 目录镜像指同一文件库
    monkeypatch.setattr(catalog_settings, "catalog_database_url", db_url)
    monkeypatch.setattr(catalog_settings, "database_url", None)
    monkeypatch.setattr(catalog_settings, "catalog_sync_enabled", False)
    monkeypatch.setattr(catalog_settings, "catalog_sync_on_startup", False)

    reset_admin_runtime()
    reset_catalog_engines()

    engine = create_engine(
        db_url, connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    # 各域表同库落表（对应生产 alembic 链 0001–0007 的单库口径）
    AdminBase.metadata.create_all(engine)
    BillingBase.metadata.create_all(engine)
    DemandsBase.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text(METERING_RECORDS_DDL))
    # catalog 镜像经其 rw 引擎建表（同一文件库）
    init_catalog_db()
    # catalog_sync_state 单行兜底（同步器水位表语义：恒一行）
    with sync_session() as sess:
        if sess.get(CatalogSyncState, 1) is None:
            sess.add(CatalogSyncState(id=1))
            sess.commit()

    # billing 档位播种（三档 seed，经 admin 会话工厂同库写入）
    with get_session() as sess:
        seed_plans(sess)
        sess.commit()

    # demands 会话同库（override 其 get_db；客户侧 API 造数也走它）
    testing_session = sessionmaker(
        bind=engine, autoflush=False, expire_on_commit=False
    )

    def override_demands_db():
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_demands_db] = override_demands_db
    client = TestClient(app)  # 不走 lifespan：避免默认引擎副作用
    yield SimpleNamespace(client=client, engine=engine, db_url=db_url)
    app.dependency_overrides.pop(get_demands_db, None)
    reset_admin_runtime()
    reset_catalog_engines()
    engine.dispose()


# ---------------------------------------------------------------------------
# 种子工具
# ---------------------------------------------------------------------------


def add_metering_row(
    *,
    request_id: str,
    caller: str,
    track: str,
    rows: int,
    ts: str,
    source: str,
    server: str = "business-mcp",
) -> None:
    with get_session() as sess:
        sess.add(
            MeteringRecord(
                event_timestamp=_ts(ts),
                request_id=request_id,
                caller=caller,
                credential_track=track,
                server_name=server,
                rows_returned=rows,
                source=source,
            )
        )
        sess.commit()


def add_snapshot(indicator_id: str, status: str = "registered") -> None:
    with sync_session() as sess:
        sess.add(
            IndicatorSnapshot(
                indicator_id=indicator_id,
                code=indicator_id.upper(),
                name_zh=f"名称-{indicator_id}",
                domain="macro",
                frequency="monthly",
                status=status,
                synced_at=datetime.now(timezone.utc),
            )
        )
        sess.commit()


def add_ledger_entry(*, customer_id: int, kind: LedgerKind, period: str,
                     amount_micro: int, quantity: int = 0, key: str) -> None:
    with get_session() as sess:
        Ledger(sess).record(
            customer_id=customer_id,
            kind=kind,
            period=period,
            quantity=quantity,
            amount_micro=amount_micro,
            idempotency_key=key,
        )
        sess.commit()


def create_customer(client: TestClient, name: str, plan_code: str = "starter",
                    sub2api_user_id: str | None = None) -> dict:
    resp = client.post(
        "/internal/admin/customers",
        json={"name": name, "plan_code": plan_code, "sub2api_user_id": sub2api_user_id},
        headers=AUTH,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def submit_demand(client: TestClient, customer_id: str, title: str) -> dict:
    resp = client.post(
        "/api/v1/demands",
        json={"title": title, "intent": f"需要 {title} 相关数据"},
        headers={"X-Customer-Id": customer_id},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# 鉴权（fail-closed）
# ---------------------------------------------------------------------------


def test_auth_fail_closed_when_token_not_configured(tmp_path, monkeypatch):
    """env 未配置 FD_WIRE_ADMIN_TOKEN：任何请求（带头/不带头）一律 403。"""
    monkeypatch.delenv("FD_WIRE_ADMIN_TOKEN", raising=False)
    plain = TestClient(app)
    assert plain.get("/internal/admin/customers").status_code == 403
    assert (
        plain.get(
            "/internal/admin/customers", headers={"X-Admin-Token": "whatever"}
        ).status_code
        == 403
    )
    assert (
        plain.get("/internal/admin/usage/overview", headers={"X-Admin-Token": "x"}).status_code
        == 403
    )


def test_auth_rejects_missing_or_wrong_token(admin_env):
    client = admin_env.client
    assert client.get("/internal/admin/customers").status_code == 401
    assert (
        client.get(
            "/internal/admin/customers", headers={"X-Admin-Token": "wrong"}
        ).status_code
        == 401
    )
    assert client.get("/internal/admin/customers", headers=AUTH).status_code == 200


# ---------------------------------------------------------------------------
# 客户管理
# ---------------------------------------------------------------------------


def test_customer_create_and_list_with_plan(admin_env):
    client = admin_env.client
    created = create_customer(client, "上海壹座", "professional", "acme-caller")
    assert created["plan_code"] == "professional"
    assert created["plan_name"] == "专业版"
    assert created["status"] == "active"
    assert created["sub2api_user_id"] == "acme-caller"

    listing = client.get("/internal/admin/customers", headers=AUTH).json()
    assert [c["name"] for c in listing] == ["上海壹座"]
    assert listing[0]["plan_code"] == "professional"

    # 档位下拉数据源（billing_plans 只读）
    plans = client.get("/internal/admin/plans", headers=AUTH).json()
    assert [p["code"] for p in plans] == ["starter", "professional", "enterprise"]
    assert any(p["monthly_price_yuan"].startswith("¥") for p in plans)


def test_customer_create_validations(admin_env):
    client = admin_env.client
    # 未知档位 → 422（billing get_plan 的裁决透传）
    resp = client.post(
        "/internal/admin/customers",
        json={"name": "X", "plan_code": "nonexistent"},
        headers=AUTH,
    )
    assert resp.status_code == 422
    # 同名同档重复开户 → 409
    create_customer(client, "重复客户", "starter")
    resp = client.post(
        "/internal/admin/customers",
        json={"name": "重复客户", "plan_code": "starter"},
        headers=AUTH,
    )
    assert resp.status_code == 409
    # caller 身份映射键占用冲突 → 409
    resp = client.post(
        "/internal/admin/customers",
        json={"name": "另一家", "plan_code": "enterprise", "sub2api_user_id": "dup-caller"},
        headers=AUTH,
    )
    assert resp.status_code == 201
    resp = client.post(
        "/internal/admin/customers",
        json={"name": "第三家", "plan_code": "starter", "sub2api_user_id": "dup-caller"},
        headers=AUTH,
    )
    assert resp.status_code == 409


def test_customer_patch_plan_and_status(admin_env):
    client = admin_env.client
    customer = create_customer(client, "萬星", "starter")
    cid = customer["id"]

    resp = client.patch(
        f"/internal/admin/customers/{cid}",
        json={"plan_code": "enterprise"},
        headers=AUTH,
    )
    assert resp.status_code == 200
    assert resp.json()["plan_code"] == "enterprise"

    resp = client.patch(
        f"/internal/admin/customers/{cid}", json={"status": "suspended"}, headers=AUTH
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "suspended"

    # 空补丁 → 422；未知客户 → 404；未知档位 → 422
    assert (
        client.patch(
            f"/internal/admin/customers/{cid}", json={}, headers=AUTH
        ).status_code
        == 422
    )
    assert (
        client.patch(
            "/internal/admin/customers/99999", json={"status": "closed"}, headers=AUTH
        ).status_code
        == 404
    )
    assert (
        client.patch(
            f"/internal/admin/customers/{cid}",
            json={"plan_code": "ghost"},
            headers=AUTH,
        ).status_code
        == 422
    )


# ---------------------------------------------------------------------------
# 客户用量（metering_records 只读联查）
# ---------------------------------------------------------------------------


def test_customer_usage_readonly_join_by_caller_identity(admin_env):
    client = admin_env.client
    customer = create_customer(client, "壹座数据", "starter", "acme-caller")
    other = create_customer(client, "别家", "starter", "other-caller")
    no_mapping = create_customer(client, "未映射", "starter")

    add_metering_row(request_id="m-1", caller="acme-caller", track="customer",
                     rows=120, ts="2026-09-20T10:00:00+00:00", source="yizuo")
    add_metering_row(request_id="m-2", caller="acme-caller", track="customer",
                     rows=80, ts="2026-10-02T10:00:00+00:00", source="wanxing")
    # 同 caller 但平台轨（AI 探索归集，不进客户账单）
    add_metering_row(request_id="m-3", caller="acme-caller", track="platform",
                     rows=999, ts="2026-10-03T10:00:00+00:00", source="platform-internal")
    # 其他客户身份
    add_metering_row(request_id="m-4", caller="other-caller", track="customer",
                     rows=50, ts="2026-10-03T11:00:00+00:00", source="customer")

    body = client.get(f"/internal/admin/customers/{customer['id']}/usage", headers=AUTH).json()
    assert body["caller"] == "acme-caller"
    assert body["totals"] == {"period": "all", "calls": 2, "rows": 200}
    assert body["periods"] == [
        {"period": "2026-09", "calls": 1, "rows": 120},
        {"period": "2026-10", "calls": 1, "rows": 80},
    ]

    # 身份映射未建立：空聚合如实返回
    body = client.get(f"/internal/admin/customers/{no_mapping['id']}/usage", headers=AUTH).json()
    assert body["caller"] is None
    assert body["totals"]["rows"] == 0
    assert body["periods"] == []

    # 别家客户不受污染；未知客户 404
    body = client.get(f"/internal/admin/customers/{other['id']}/usage", headers=AUTH).json()
    assert body["totals"] == {"period": "all", "calls": 1, "rows": 50}
    assert (
        client.get("/internal/admin/customers/99999/usage", headers=AUTH).status_code
        == 404
    )


# ---------------------------------------------------------------------------
# 账本（billing_ledger_entries 只读）
# ---------------------------------------------------------------------------


def test_ledger_readonly_with_filters(admin_env):
    client = admin_env.client
    c1 = create_customer(client, "客户甲", "starter")
    c2 = create_customer(client, "客户乙", "starter")
    add_ledger_entry(customer_id=c1["id"], kind=LedgerKind.GRANT, period="2026-09",
                     amount_micro=1_999_000_000, quantity=500_000, key="grant:1:2026-09")
    add_ledger_entry(customer_id=c1["id"], kind=LedgerKind.OVERAGE, period="2026-10",
                     amount_micro=4_000, quantity=1, key="settle:2026-10:period:1")
    add_ledger_entry(customer_id=c2["id"], kind=LedgerKind.GRANT, period="2026-10",
                     amount_micro=1_999_000_000, quantity=500_000, key="grant:2:2026-10")

    entries = client.get("/internal/admin/ledger", headers=AUTH).json()
    assert len(entries) == 3
    assert entries[0]["kind"] == "grant"
    assert entries[0]["amount_yuan_str"] == "¥1,999.00"
    assert str(entries[0]["amount_yuan"]) == "1999.00"

    only = client.get(
        "/internal/admin/ledger",
        params={"customer_id": c1["id"], "period": "2026-10"},
        headers=AUTH,
    ).json()
    assert [e["idempotency_key"] for e in only] == ["settle:2026-10:period:1"]
    assert only[0]["amount_yuan_str"] == "¥0.00"

    assert (
        client.get("/internal/admin/ledger", params={"period": "2026-13"}, headers=AUTH).status_code
        == 422
    )
    assert (
        client.get("/internal/admin/ledger", params={"customer_id": 99999}, headers=AUTH).status_code
        == 404
    )


# ---------------------------------------------------------------------------
# 需求单派发台
# ---------------------------------------------------------------------------


def test_demands_list_all_customers_with_status_filter(admin_env):
    client = admin_env.client
    d1 = submit_demand(client, "cust-001", "煤价日度数据")
    d2 = submit_demand(client, "cust-002", "航运运价")
    # cust-002 的一单推进到 evaluating（走既有内部端点语义）
    resp = client.post(
        f"/internal/demands/{d2['id']}/transition",
        json={"target_status": "evaluating", "by": "tester"},
        headers={"X-Internal-Token": "wire-internal-dev"},
    )
    assert resp.status_code == 200, resp.text

    listing = client.get("/internal/admin/demands", headers=AUTH).json()
    assert len(listing) == 2  # 全客户：两家各一单
    assert {d["customer_id"] for d in listing} == {"cust-001", "cust-002"}
    # 内部完整视图字段在（派发台上下文）
    assert all("evaluation_detail" in d for d in listing)

    submitted = client.get(
        "/internal/admin/demands", params={"status": "submitted"}, headers=AUTH
    ).json()
    assert [d["id"] for d in submitted] == [d1["id"]]
    evaluating = client.get(
        "/internal/admin/demands", params={"status": "evaluating"}, headers=AUTH
    ).json()
    assert [d["id"] for d in evaluating] == [d2["id"]]


def test_demands_transition_forwards_service_semantics(admin_env):
    client = admin_env.client
    demand = submit_demand(client, "cust-001", "光伏装机")

    # 非法迁移（submitted → delivered 不在白名单）→ 409，状态不变
    resp = client.post(
        f"/internal/admin/demands/{demand['id']}/transition",
        json={"target_status": "delivered"},
        headers=AUTH,
    )
    assert resp.status_code == 409

    # 合法迁移：submitted → evaluating（service 层直调 + 自动预评估）
    resp = client.post(
        f"/internal/admin/demands/{demand['id']}/transition",
        json={"target_status": "evaluating", "note": "派发台接单", "by": "admin-console"},
        headers=AUTH,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "evaluating"
    # 时间线追加派发记录（append-only，by=admin-console）
    assert body["status_history"][-1]["by"] == "admin-console"
    # 迁移到 evaluating 后自动跑 AI 预评估（无 LLM 时如实 doubtful）
    assert body["evaluation_summary"] is not None

    # 未知需求单 → 404
    assert (
        client.post(
            "/internal/admin/demands/99999/transition",
            json={"target_status": "evaluating"},
            headers=AUTH,
        ).status_code
        == 404
    )


# ---------------------------------------------------------------------------
# 目录治理
# ---------------------------------------------------------------------------


def test_catalog_pending_and_verify_notes_append_only(admin_env):
    client = admin_env.client
    add_snapshot("ind-reg-1", "registered")
    add_snapshot("ind-reg-2", "registered")
    add_snapshot("ind-ver-1", "verified")

    # 默认 registered：只看待治理
    body = client.get("/internal/admin/catalog/pending", headers=AUTH).json()
    assert body["status"] == "registered"
    assert [i["indicator_id"] for i in body["items"]] == ["ind-reg-1", "ind-reg-2"]
    assert body["total"] == 2

    # verified 复查视图；非法状态 → 422
    body = client.get(
        "/internal/admin/catalog/pending", params={"status": "verified"}, headers=AUTH
    ).json()
    assert [i["indicator_id"] for i in body["items"]] == ["ind-ver-1"]
    assert (
        client.get(
            "/internal/admin/catalog/pending", params={"status": "ghost"}, headers=AUTH
        ).status_code
        == 422
    )

    # 审核意见 append-only：两条按时间正序可查，绝不覆盖
    r1 = client.post(
        "/internal/admin/catalog/ind-reg-1/verify-note",
        json={"note": "口径核对通过，待权威库复核", "author": "op-alice"},
        headers=AUTH,
    )
    assert r1.status_code == 201
    r2 = client.post(
        "/internal/admin/catalog/ind-reg-1/verify-note",
        json={"note": "补充：频率字段存疑"},
        headers=AUTH,
    )
    assert r2.status_code == 201
    notes = client.get("/internal/admin/catalog/ind-reg-1/notes", headers=AUTH).json()
    assert [n["note"] for n in notes] == ["口径核对通过，待权威库复核", "补充：频率字段存疑"]
    assert notes[0]["author"] == "op-alice"
    assert notes[1]["author"] == "admin-console"  # 缺省录入人

    # 空意见 → 422；镜像中不存在的指标 → 404（不凭空留档）
    assert (
        client.post(
            "/internal/admin/catalog/ind-reg-1/verify-note",
            json={"note": " "},
            headers=AUTH,
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/internal/admin/catalog/ind-ghost/verify-note",
            json={"note": "无中生有"},
            headers=AUTH,
        ).status_code
        == 404
    )

    # 镜像数据未被治理台改动（状态仍 registered）
    with sync_session() as sess:
        row = sess.execute(
            text("SELECT status FROM indicator_snapshots WHERE indicator_id='ind-reg-1'")
        ).scalar_one()
        assert row == "registered"


# ---------------------------------------------------------------------------
# 用量分轨概览
# ---------------------------------------------------------------------------


def test_usage_overview_dual_track_and_sources(admin_env):
    client = admin_env.client
    add_metering_row(request_id="o-1", caller="acme", track="customer",
                     rows=100, ts="2026-10-01T10:00:00+00:00", source="yizuo")
    add_metering_row(request_id="o-2", caller="acme", track="customer",
                     rows=40, ts="2026-10-02T10:00:00+00:00", source="wanxing")
    add_metering_row(request_id="o-3", caller="svc-ai", track="platform",
                     rows=60, ts="2026-10-03T10:00:00+00:00", source="platform-internal")
    add_metering_row(request_id="o-0", caller="acme", track="customer",
                     rows=70, ts="2026-09-30T10:00:00+00:00", source="yizuo")

    body = client.get("/internal/admin/usage/overview", headers=AUTH).json()
    tracks = {t["key"]: t for t in body["tracks"]}
    assert tracks["customer"] == {"key": "customer", "calls": 3, "rows": 210}
    assert tracks["platform"] == {"key": "platform", "calls": 1, "rows": 60}
    sources = {s["key"]: s for s in body["by_source"]}
    assert sources["yizuo"]["rows"] == 170
    assert sources["wanxing"]["rows"] == 40
    assert sources["platform-internal"]["rows"] == 60
    assert body["totals"] == {"key": "all", "calls": 4, "rows": 270}

    # 轨道过滤
    body = client.get(
        "/internal/admin/usage/overview",
        params={"credential_track": "customer"},
        headers=AUTH,
    ).json()
    assert body["totals"] == {"key": "all", "calls": 3, "rows": 210}

    # 时间窗过滤（仅 10 月）
    body = client.get(
        "/internal/admin/usage/overview",
        params={"start": "2026-10-01T00:00:00Z", "end": "2026-10-31T23:59:59Z"},
        headers=AUTH,
    ).json()
    assert body["totals"] == {"key": "all", "calls": 3, "rows": 200}

    # 非法参数 → 422
    assert (
        client.get(
            "/internal/admin/usage/overview",
            params={"credential_track": "nope"},
            headers=AUTH,
        ).status_code
        == 422
    )
    assert (
        client.get(
            "/internal/admin/usage/overview", params={"start": "not-a-date"}, headers=AUTH
        ).status_code
        == 422
    )


def test_usage_overview_empty_db(admin_env):
    body = admin_env.client.get("/internal/admin/usage/overview", headers=AUTH).json()
    assert body["tracks"] == []
    assert body["by_source"] == []
    assert body["totals"] == {"key": "all", "calls": 0, "rows": 0}
