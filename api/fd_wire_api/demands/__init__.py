"""demands 包：数据需求单八态状态机（wire-platform-v1 任务 6.3）。

对外暴露 ``router``（挂到 app 即得全部端点）与状态机原语。
"""

from .db import Base, engine, get_db, init_db
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
    "TERMINAL_STATUSES",
    "Base",
    "Demand",
    "DemandStatus",
    "TransitionError",
    "engine",
    "get_db",
    "init_db",
    "router",
]
