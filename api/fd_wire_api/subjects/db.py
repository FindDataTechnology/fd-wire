"""subjects 切片的数据库基础设施（wire-subject-tracking）。

库归属：主体（subject）落**datasets 库**——快照把 subject 读结果写成客户数据集
（``source_kind="subject"``），subject 行与其快照数据集行必须能在**同一事务**里
提交。因此本切片不自建库，直接复用 datasets 切片的引擎/会话与声明基类；
``SubjectsBase`` 只是 ``DatasetsBase`` 的别名（同一 metadata、同一 engine），
让 subjects 表与 datasets 表建在同一库、共享同一事务。

生产迁移：``api/alembic/versions/`` 增一版建 ``subjects`` / ``subject_channels``；
``init_db`` 的 create_all 仅开发兜底（沿用 datasets 的 AUTO_CREATE 开关纪律）。
"""

from __future__ import annotations

import threading
from collections.abc import Iterator

from sqlalchemy.orm import Session

from ..datasets import db as _datasets_db
from ..datasets.db import DatasetsBase

#: 与 datasets 表同库同 metadata（别名而非子类——子类会被 SQLAlchemy 当作
#: joined-table 继承映射，要求自身有 __tablename__，不适用本场景）。
SubjectsBase = DatasetsBase


def get_db() -> Iterator[Session]:
    """FastAPI 依赖：复用 datasets 请求级会话（同库，事务一致）。"""
    yield from _datasets_db.get_db()


def get_session() -> Session:
    """显式会话（后台/服务内部用；与 datasets 同库）。"""
    return _datasets_db.get_session()


_init_lock = threading.Lock()
_initialized = False


def init_db() -> None:
    """幂等建 subjects 两表（开发兜底；生产走 alembic）。

    走 datasets 的建表开关：AUTO_CREATE 关闭时由 datasets.init_db 的 verify_schema
    兜底（本函数此时只确保映射已注册，让它被 verify 看见）。
    """
    global _initialized
    if _initialized:
        return
    from . import models  # noqa: F401 —— 注册映射

    with _init_lock:
        if _initialized:
            return
        if _datasets_db._auto_create_enabled():
            SubjectsBase.metadata.create_all(
                bind=_datasets_db.get_engine(),
                tables=[models.Subject.__table__, models.SubjectChannel.__table__],
            )
        _initialized = True


def reset_subjects_runtime() -> None:
    """清建表标志（测试切换库用；引擎缓存归 datasets.reset_datasets_runtime）。"""
    global _initialized
    _initialized = False


__all__ = [
    "SubjectsBase",
    "get_db",
    "get_session",
    "init_db",
    "reset_subjects_runtime",
]
