"""AI 预评估与人工报价流测试（wire-platform-v1 任务 6.4）。

覆盖：
- 触发机制两条路：transition 到 evaluating 自动跑 / 独立触发端点 /evaluate
- LLM mock 三种 verdict（feasible/doubtful/infeasible）→ 中文映射概要 + 内部全文
- LLM 失败（网关异常 / 输出非 JSON / verdict 不合法）→ doubtful + 「AI 评估
  不可用，转人工评估」如实注明，绝不编造
- 合规初筛：法律域数据 → compliance_flags 含 legal-domain-review（LLM 漏标也补）
- 报价确认台增强：confirmed_by_operator 与 operator 缺一 409；amount_micro/
  valid_until 落库；quote_history append-only
- 客户视图：评估只给概要、报价只给金额/说明/有效期；evaluation_detail/
  quote_operator/quote_history/quote_amount_micro 绝不出现在客户响应
- 一条完整流：提交→transition evaluating→评估自动产出→人工确认报价→quoted
"""

from __future__ import annotations

import json
import os

# 在导入 app 前把默认引擎指向内存库（与 test_demands_statemachine 同款纪律）。
os.environ.setdefault("FD_WIRE_DATABASE_URL", "sqlite://")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from fd_wire_api.app import app
from fd_wire_api.demands import evaluation as evaluation_module
from fd_wire_api.demands import get_db
from fd_wire_api.demands.db import Base

INTERNAL_TOKEN = "wire-internal-dev"
INTERNAL = {"X-Internal-Token": INTERNAL_TOKEN}
from console_fixture import bearer, install_fake_jwks, make_console_env, mint_id_token

SUB_CUST = "sub-cust-001"
CUST = bearer(mint_id_token(SUB_CUST))

#: 客户响应绝不应携带的内部字段（任务 6.4 客户/内部视图分工）。
FORBIDDEN_CUSTOMER_KEYS = {
    "evaluation_detail",
    "quote_operator",
    "quote_history",
    "quote_amount_micro",
    "operator",
}

FEASIBLE_JSON = json.dumps(
    {
        "verdict": "feasible",
        "confidence": 0.85,
        "reasons": ["统计公报与行业协会月报可覆盖", "更新频率 monthly 可满足"],
        "data_source_hints": ["国家统计局", "中国汽车工业协会"],
        "compliance_flags": [],
    },
    ensure_ascii=False,
)

DOUBTFUL_JSON = json.dumps(
    {
        "verdict": "doubtful",
        "confidence": 0.4,
        "reasons": ["源可达但历史口径需确认"],
        "data_source_hints": ["统计局月度公报"],
        "compliance_flags": [],
    },
    ensure_ascii=False,
)

INFEASIBLE_JSON = json.dumps(
    {
        "verdict": "infeasible",
        "confidence": 0.9,
        "reasons": ["无公开源且涉个人敏感信息"],
        "data_source_hints": [],
        "compliance_flags": ["personal-privacy"],
    },
    ensure_ascii=False,
)


class FakeLlm:
    """内存假 LLM：满足 ai.protocols.LlmClient 协议，绝不打真网。"""

    def __init__(self, *, content: str | None = None, error: Exception | None = None):
        self.content = content
        self.error = error
        self.calls: list[tuple[list[dict], list[dict]]] = []

    def complete(self, messages, tools):
        self.calls.append((messages, tools))
        if self.error is not None:
            raise self.error
        from fd_wire_api.ai.protocols import LlmAssistantMessage

        return LlmAssistantMessage(content=self.content)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """每个用例独立的内存库 + 覆盖 get_db 的 TestClient（外加平台库身份种子）。"""
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
    install_fake_jwks(monkeypatch)
    make_console_env(tmp_path, monkeypatch, customers=[(SUB_CUST, "cust-001")])
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _isolated_llm_factory():
    """每用例前后清空 LLM 出口注入，避免全局工厂跨用例泄漏。"""
    evaluation_module.reset_llm_client_factory()
    yield
    evaluation_module.reset_llm_client_factory()


def use_llm(fake: FakeLlm) -> FakeLlm:
    evaluation_module.set_llm_client_factory(lambda: fake)
    return fake


