"""模型与档位种子：三档裁决值、幂等 seed、唯一约束、period 校验。"""

from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from fd_wire_api.billing import (
    Base,
    LedgerEntry,
    NoticeRecord,
    PLAN_CODES,
    Plan,
    micro_to_yuan,
    seed_plans,
    validate_period,
    yuan_to_micro,
)

from test_billing_common import make_engine


def test_plan_seeds_adjudicated_values() -> None:
    engine = make_engine()
    with Session(engine) as session:
        plans = seed_plans(session)
        session.commit()
        starter = plans["starter"]
        assert (micro_to_yuan(starter.monthly_price_micro), starter.included_lines,
                micro_to_yuan(starter.overage_unit_price_micro)) == (1999.00, 500_000, 0.00)
        assert yuan_to_micro("0.004") == starter.overage_unit_price_micro == 4_000
        prof = plans["professional"]
        assert (micro_to_yuan(prof.monthly_price_micro), prof.included_lines,
                prof.overage_unit_price_micro) == (6999.00, 3_000_000, 3_000)
        ent = plans["enterprise"]
        assert (micro_to_yuan(ent.monthly_price_micro), ent.included_lines,
                ent.overage_unit_price_micro) == (19999.00, 12_000_000, 2_000)
        assert PLAN_CODES == ("starter", "professional", "enterprise")


def test_seed_plans_idempotent_and_preserves_admin_override() -> None:
    engine = make_engine()
    with Session(engine) as session:
        seed_plans(session)
        session.commit()
    # 后台改价（可配置不发版）
    with Session(engine) as session:
        starter = session.query(Plan).filter_by(code="starter").one()
        starter.monthly_price_micro = yuan_to_micro("1799")
        session.commit()
    # 重播种：不覆盖后台改动，也不重复插入
    with Session(engine) as session:
        seed_plans(session)
        session.commit()
        assert session.query(Plan).count() == 3
        starter = session.query(Plan).filter_by(code="starter").one()
        assert starter.monthly_price_micro == yuan_to_micro("1799")


def test_ledger_idempotency_key_unique_at_db_level() -> None:
    engine = make_engine()
    with Session(engine) as session:
        session.add(LedgerEntry(customer_id=1, kind="grant", period="2026-09",
                                idempotency_key="k1"))
        session.flush()
        session.add(LedgerEntry(customer_id=1, kind="grant", period="2026-09",
                                idempotency_key="k1"))
        with pytest.raises(IntegrityError):
            session.flush()


def test_notice_unique_once_per_tier() -> None:
    engine = make_engine()
    with Session(engine) as session:
        session.add(NoticeRecord(customer_id=1, period="2026-09",
                                 threshold_pct=80))
        session.flush()
        # 撞唯一约束：包 SAVEPOINT，外层事务继续
        with pytest.raises(IntegrityError):
            with session.begin_nested():
                session.add(NoticeRecord(customer_id=1, period="2026-09",
                                         threshold_pct=80))
        # 同周期另一档位可再发
        session.add(NoticeRecord(customer_id=1, period="2026-09",
                                 threshold_pct=95))
        session.flush()


@pytest.mark.parametrize("bad", ["2026-1", "2026-13", "202609", "2026-00", "", None, 202609])
def test_validate_period_rejects(bad) -> None:
    with pytest.raises(ValueError):
        validate_period(bad)


def test_validate_period_accepts() -> None:
    assert validate_period("2026-09") == "2026-09"
    assert validate_period("2026-12") == "2026-12"


def test_billing_tables_created_and_metering_kept_separate() -> None:
    engine = make_engine()
    tables = set(Base.metadata.tables)
    assert {"billing_plans", "billing_customers", "billing_ledger_entries",
            "billing_notices"} <= tables
    assert "metering_records" not in tables  # 归 metering 模块，billing 不建
