"""需求单八态状态机测试（wire-platform-v1 任务 6.3）。

覆盖：
- 全合法路径走通（含目录预填 linked_indicators 提交、gate 不过停留、验收交付）
- 迁移表穷举：8 态 × 8 目标，白名单外一律 409
- 无人工确认绝不进 quoted（transition 与 quote 两条路都验证）
- rejected 必带 reason 且留档客户可见
- 历史不可改：只追加，前缀逐字节稳定，409 尝试不落历史
- 客户侧企业隔离 + 内部 token 鉴权
"""

from __future__ import annotations

import os
import re

# 在导入 app 前把默认引擎指向内存库：TestClient 启动钩子里的
# init_demands_db() 不至于在测试机上落下 fd_wire_demands.db 文件。
os.environ.setdefault("FD_WIRE_DATABASE_URL", "sqlite://")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from fd_wire_api.app import app
from fd_wire_api.demands import DemandStatus, get_db
from fd_wire_api.demands.db import Base
from fd_wire_api.demands.statemachine import ALLOWED_TRANSITIONS

INTERNAL_TOKEN = "wire-internal-dev"
INTERNAL = {"X-Internal-Token": INTERNAL_TOKEN}
CUST = {"X-Customer-Id": "cust-001"}

ALL_STATUSES = list(DemandStatus)
CODE_RE = re.compile(r"^DE-\d{8}-\d{2,}$")


@pytest.fixture()
def client():
    """每个用例独立的内存库 + 覆盖 get_db 的 TestClient。"""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


# ------------------------------------------------------------------ helpers


def submit(client, customer="cust-001", **overrides) -> dict:
    payload = {
        "title": "上海汽车销量月度数据",
        "intent": "需要上海市 2024 年以来乘用车月度销量与价格带分布，用于市场分析",
        "entities_hint": {"region": "上海市", "industry": "汽车"},
        "frequency_expect": "monthly",
        "linked_indicators": ["IND-CPI-001", "IND-AUTO-014"],
    }
    payload.update(overrides)
    resp = client.post("/api/v1/demands", json=payload, headers=CUST | {"X-Customer-Id": customer})
    assert resp.status_code == 201, resp.text
    return resp.json()