# ------------------------------------------------------------------ helpers


def submit(client, **overrides) -> dict:
    payload = {
        "title": "上海汽车销量月度数据",
        "intent": "需要上海市 2024 年以来乘用车月度销量与价格带分布，用于市场分析",
        "entities_hint": {"region": "上海市", "industry": "汽车"},
        "frequency_expect": "monthly",
        "linked_indicators": [],
    }
    payload.update(overrides)
    resp = client.post("/api/v1/demands", json=payload, headers=CUST)
    assert resp.status_code == 201, resp.text
    return resp.json()


def customer_detail(client, demand_id: int) -> dict:
    resp = client.get(f"/api/v1/demands/{demand_id}", headers=CUST)
    assert resp.status_code == 200, resp.text
    return resp.json()


def internal_detail(client, demand_id: int) -> dict:
    resp = client.get(f"/internal/demands/{demand_id}", headers=INTERNAL)
    assert resp.status_code == 200, resp.text
    return resp.json()


def trigger_evaluate(client, demand_id: int) -> dict:
    resp = client.post(f"/internal/demands/{demand_id}/evaluate", headers=INTERNAL)
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


def post_quote(client, demand_id: int, payload: dict):
    return client.post(
        f"/internal/demands/{demand_id}/quote", json=payload, headers=INTERNAL
    )


def at_evaluating(client, *, llm_content: str | None = FEASIBLE_JSON) -> int:
    """提交 → transition evaluating（自动评估）→ 返回 demand id。"""
    use_llm(FakeLlm(content=llm_content))
    did = submit(client)["id"]
    transition(client, did, "evaluating", by="system", note="后台接单")
    return did


# ------------------------------------------------------- 触发机制（两条路）


def test_auto_evaluation_runs_on_transition_to_evaluating(client):
    fake = use_llm(FakeLlm(content=FEASIBLE_JSON))
    did = submit(client)["id"]

    d = transition(client, did, "evaluating", by="system", note="后台接单")
    assert d["status"] == "evaluating"

    # LLM 被真实调用（system 含结构契约，user 含需求原文）
    assert len(fake.calls) == 1
    messages, tools = fake.calls[0]
    assert messages[0]["role"] == "system"
    assert "verdict" in messages[0]["content"]
    assert "乘用车月度销量" in messages[1]["content"]
    assert tools == []

    # 评估自动产出：客户概要 + 内部全文
    detail = internal_detail(client, did)
    assert detail["evaluation_summary"].startswith("可行：")
    assert detail["evaluation_detail"]["verdict"] == "feasible"
    assert detail["evaluation_detail"]["confidence"] == 0.85
    assert detail["evaluation_detail"]["reasons"]
    assert detail["evaluation_detail"]["data_source_hints"] == ["国家统计局", "中国汽车工业协会"]
    assert detail["evaluation_detail"]["evaluated_by"] == "ai"
    assert detail["evaluation_detail"]["llm_available"] is True


def test_independent_trigger_endpoint_from_submitted(client):
    """独立触发端点：submitted 下自动接单进 evaluating 并产出评估。"""
    use_llm(FakeLlm(content=DOUBTFUL_JSON))
    did = submit(client)["id"]
    d = trigger_evaluate(client, did)
    assert d["status"] == "evaluating"
    assert d["evaluation_summary"].startswith("存疑：")
    assert d["evaluation_detail"]["verdict"] == "doubtful"

    # 重跑（evaluating 下）可更新结论
    use_llm(FakeLlm(content=FEASIBLE_JSON))
    d = trigger_evaluate(client, did)
    assert d["evaluation_detail"]["verdict"] == "feasible"
    assert customer_detail(client, did)["evaluation_summary"].startswith("可行：")


def test_independent_trigger_rejects_post_quote_state(client):
    did = at_evaluating(client)
    resp = post_quote(
        client,
        did,
        {
            "amount_micro": 1_200_000_000,
            "confirmed_by_operator": True,
            "operator": "op-007",
        },
    )
    assert resp.status_code == 200
    resp = client.post(f"/internal/demands/{did}/evaluate", headers=INTERNAL)
    assert resp.status_code == 409


