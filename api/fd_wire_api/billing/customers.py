"""客户开户：Customer 行 + sub2api 代建账户（幂等）。"""

from __future__ import annotations

import hashlib

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import Customer, CustomerStatus
from .plans import get_plan
from .sub2api import Sub2ApiClient


def _default_idempotency_key(name: str) -> str:
    """缺省幂等键：确定性派生（重试同键）且恒 ASCII（Idempotency-Key 是
    HTTP 头，中文名直接上头会被 httpx 以 UnicodeEncodeError 拒绝）。"""
    digest = hashlib.sha256(name.encode("utf-8")).hexdigest()[:32]
    return f"customer:{digest}"


def ensure_customer(
    session: Session,
    sub2api: Sub2ApiClient,
    *,
    name: str,
    plan_code: str,
    idempotency_key: str | None = None,
) -> tuple[Customer, bool]:
    """建客户（幂等）：已存在（同名同档）直接返回；否则 sub2api 建户后落库。

    sub2api 侧以 Idempotency-Key 幂等兜底：重试不会重复建支付账户。
    缺省键按客户名确定性派生且恒 ASCII（HTTP 头不接受非 ASCII；
    中文名走 sha256，重试仍同键）。
    """
    plan = get_plan(session, plan_code)
    existing = session.execute(
        select(Customer).where(Customer.name == name, Customer.plan_id == plan.id)
    ).scalar_one_or_none()
    if existing is not None:
        return existing, False

    key = idempotency_key or _default_idempotency_key(name)
    user = sub2api.create_user(name=name, idempotency_key=key, plan_code=plan.code)

    # 同键并发重试：对手可能已插入同 sub2api_user_id 的行
    dup = session.execute(
        select(Customer).where(Customer.sub2api_user_id == user.id)
    ).scalar_one_or_none()
    if dup is not None:
        return dup, False

    customer = Customer(
        name=name,
        sub2api_user_id=user.id,
        plan_id=plan.id,
        status=CustomerStatus.ACTIVE.value,
    )
    try:
        with session.begin_nested():
            session.add(customer)
            session.flush()
    except IntegrityError:
        existing = session.execute(
            select(Customer).where(Customer.name == name, Customer.plan_id == plan.id)
        ).scalar_one_or_none()
        if existing is None:
            raise
        return existing, False
    return customer, True
