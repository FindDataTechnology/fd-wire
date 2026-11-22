"""subjects 切片（wire-subject-tracking）：追踪主体 + 通道扇出 + 物化快照。

对外暴露 ``router``（挂到 app 即得 /api/v1/subjects 全部端点）与 ``init_db``
（建 subjects 两表到 datasets 库；生产走 alembic，开发 create_all 兜底）。
"""

from .db import SubjectsBase, get_db, get_session, init_db, reset_subjects_runtime
from .models import CHANNEL_TYPES, SUBJECT_KINDS, Subject, SubjectChannel
from .routes import router

__all__ = [
    "CHANNEL_TYPES",
    "SUBJECT_KINDS",
    "Subject",
    "SubjectChannel",
    "SubjectsBase",
    "get_db",
    "get_session",
    "init_db",
    "reset_subjects_runtime",
    "router",
]