# ------------------------------------------------------- 三种 verdict 映射


@pytest.mark.parametrize(
    ("payload", "label", "verdict"),
    [
        (FEASIBLE_JSON, "可行", "feasible"),
        (DOUBTFUL_JSON, "存疑", "doubtful"),
        (INFEASIBLE_JSON, "不可行", "infeasible"),
    ],
)
def test_three_verdicts_map_to_customer_summary(client, payload, label, verdict):
    use_llm(FakeLlm(content=payload))
    did = submit(client)["id"]
    d = trigger_evaluate(client, did)
    assert d["evaluation_summary"].startswith(f"{label}：")
    assert d["evaluation_detail"]["verdict"] == verdict
    # 概要=verdict 中文映射+一句话（取首条 reason，截掉句读后加句号）
    assert label in d["evaluation_summary"]
    customer = customer_detail(client, did)
    assert customer["evaluation_summary"] == d["evaluation_summary"]


def test_llm_json_inside_code_fence_is_parsed(client):
    fenced = f"评估如下：\n```json\n{FEASIBLE_JSON}\n```\n以上。"
    use_llm(FakeLlm(content=fenced))
    did = submit(client)["id"]
    d = trigger_evaluate(client, did)
    assert d["evaluation_detail"]["verdict"] == "feasible"


# ------------------------------------------------------- LLM 失败 → 兜底


@pytest.mark.parametrize(
    "fake",
    [
        FakeLlm(error=RuntimeError("token 网关不可达: connect timeout")),
        FakeLlm(content="这个需求看起来还行吧"),
        FakeLlm(content=json.dumps({"verdict": "maybe", "confidence": 0.5})),
        FakeLlm(content=None),
    ],
    ids=["gateway-error", "non-json", "invalid-verdict", "empty-content"],
)
def test_llm_failure_falls_back_to_doubtful_with_honest_note(client, fake):
    use_llm(fake)
    did = submit(client)["id"]
    d = trigger_evaluate(client, did)

    # 状态照常推进（评估不阻塞接单），结论如实存疑转人工
    assert d["status"] == "evaluating"
    assert d["evaluation_detail"]["verdict"] == "doubtful"
    assert d["evaluation_detail"]["evaluated_by"] == "ai-fallback"
    assert d["evaluation_detail"]["llm_available"] in (True, False)
    assert d["evaluation_detail"]["unavailable_reason"]
    assert "AI 评估不可用" in d["evaluation_summary"]
    assert "人工评估" in d["evaluation_summary"]
    # 客户概要与内部 reasons 口径一致，绝不出现编造的可行/不可行结论
    assert not d["evaluation_summary"].startswith("可行")
    assert not d["evaluation_summary"].startswith("不可行")


def test_unconfigured_llm_outlet_falls_back_without_network(client):
    """未注入且未配置 TOKEN_GATEWAY_KEY：评估走兜底，不打真网。"""
    did = submit(client)["id"]
    d = trigger_evaluate(client, did)
    assert d["evaluation_detail"]["verdict"] == "doubtful"
    assert "token 网关未配置" in d["evaluation_detail"]["unavailable_reason"]


# ------------------------------------------------------- 合规初筛（法律域）


def test_legal_domain_intent_gets_review_flag(client):
    """法律域需求：LLM 漏标时本地初筛也必须补上 legal-domain-review。"""
    use_llm(FakeLlm(content=FEASIBLE_JSON))  # 模型未报任何合规 flag
    did = submit(
        client,
        title="涉诉企业名单",
        intent="需要全国企业裁判文书与诉讼记录，按被告企业聚合",
        entities_hint={"domain": "司法"},
    )["id"]
    d = trigger_evaluate(client, did)
    assert evaluation_module.LEGAL_DOMAIN_REVIEW_FLAG in d["evaluation_detail"]["compliance_flags"]

    # LLM 不可用时初筛同样生效（本地关键词层独立执行）
    evaluation_module.reset_llm_client_factory()
    d = trigger_evaluate(client, did)
    assert d["evaluation_detail"]["verdict"] == "doubtful"
    assert evaluation_module.LEGAL_DOMAIN_REVIEW_FLAG in d["evaluation_detail"]["compliance_flags"]


