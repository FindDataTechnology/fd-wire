"""计费域（wire-billing）：账本权威 + sub2api 幂等结算 + 对账 + 两档预警。

入口一览：
- 建表/播种：`init_billing(engine)`（create_all + seed_plans；alembic 链
  由主代理收敛，落地前以此起步）
- 开户：`ensure_customer(session, sub2api, name=..., plan_code=...)`
- 结算：`SettlementService(session, sub2api, metering).settle(period, batch_ref)`
- 对账：`reconcile(session, sub2api, opening_balances=...)`
- 预警：`evaluate_usage_warnings(session, customer=..., ...)`（settle 内已自动调）
"""

from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from .customers import ensure_customer
from .ledger import Ledger, RecordResult
from .metering_source import (
    METERING_RECORDS_DDL,
    MeteringSource,
    MeteringUsage,
    SqlMeteringSource,
    StaticMeteringSource,
)
from .models import (
    NOTICE_CHANNELS,
    Base,
    Customer,
    CustomerStatus,
    LedgerEntry,
    LedgerKind,
    NoticeKind,
    NoticeRecord,
    Plan,
    SUB2API_APPLIED_KINDS,
    validate_period,
)
from .money import MICRO_PER_YUAN, micro_to_yuan, micro_to_yuan_str, yuan_to_micro
from .notices import USAGE_WARNING_TIERS, evaluate_usage_warnings
from .plans import PLAN_CODES, SEEDS, PlanSeed, get_plan, seed_plans
from .reconcile import ReconcileReport, ReconcileRow, reconcile
from .settle import SettlementReport, SettlementService, default_resolver
from .sub2api import (
    ProbeResult,
    Sub2ApiClient,
    Sub2ApiError,
    Sub2ApiUnavailable,
    Sub2User,
)

__all__ = [
    "METERING_RECORDS_DDL",
    "MICRO_PER_YUAN",
    "NOTICE_CHANNELS",
    "PLAN_CODES",
    "SEEDS",
    "SUB2API_APPLIED_KINDS",
    "USAGE_WARNING_TIERS",
    "Base",
    "Customer",
    "CustomerStatus",
    "Ledger",
    "LedgerEntry",
    "LedgerKind",
    "MeteringSource",
    "MeteringUsage",
    "NoticeKind",
    "NoticeRecord",
    "Plan",
    "PlanSeed",
    "ProbeResult",
    "RecordResult",
    "ReconcileReport",
    "ReconcileRow",
    "SettlementReport",
    "SettlementService",
    "SqlMeteringSource",
    "StaticMeteringSource",
    "Sub2ApiClient",
    "Sub2ApiError",
    "Sub2ApiUnavailable",
    "Sub2User",
    "default_resolver",
    "ensure_customer",
    "evaluate_usage_warnings",
    "get_plan",
    "init_billing",
    "micro_to_yuan",
    "micro_to_yuan_str",
    "reconcile",
    "seed_plans",
    "validate_period",
    "yuan_to_micro",
]


def init_billing(engine: Engine | None = None, *, session: Session | None = None) -> Engine:
    """建 billing_* 表并播种三档套餐（幂等）。返回所用 engine。

    注意：不建 `metering_records`（归 metering 模块）；迁移链就位前
    用 create_all 起步，alembic 版本由主代理统一收敛。
    """
    engine = engine or create_engine("sqlite:///./billing.db")
    Base.metadata.create_all(engine)
    with Session(engine) as sess:
        seed_plans(sess)
        sess.commit()
    return engine
