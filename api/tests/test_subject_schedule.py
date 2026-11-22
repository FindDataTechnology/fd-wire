"""调度第三类目标（subject）测试（wire-subject-tracking tasks 5.1/5.2）。

- 5.1：建 subject 调度成功、地板 60 分钟、非法/不存在目标被拒；
- 5.2：到点执行调 snapshot 更新数据集、主体删除抛 TargetGone。
"""

from __future__ import annotations

import os

os.environ.setdefault("AI_DATABASE_URL", "sqlite://")
_OWNS = "FD_WIRE_DATABASE_URL" not in os.environ
os.environ.setdefault("FD_WIRE_DATABASE_URL", "sqlite://")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from fd_wire_api.datasets.db import DatasetsBase
from fd_wire_api.schedules import executor, service as sched_service
from fd_wire_api.schedules.models import RefreshSchedule
from fd_wire_api.subjects import service as subject_service

if _OWNS:
    del os.environ["FD_WIRE_DATABASE_URL"]


@pytest.fixture()
def db(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    DatasetsBase.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    # 把 schedules/subjects 的会话都指向同一内存库
    import fd_wire_api.datasets.db as ddb
    monkeypatch.setattr(ddb, "get_session", lambda: Session())
    import fd_wire_api.schedules.db as sdb
    if hasattr(sdb, "get_session"):
        monkeypatch.setattr(sdb, "get_session", lambda: Session())
    # subjects.db.get_session 转发到 datasets.db.get_session（被上面打了补丁）
    s = Session()
    try:
        yield s
    finally:
        s.close()


def _mk_subject(db):
    s = subject_service.create_subject(
        db, customer_id="c1", kind="company",
        ref={"source": "stock_code", "code": "600519"}, title="茅台", description=None,
        channels=[{"type": "indicators", "spec": {"indicator_ids": ["x"]}}],
    )
    db.commit()
    return s


def test_interval_floor_for_subject():
    assert sched_service.min_interval_minutes("subject") == 60


def test_validate_subject_target_ok(db):
    s = _mk_subject(db)
    # 不抛即通过（属主校验）
    sched_service._validate_subject_target("c1", str(s.id))


def test_validate_subject_target_not_found(db):
    with pytest.raises(sched_service.ScheduleTargetNotFound):
        sched_service._validate_subject_target("c1", "999999")


def test_validate_subject_target_other_customer(db):
    s = _mk_subject(db)
    with pytest.raises(sched_service.ScheduleTargetNotFound):
        sched_service._validate_subject_target("c2", str(s.id))


def test_execute_subject_materializes(db, monkeypatch):
    s = _mk_subject(db)

    class FakeBiz:
        def call(self, tool, args):
            return {"results": [
                {"indicator_id": "x", "date": "2024-12-31", "value": 1.0, "unit": "元"}]}
        def close(self):
            pass

    monkeypatch.setattr(subject_service, "get_business_caller", lambda: FakeBiz())
    out = executor.execute_subject(customer_id="c1", target_id=str(s.id))
    assert out["subject_id"] == s.id
    assert out["row_count"] >= 1


def test_execute_subject_target_gone(db):
    with pytest.raises(executor.TargetGone):
        executor.execute_subject(customer_id="c1", target_id="999999")