def test_non_legal_domain_no_flag(client):
    use_llm(FakeLlm(content=FEASIBLE_JSON))
    did = submit(client)["id"]
    d = trigger_evaluate(client, did)
    assert evaluation_module.LEGAL_DOMAIN_REVIEW_FLAG not in d["evaluation_detail"]["compliance_flags"]


# ------------------------------------------------------- 报价确认台增强


def test_quote_requires_both_confirmation_and_operator(client):
    did = at_evaluating(client)
    base = {"amount_micro": 900_000_000, "note": "首年订阅价"}

    # 缺 operator → 409，不落任何报价字段
    resp = post_quote(client, did, base | {"confirmed_by_operator": True})
    assert resp.status_code == 409
    detail = internal_detail(client, did)
    assert detail["status"] == "evaluating"
    assert detail["quote_amount"] is None
    assert detail["quote_operator"] is None
    assert detail["quote_history"] == []

    # 缺确认标志（operator 在）→ 409
    resp = post_quote(client, did, base | {"operator": "op-007"})
    assert resp.status_code == 409
    assert internal_detail(client, did)["quote_history"] == []

    # 两者齐备 → 200，进 quoted
    resp = post_quote(
        client, did, base | {"confirmed_by_operator": True, "operator": "op-007"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "quoted"


def test_quote_without_any_amount_is_rejected(client):
    did = at_evaluating(client)
    resp = post_quote(
        client, did, {"confirmed_by_operator": True, "operator": "op-007"}
    )
    assert resp.status_code == 409
    assert "金额" in resp.json()["detail"]


def test_quote_persists_micro_amount_validity_and_history(client):
    did = at_evaluating(client)
    resp = post_quote(
        client,
        did,
        {
            "amount_micro": 1_200_000_000,
            "note": "首年订阅价",
            "valid_until": "2030-01-01T00:00:00Z",
            "confirmed_by_operator": True,
            "operator": "op-007",
        },
    )
    assert resp.status_code == 200, resp.text
    detail = internal_detail(client, did)

    assert detail["status"] == "quoted"
    assert detail["quote_amount_micro"] == 1_200_000_000
    assert detail["quote_operator"] == "op-007"
    assert detail["quote_amount"] is not None  # 元展示值同步落库
    assert detail["quote_valid_until"].startswith("2030-01-01")

    # 报价历史 append-only：一条完整留档
    assert len(detail["quote_history"]) == 1
    entry = detail["quote_history"][0]
    assert entry["operator"] == "op-007"
    assert entry["amount_micro"] == 1_200_000_000
    assert entry["note"] == "首年订阅价"
    assert entry["valid_until"] and entry["valid_until"].startswith("2030-01-01")
    assert entry["at"]


def test_legacy_amount_payload_still_accepted(client):
    """旧调用以元计价（amount）——自动换算微元，行为不回退。"""
    did = at_evaluating(client)
    resp = post_quote(
        client,
        did,
        {"amount": "800.00", "confirmed_by_operator": True, "operator": "op-001"},
    )
    assert resp.status_code == 200, resp.text
    detail = internal_detail(client, did)
    assert detail["quote_amount_micro"] == 800_000_000
    assert detail["status"] == "quoted"


def test_quote_history_survives_later_transitions_append_only(client):
    did = at_evaluating(client)
    post_quote(
        client,
        did,
        {"amount_micro": 500_000_000, "confirmed_by_operator": True, "operator": "op-007"},
    )
    snapshot = internal_detail(client, did)["quote_history"]

    # 后续推进（quoted→awaiting_confirm→building）与 409 尝试都不改写历史
    transition(client, did, "awaiting_confirm", by="operator:op-007", note="报价已发出")
    resp = client.post(
        f"/internal/demands/{did}/quote",
        json={"amount_micro": 1, "confirmed_by_operator": True, "operator": "op-007"},
        headers=INTERNAL,
    )
    assert resp.status_code == 409
    transition(client, did, "building", by="customer:cust-001", note="客户确认报价")

    after = internal_detail(client, did)["quote_history"]
    assert after == snapshot


# ------------------------------------------------------- 客户视图字段分工


def test_customer_view_hides_internal_fields_at_every_stage(client):
    use_llm(FakeLlm(content=FEASIBLE_JSON))
    did = submit(client)["id"]

    # submitted：无评估无报价
    body = customer_detail(client, did)
    assert not (set(body) & FORBIDDEN_CUSTOMER_KEYS)

    # evaluating：有概要、无内部全文
    transition(client, did, "evaluating", by="system", note="后台接单")
    body = customer_detail(client, did)
    assert body["evaluation_summary"].startswith("可行：")
    assert not (set(body) & FORBIDDEN_CUSTOMER_KEYS)

    # quoted / awaiting_confirm：有金额+有效期，无 operator 留档
    post_quote(
        client,
        did,
        {
            "amount_micro": 1_200_000_000,
            "note": "首年订阅价",
            "valid_until": "2030-01-01T00:00:00Z",
            "confirmed_by_operator": True,
            "operator": "op-007",
        },
    )
    for _ in range(2):
        body = customer_detail(client, did)
        assert body["status"] in ("quoted", "awaiting_confirm")
        assert body["quote_amount"] is not None
        assert body["quote_valid_until"] and body["quote_valid_until"].startswith("2030-01-01")
        assert body["quote_note"] == "首年订阅价"
        assert not (set(body) & FORBIDDEN_CUSTOMER_KEYS)
        if body["status"] == "quoted":
            transition(client, did, "awaiting_confirm", by="operator:op-007", note="报价已发出")

    # 逐字段断言：内部字段名绝不出现在客户响应 JSON 原文里
    raw = client.get(f"/api/v1/demands/{did}", headers=CUST).text
    for key in ("evaluation_detail", "quote_operator", "quote_history", "amount_micro"):
        assert key not in raw


# ------------------------------------------------------- 一条完整流（验收）


def test_full_flow_submit_evaluate_quote_customer_view(client):
    """提交→transition evaluating→评估自动产出→人工确认报价→quoted→客户视图。"""
    use_llm(FakeLlm(content=FEASIBLE_JSON))

    # 1. 客户提交
    d = submit(client)
    did = d["id"]
    assert d["status"] == "submitted"

    # 2. 迁移 evaluating：AI 预评估自动产出
    d = transition(client, did, "evaluating", by="system", note="后台接单")
    assert d["status"] == "evaluating"
    assert d["evaluation_summary"].startswith("可行：")
    assert d["evaluation_detail"]["verdict"] == "feasible"

    # 3. 人工报价确认（确认台）：缺 operator 被 409 拦下后补齐
    resp = post_quote(
        client, did, {"amount_micro": 1_200_000_000, "confirmed_by_operator": True}
    )
    assert resp.status_code == 409
    resp = post_quote(
        client,
        did,
        {
            "amount_micro": 1_200_000_000,
            "note": "首年订阅价",
            "valid_until": "2030-06-30T00:00:00Z",
            "confirmed_by_operator": True,
            "operator": "op-007",
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "quoted"

    # 4. 客户视图字段断言：概要+金额+有效期在，内部留档不在
    body = customer_detail(client, did)
    assert body["status"] == "quoted"
    assert body["evaluation_summary"].startswith("可行：")
    assert body["quote_amount"] is not None
    assert body["quote_valid_until"].startswith("2030-06-30")
    assert not (set(body) & FORBIDDEN_CUSTOMER_KEYS)

    # 时间线完整可追溯（客户全程可见）
    assert [e["status"] for e in body["status_history"]] == ["submitted", "evaluating", "quoted"]


# ------------------------------------------------------- 内部视图鉴权


def test_internal_endpoints_require_token(client):
    did = at_evaluating(client)
    # 缺 token：内部视图 401、评估触发 401
    assert client.get(f"/internal/demands/{did}").status_code == 401
    assert client.post(f"/internal/demands/{did}/evaluate").status_code == 401
    # 不存在的需求单一律 404
    assert client.get("/internal/demands/99999", headers=INTERNAL).status_code == 404
    assert (
        client.post("/internal/demands/99999/evaluate", headers=INTERNAL).status_code == 404
    )
