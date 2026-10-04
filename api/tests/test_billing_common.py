"""计费测试共享设施（非 conftest，避免与并行代理争 tests/conftest.py）。

FakeSub2Api 用 httpx.MockTransport 承载，并模拟服务端 Idempotency-Key
幂等缓存——「同批次重放只扣一次」的净效果直接在其余额上可断言。
"""

from __future__ import annotations

import hashlib
import json

import httpx
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from fd_wire_api.billing import METERING_RECORDS_DDL, Base, Customer, seed_plans
from fd_wire_api.billing.sub2api import Sub2ApiClient

BASE = "http://sub2api.test"


def make_engine():
    """内存库：billing_* 表 + 临时 metering_records 表（耦合契约模拟）。"""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as sess:
        seed_plans(sess)
        sess.commit()
    with engine.begin() as conn:
        conn.execute(text(METERING_RECORDS_DDL))
    return engine


def add_customer(session: Session, *, name: str, plan_id: int,
                 sub2api_user_id: str, status: str = "active") -> Customer:
    customer = Customer(
        name=name, plan_id=plan_id, sub2api_user_id=sub2api_user_id, status=status
    )
    session.add(customer)
    session.flush()
    return customer


def insert_metering(engine, *, customer_ref: str, ts: str, rows: int,
                    track: str = "customer", request_id: str | None = None) -> None:
    """往临时 metering_records 表塞一行（列结构与 metering 侧 alembic 0001 对齐）。"""
    stmt = (
        "INSERT INTO metering_records "
        "(event_timestamp, request_id, caller, credential_track, server_name, "
        " rows_returned, source) "
        "VALUES (:ts, :rid, :caller, :track, 'business-mcp', :rows, 'customer')"
    )
    params = {
        "ts": ts,
        "rid": request_id or f"req-{customer_ref}-{ts}-{rows}-{track}",
        "caller": customer_ref,
        "track": track,
        "rows": rows,
    }
    with engine.begin() as c:
        c.execute(text(stmt), params)


class FakeSub2Api:
    """sub2api admin 面的内存假件：记账真实余额 + Idempotency-Key 去重。"""

    def __init__(self) -> None:
        self.users: dict[str, dict] = {}
        self.calls: list[dict] = []
        self.idem_cache: dict[str, dict] = {}
        self.fail_adjust_left = 0   # 接下来 N 次 adjust 返回 503
        self.fail_reads_left = 0    # 接下来 N 次 GET 返回 503

    # -- 数据准备 -----------------------------------------------------------

    def add_user(self, user_id: str, *, name: str = "user",
                 balance_micro: int = 0) -> str:
        self.users[user_id] = {"name": name, "balance_micro": balance_micro}
        return user_id

    @property
    def adjust_calls(self) -> list[dict]:
        return [
            c for c in self.calls
            if c["op"] == "POST" and "balance-adjustments" in c["url"]
        ]

    def balance(self, user_id: str) -> int:
        return self.users[user_id]["balance_micro"]

    # -- HTTP 面 ------------------------------------------------------------

    def handler(self, request: httpx.Request) -> httpx.Response:
        op, url = request.method, str(request.url)
        idem = request.headers.get("Idempotency-Key")
        self.calls.append({"op": op, "url": url, "idem": idem,
                           "body": request.content.decode() if request.content else None})
        if op == "GET" and "/admin/api/users/" in url:
            if self.fail_reads_left > 0:
                self.fail_reads_left -= 1
                return httpx.Response(503, text="billing plane down")
            user_id = url.rstrip("/").rsplit("/", 1)[-1]
            user = self.users.get(user_id)
            if user is None:
                return httpx.Response(404, json={"error": "no such user"})
            return httpx.Response(200, json={"id": user_id, **user})
        if op == "POST" and url.endswith("/admin/api/users"):
            if idem and idem in self.idem_cache:
                return httpx.Response(200, json=self.idem_cache[idem])
            body = json.loads(request.content or b"{}")
            digest = hashlib.sha1((idem or body.get("name", "?")).encode()).hexdigest()[:8]
            user_id = f"su-{digest}"
            self.users[user_id] = {"name": body.get("name", ""), "balance_micro": 0}
            payload = {"id": user_id, **self.users[user_id]}
            if idem:
                self.idem_cache[idem] = payload
            return httpx.Response(201, json=payload)
        if op == "POST" and "/balance-adjustments" in url:
            if self.fail_adjust_left > 0:
                self.fail_adjust_left -= 1
                return httpx.Response(503, text="adjust boom")
            user_id = url.rstrip("/").rsplit("/users/", 1)[-1].split("/")[0]
            if idem and idem in self.idem_cache:
                return httpx.Response(200, json=self.idem_cache[idem])
            user = self.users.get(user_id)
            if user is None:
                return httpx.Response(404, json={"error": "no such user"})
            body = json.loads(request.content or b"{}")
            user["balance_micro"] += int(body["amount_micro"])
            payload = {"id": user_id, **user}
            if idem:
                self.idem_cache[idem] = payload
            return httpx.Response(200, json=payload)
        return httpx.Response(404, json={"error": f"unmatched {op} {url}"})

    def client(self) -> Sub2ApiClient:
        return Sub2ApiClient(
            base_url=BASE,
            admin_key="test-admin-key",
            http_client=httpx.Client(transport=httpx.MockTransport(self.handler)),
        )


@pytest.fixture()
def engine():
    return make_engine()


@pytest.fixture()
def fake_sub2api() -> FakeSub2Api:
    return FakeSub2Api()
