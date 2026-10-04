"""demands 包：数据需求单八态状态机（任务 6.3）+ AI 预评估与人工报价（6.4）。

对外暴露 ``router``（客户/内部核心端点）与 ``admin_router``（6.4 确认台：
AI 评估独立触发 + 内部完整视图），挂到 app 即得全部端点。
"""

from .admin_routes import router as admin_router
from .db import Base, engine, get_db, init_db
from .evaluation import (
    LEGAL_DOMAIN_REVIEW_FLAG,
    EvaluationResult,
    EvaluationVerdict,
    evaluate_demand,
)
from .models import Demand
from .routes import router
from .statemachine import (
    ALLOWED_TRANSITIONS,
    TERMINAL_STATUSES,
    DemandStatus,
    TransitionError,
)

__all__ = [
    "ALLOWED_TRANSITIONS",
    "LEGAL_DOMAIN_REVIEW_FLAG",
    "TERMINAL_STATUSES",
    "Base",
    "Demand",
    "DemandStatus",
    "EvaluationResult",
    "EvaluationVerdict",
    "TransitionError",
    "admin_router",
    "engine",
    "evaluate_demand",
    "get_db",
    "init_db",
    "router",
]