def evaluate(client, demand_id: int, summary: str = "可行：公开源存在，更新频率可满足") -> dict:
    resp = client.post(
        f"/internal/demands/{demand_id}/evaluation",
        json={"summary": summary, "by": "ai"},
        headers=INTERNAL,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def quote(client, demand_id: int, confirmed: bool = True, amount="1200.00") -> dict:
    # 6.4 起：报价确认台必带 operator 操作人标识（缺一 409）
    resp = client.post(
        f"/internal/demands/{demand_id}/quote",
        json={
            "amount": amount,
            "note": "首年订阅价",
            "confirmed_by_operator": confirmed,
            "operator": "op-001",
        },
        headers=INTERNAL,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def transition(client, demand_id: int, target: str, **extra) -> dict:
    resp = client.post(
        f"/internal/demands/{demand_id}/transition",
        json={"target_status": target, **extra},
        headers=INTERNAL,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def demand_at(client, target: DemandStatus) -> int:
    """走合法路径把一条需求单推进到指定状态，返回其 id。"""
    d = submit(client)
    did = d["id"]
    if target is DemandStatus.submitted:
        return did
    evaluate(client, did)
    if target is DemandStatus.evaluating:
        return did
    if target is DemandStatus.rejected:
        transition(client, did, "rejected", reason="数据源不存在且无可替代源", by="ai")
        return did
    quote(client, did)
    if target is DemandStatus.quoted:
        return did
    transition(client, did, "awaiting_confirm", by="operator", note="报价已发出")
    if target is DemandStatus.awaiting_confirm:
        return did
    transition(client, did, "building", by="customer:cust-001", note="客户确认报价")
    if target is DemandStatus.building:
        return did
    transition(client, did, "delivery_acceptance", by="system", note="conformance gate 通过")
    if target is DemandStatus.delivery_acceptance:
        return did
    transition(client, did, "delivered", by="customer:cust-001", note="客户验收确认")
    assert target is DemandStatus.delivered
    return did


def get_detail(client, demand_id: int, customer="cust-001") -> dict:
    resp = client.get(
        f"/api/v1/demands/{demand_id}", headers=CUST | {"X-Customer-Id": customer}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


# ------------------------------------------------------- 全合法路径走通


def test_happy_path_full_lifecycle_with_catalog_prefill(client):
    d = submit(client)  # 含目录预填 linked_indicators
    assert CODE_RE.match(d["code"])
    assert d["status"] == "submitted"
    assert d["linked_indicators"] == ["IND-CPI-001", "IND-AUTO-014"]
    assert d["entities_hint"] == {"region": "上海市", "industry": "汽车"}
    assert d["frequency_expect"] == "monthly"
    assert [e["status"] for e in d["status_history"]] == ["submitted"]
    assert all({"status", "at", "by", "note"} <= set(e) for e in d["status_history"])

    did = d["id"]

    # AI 接单 + 预评估（submitted → evaluating，概要客户可见）
    d = evaluate(client, did, summary="可行：统计公报可覆盖，合规初筛通过")
    assert d["status"] == "evaluating"
    assert get_detail(client, did)["evaluation_summary"] == "可行：统计公报可覆盖，合规初筛通过"

    # 人工确认报价（evaluating → quoted）
    d = quote(client, did)
    assert d["status"] == "quoted"
    assert str(d["quote_amount"]) in {"1200.00", "1200.0", "1200"}
    assert d["quote_note"] == "首年订阅价"

    # 报价发出（quoted → awaiting_confirm）
    d = transition(client, did, "awaiting_confirm", by="operator", note="报价已发出")
    assert d["status"] == "awaiting_confirm"

    # 客户确认（awaiting_confirm → building）
    d = transition(client, did, "building", by="customer:cust-001", note="客户确认报价")
    assert d["status"] == "building"

    # gate 不过：building 停留，如实记录构建问题
    d = transition(
        client, did, "building", by="system",
        note="conformance gate 未过：3 处违规（字段命名/时间戳/幂等键）",
    )
    assert d["status"] == "building"
    assert d["status_history"][-1]["note"].startswith("conformance gate 未过")

    # gate 过（building → delivery_acceptance）→ 客户验收（→ delivered）
    d = transition(client, did, "delivery_acceptance", by="system", note="gate 复检通过")
    assert d["status"] == "delivery_acceptance"
    d = transition(client, did, "delivered", by="customer:cust-001", note="客户验收确认")
    assert d["status"] == "delivered"

    # 客户视角：完整时间线，状态序列与时间戳单调不减
    detail = get_detail(client, did)
    timeline = [e["status"] for e in detail["status_history"]]
    assert timeline == [
        "submitted", "evaluating", "quoted", "awaiting_confirm",
        "building", "building", "delivery_acceptance", "delivered",
    ]
    ats = [e["at"] for e in detail["status_history"]]
    assert ats == sorted(ats)


def test_rejected_path_leaves_reason_on_record(client):
    d = submit(client)
    did = d["id"]
    evaluate(client, did, summary="不可行：源不存在，且无可替代公开源")
    d = transition(client, did, "rejected", reason="数据源不存在且无可替代源", by="ai")
    assert d["status"] == "rejected"

    detail = get_detail(client, did)  # 客户可见拒绝理由
    assert detail["rejection_reason"] == "数据源不存在且无可替代源"
    assert detail["status_history"][-1]["status"] == "rejected"
    assert "数据源不存在" in detail["status_history"][-1]["note"]

    # 终态不可再迁移
    resp = client.post(
        f"/internal/demands/{did}/transition",
        json={"target_status": "evaluating"},
        headers=INTERNAL,
    )
    assert resp.status_code == 409


# ------------------------------------------------------- 迁移表穷举（409）


@pytest.mark.parametrize("current", ALL_STATUSES)
@pytest.mark.parametrize("target", ALL_STATUSES)
def test_transition_table_exhaustive(client, current, target):
    """白名单内（且前置齐备）→200；白名单外→409。"""
    did = demand_at(client, current)
    resp = client.post(
        f"/internal/demands/{did}/transition",
        json={
            "target_status": target.value,
            "note": "构建停留说明" if target is DemandStatus.building else "探测",
            "by": "probe",
            "reason": "探测用拒绝理由",
            "confirmed_by_operator": True,  # 前置给足，409 只可能来自白名单
        },
        headers=INTERNAL,
    )
    allowed = target in ALLOWED_TRANSITIONS[current]
    if allowed:
        assert resp.status_code == 200, resp.text
        after = get_detail(client, did)
        assert after["status"] == target.value  # building 停留后仍是 building
    else:
        assert resp.status_code == 409, resp.text


# ------------------------------------------------------- 报价人工确认前置


def test_cannot_reach_quoted_without_operator_confirmation(client):
    did = demand_at(client, DemandStatus.evaluating)

    # 直接迁移 evaluating→quoted：缺人工确认 → 409，状态不动
    resp = client.post(
        f"/internal/demands/{did}/transition",
        json={"target_status": "quoted", "confirmed_by_operator": False},
        headers=INTERNAL,
    )
    assert resp.status_code == 409
    assert get_detail(client, did)["status"] == "evaluating"

    # 报价端点不带确认标志 → 409，不写报价、不迁移
    resp = client.post(
        f"/internal/demands/{did}/quote",
        json={"amount": "800.00", "confirmed_by_operator": False},
        headers=INTERNAL,
    )
    assert resp.status_code == 409
    detail = get_detail(client, did)
    assert detail["status"] == "evaluating"
    assert detail["quote_amount"] is None

    # 带人工确认后才能进 quoted 并落报价
    d = quote(client, did, confirmed=True, amount="800.00")
    assert d["status"] == "quoted"
    assert get_detail(client, did)["quote_amount"] is not None


def test_quote_only_from_evaluating(client):
    did = demand_at(client, DemandStatus.awaiting_confirm)
    resp = client.post(
        f"/internal/demands/{did}/quote",
        json={"amount": "99.00", "confirmed_by_operator": True},
        headers=INTERNAL,
    )
    assert resp.status_code == 409


# ------------------------------------------------------- rejected 必带理由


def test_rejected_requires_reason(client):
    did = demand_at(client, DemandStatus.evaluating)
    for bad in (None, "", "   "):
        resp = client.post(
            f"/internal/demands/{did}/transition",
            json={"target_status": "rejected", "reason": bad},
            headers=INTERNAL,
        )
        assert resp.status_code == 409, f"reason={bad!r} 不应被接受"
    assert get_detail(client, did)["status"] == "evaluating"

    d = transition(client, did, "rejected", reason="合规风险：涉个人敏感信息")
    assert d["rejection_reason"] == "合规风险：涉个人敏感信息"


# ------------------------------------------------------- 历史不可改


def test_history_is_append_only(client):
    did = demand_at(client, DemandStatus.quoted)
    snapshot = get_detail(client, did)["status_history"]

    # 后续合法迁移：只追加，前缀逐字节不变
    transition(client, did, "awaiting_confirm")
    after = get_detail(client, did)["status_history"]
    assert after[: len(snapshot)] == snapshot
    assert len(after) == len(snapshot) + 1

    # 非法迁移（409）：历史完全不动
    again = get_detail(client, did)["status_history"]
    resp = client.post(
        f"/internal/demands/{did}/transition",
        json={"target_status": "delivered"},
        headers=INTERNAL,
    )
    assert resp.status_code == 409
    assert get_detail(client, did)["status_history"] == again


# ------------------------------------------------------- 鉴权与企业隔离


def test_customer_scoping_and_auth(client):
    d_a = submit(client, customer="cust-001")
    submit(client, customer="cust-002")

    # 各自列表隔离，且带当前状态与时间线
    resp = client.get("/api/v1/demands", headers={"X-Customer-Id": "cust-001"})
    assert resp.status_code == 200
    items = resp.json()
    assert [i["id"] for i in items] == [d_a["id"]]
    assert items[0]["status"] == "submitted"
    assert items[0]["status_history"][0]["status"] == "submitted"

    # 他企详情一律 404（不泄露存在性）
    resp = client.get(
        f"/api/v1/demands/{d_a['id']}", headers={"X-Customer-Id": "cust-002"}
    )
    assert resp.status_code == 404

    # 缺客户头 → 401
    assert client.get("/api/v1/demands").status_code == 401
    assert client.get(f"/api/v1/demands/{d_a['id']}").status_code == 401

    # 内部端点：缺/错 token → 401
    for headers in ({}, {"X-Internal-Token": "wrong"}, INTERNAL | {"X-Internal-Token": "wrong"}):
        resp = client.post(
            f"/internal/demands/{d_a['id']}/transition",
            json={"target_status": "evaluating"},
            headers=headers,
        )
        assert resp.status_code == 401

    # 状态筛选（?status=）
    resp = client.get(
        "/api/v1/demands", params={"status": "evaluating"}, headers={"X-Customer-Id": "cust-001"}
    )
    assert resp.status_code == 200
    assert resp.json() == []


def test_evaluation_endpoint_rules(client):
    # submitted 下写评估 → 自动接单进入 evaluating
    d = submit(client)
    did = d["id"]
    d = evaluate(client, did, summary="存疑：源可达但历史口径需确认")
    assert d["status"] == "evaluating"

    # evaluating 下可更新概要
    d = evaluate(client, did, summary="可行（复核后）")
    assert get_detail(client, did)["evaluation_summary"] == "可行（复核后）"

    # quoted 之后不允许再写评估
    quote(client, did)
    resp = client.post(
        f"/internal/demands/{did}/evaluation",
        json={"summary": "再次评估"},
        headers=INTERNAL,
    )
    assert resp.status_code == 409


def test_daily_code_sequence(client):
    d1 = submit(client)
    d2 = submit(client)
    assert d1["code"] != d2["code"]
    day_seq = [int(c.rsplit("-", 1)[1]) for c in (d1["code"], d2["code"])]
    assert day_seq[1] == day_seq[0] + 1
