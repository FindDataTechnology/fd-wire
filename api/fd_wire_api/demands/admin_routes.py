"""需求单内部管理端点（wire-platform-v1 任务 6.4：人工报价确认台）。

- ``POST /internal/demands/{id}/evaluate``  AI 预评估独立触发端点：
  submitted（自动接单进 evaluating）或 evaluating 下（重）跑一次
  :mod:`fd_wire_api.demands.evaluation`；其余状态 409。
- ``GET  /internal/demands/{id}``           确认台内部完整视图：
  评估全文（verdict/confidence/reasons/hints/compliance_flags）+
  报价留档（operator/微元金额/历史）——这些字段绝不出现在客户侧响应。

鉴权与既有内部端点一致（``X-Internal-Token``）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from . import evaluation
from .db import get_db
from .routes import _demand_or_404, _require_internal
from .schemas import DemandInternalOut
from .statemachine import TransitionError

router = APIRouter(tags=["demands-internal"])


@router.get(
    "/internal/demands/{demand_id}",
    response_model=DemandInternalOut,
    dependencies=[Depends(_require_internal)],
)
def get_internal_demand(
    demand_id: int,
    db: Session = Depends(get_db),
) -> DemandInternalOut:
    """内部完整视图：评估全文 + 报价留档（operator 侧确认台上下文）。"""
    demand = _demand_or_404(db, demand_id)
    return DemandInternalOut.model_validate(demand)


@router.post(
    "/internal/demands/{demand_id}/evaluate",
    response_model=DemandInternalOut,
    dependencies=[Depends(_require_internal)],
)
def run_evaluation(
    demand_id: int,
    db: Session = Depends(get_db),
) -> DemandInternalOut:
    """AI 预评估独立触发（submitted 自动接单 / evaluating 重跑；其余 409）。

    LLM 不可用或输出无法解析时，如实落 doubtful +「AI 评估不可用，转人工
    评估」——绝不编造结论。
    """
    demand = _demand_or_404(db, demand_id)
    try:
        demand = evaluation.evaluate_demand(db, demand, by="ai")
    except TransitionError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return DemandInternalOut.model_validate(demand)
