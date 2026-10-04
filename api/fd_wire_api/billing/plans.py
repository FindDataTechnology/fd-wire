"""套餐档位：已裁决的默认三档（seed），后台可配置不发版。

seed 策略=insert-if-missing：已存在的档位行不动，保留后台改价。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Plan
from .money import yuan_to_micro


@dataclass(frozen=True)
class PlanSeed:
    code: str
    name: str
    monthly_price_yuan: str
    included_lines: int
    overage_unit_price_yuan: str

    @property
    def monthly_price_micro(self) -> int:
        return yuan_to_micro(self.monthly_price_yuan)

    @property
    def overage_unit_price_micro(self) -> int:
        return yuan_to_micro(self.overage_unit_price_yuan)


#: 已裁决默认档位（design 裁决，勿随手改价——改价走后台配置）
SEEDS: tuple[PlanSeed, ...] = (
    PlanSeed("starter", "起步版", "1999", 500_000, "0.004"),
    PlanSeed("professional", "专业版", "6999", 3_000_000, "0.003"),
    PlanSeed("enterprise", "旗舰版", "19999", 12_000_000, "0.002"),
)

PLAN_CODES: tuple[str, ...] = tuple(s.code for s in SEEDS)


def seed_plans(session: Session) -> dict[str, Plan]:
    """幂等播种三档套餐：缺则插入，存在则保留（后台可配优先）。"""
    plans: dict[str, Plan] = {
        p.code: p for p in session.execute(select(Plan)).scalars().all()
    }
    for seed in SEEDS:
        existing = plans.get(seed.code)
        if existing is None:
            existing = Plan(
                code=seed.code,
                name=seed.name,
                monthly_price_micro=seed.monthly_price_micro,
                included_lines=seed.included_lines,
                overage_unit_price_micro=seed.overage_unit_price_micro,
                is_active=True,
            )
            session.add(existing)
            plans[seed.code] = existing
    session.flush()
    return plans


def get_plan(session: Session, code: str) -> Plan:
    plan = session.execute(select(Plan).where(Plan.code == code)).scalar_one_or_none()
    if plan is None:
        raise ValueError(f"未知套餐档位: {code!r}（可用: {list(PLAN_CODES)}）")
    return plan
