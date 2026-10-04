"""sub2api admin 客户端：全 mock 覆盖（建户/读取/幂等调额/探针/错误面）。"""

from __future__ import annotations

import json

import httpx
import pytest

from fd_wire_api.billing.sub2api import (
    Sub2ApiClient,
    Sub2ApiError,
    Sub2ApiUnavailable,
    parse_user,
)

from test_billing_common import FakeSub2Api


def make_client(fake: FakeSub2Api) -> Sub2ApiClient:
    return fake.client()


def test_create_user_sends_idempotency_key_and_bearer() -> None:
    fake = FakeSub2Api()
    with make_client(fake) as client:
        user = client.create_user(name="壹座集团", idempotency_key="cust-1")
    assert user.id.startswith("su-") and user.name == "壹座集团"
    call = fake.calls[0]
    assert call["op"] == "POST" and call["url"].endswith("/admin/api/users")
    assert call["idem"] == "cust-1"
    # Bearer admin key 已随行
    assert json.loads(call["body"]) == {"name": "壹座集团", "plan": None}


def test_create_user_server_side_idempotent() -> None:
    fake = FakeSub2Api()
    with make_client(fake) as client:
        u1 = client.create_user(name="A", idempotency_key="same-key")
        u2 = client.create_user(name="A", idempotency_key="same-key")
    assert u1.id == u2.id
    assert len(fake.users) == 1  # 服务端按 Idempotency-Key 去重


def test_read_user_parses_flat_and_wrapped_payloads() -> None:
    assert parse_user({"id": "u1", "name": "n", "balance_micro": -390_000_000}).balance_micro == -390_000_000
    # 兼容元单位（balance=12.5 元）
    assert parse_user({"user": {"id": "u1", "name": "n", "balance": "12.5"}}).balance_micro == 12_500_000
    assert parse_user({"user": {"id": 7, "balance_micro": 0}}).id == "7"


def test_adjust_balance_applies_once_per_idempotency_key() -> None:
    fake = FakeSub2Api()
    fake.add_user("u1", balance_micro=1_000_000)
    with make_client(fake) as client:
        after1 = client.adjust_balance(user_id="u1", amount_micro=-400_000,
                                       idempotency_key="settle-1")
        after2 = client.adjust_balance(user_id="u1", amount_micro=-400_000,
                                       idempotency_key="settle-1")
    assert after1.balance_micro == after2.balance_micro == 600_000  # 只扣一次
    assert fake.balance("u1") == 600_000
    adjust_calls = [c for c in fake.calls if "balance-adjustments" in c["url"]]
    assert all(c["idem"] == "settle-1" for c in adjust_calls)
    assert json.loads(adjust_calls[0]["body"]) == {"amount_micro": -400_000}


def test_adjust_balance_requires_idempotency_key() -> None:
    fake = FakeSub2Api()
    fake.add_user("u1")
    with make_client(fake) as client:
        with pytest.raises(ValueError):
            client.adjust_balance(user_id="u1", amount_micro=-1, idempotency_key="")
        with pytest.raises(ValueError):
            client.create_user(name="x", idempotency_key="")


def test_probe_sufficient_and_insufficient() -> None:
    fake = FakeSub2Api()
    fake.add_user("u1", balance_micro=100)
    with make_client(fake) as client:
        ok = client.probe("u1", min_balance_micro=50)
        low = client.probe("u1", min_balance_micro=200)
    assert ok.reachable and ok.sufficient
    assert low.reachable and not low.sufficient


def test_probe_fail_closed_on_unreachable_and_missing_user() -> None:
    fake = FakeSub2Api()
    fake.fail_reads_left = 5  # 503 → 不可用
    with make_client(fake) as client:
        down = client.probe("u1")
    assert not down.reachable and not down.sufficient and down.error

    with make_client(FakeSub2Api()) as client:  # 404 → fail-closed
        missing = client.probe("ghost")
    assert not missing.reachable and not missing.sufficient


def test_probe_fail_closed_on_transport_error() -> None:
    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    client = Sub2ApiClient(
        base_url="http://sub2api.test",
        admin_key="k",
        http_client=httpx.Client(transport=httpx.MockTransport(broken)),
    )
    result = client.probe("u1")
    assert not result.reachable and not result.sufficient


def test_error_surfaces() -> None:
    fake = FakeSub2Api()
    fake.fail_adjust_left = 2
    fake.add_user("u1")
    with make_client(fake) as client:
        with pytest.raises(Sub2ApiUnavailable):  # 5xx → 计费面不可用语义
            client.adjust_balance(user_id="u1", amount_micro=-1, idempotency_key="k")
        with pytest.raises(Sub2ApiError) as missing:  # 4xx → 业务错误
            client.read_user("ghost")
        assert missing.value.status_code == 404


def test_bad_payload_surfaces() -> None:
    with pytest.raises(Sub2ApiError):
        parse_user({"name": "no-id"})
    with pytest.raises(Sub2ApiError):
        parse_user({"id": "u", "balance": "not-a-number"})


def test_non_json_response_raises() -> None:
    client = Sub2ApiClient(
        base_url="http://sub2api.test",
        admin_key="k",
        http_client=httpx.Client(
            transport=httpx.MockTransport(lambda r: httpx.Response(200, text="<html>"))
        ),
    )
    with pytest.raises(Sub2ApiError):
        client.read_user("u1")


def test_ensure_customer_end_to_end_with_mock_http() -> None:
    from sqlalchemy.orm import Session

    from fd_wire_api.billing import ensure_customer
    from test_billing_common import make_engine

    engine = make_engine()
    fake = FakeSub2Api()
    with Session(engine) as session, make_client(fake) as client:
        customer, created = ensure_customer(
            session, client, name="萬星数据", plan_code="professional",
            idempotency_key="cust-wx",
        )
        session.commit()
        assert created and customer.status == "active"
        assert customer.sub2api_user_id in fake.users
        assert customer.plan.code == "professional"

        again, created2 = ensure_customer(
            session, client, name="萬星数据", plan_code="professional",
            idempotency_key="cust-wx",
        )
        session.commit()
        assert not created2 and again.id == customer.id
        assert len(fake.users) == 1  # 重试未重复建支付账户

        with pytest.raises(ValueError):
            ensure_customer(session, client, name="X", plan_code="platinum")
