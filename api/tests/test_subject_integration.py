"""主体追踪集成测试（wire-subject-tracking tasks 4.3 / 7.1 / 7.2）。

覆盖：
- 4.3 快照数据集进既有面：以快照 dataset 为 query 源执行 query_contract 路径
  （storage_tier=api → api_store 本地执行，零引擎、零特化）；
- 7.1 端到端：声明 company 主体（stock_code=600519）→ 加 announcements+indicators
  通道 → read 两通道 timeline 有序 → snapshot 出集 → 以集为 query 源取数成功；
- 7.2 降级演练：announcements 上游缺位（fd-info None）→ 该通道 unavailable、
  indicators 照常、整体读不失败。
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

from fd_wire_api.artifacts import query_contract
from fd_wire_api.datasets.db import DatasetsBase
from fd_wire_api.subjects import projectors as proj
from fd_wire_api.subjects import service

if _OWNS:
    del os.environ["FD_WIRE_DATABASE_URL"]


class FakeBiz:
    def __init__(self, responses):
        self.responses = responses

    def call(self, tool, args):
        r = self.responses.get(tool)
        if isinstance(r, Exception):
            raise r
        return r or {}

    def close(self):
        pass


class FakeInfo:
    def __init__(self, payload):
        self.payload = payload

    def list_items(self, query):
        return self.payload


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    DatasetsBase.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    s = Session()
    try:
        yield s
    finally:
        s.close()


def _company_with_two_channels(db):
    s = service.create_subject(
        db, customer_id="c1", kind="company",
        ref={"source": "stock_code", "code": "600519"}, title="贵州茅台", description=None,
        channels=[
            {"type": "indicators", "spec": {"indicator_ids": ["fd_open_data:mktcap"]}},
            {"type": "announcements", "spec": {}},
        ],
    )
    db.commit()
    return s


_BIZ = FakeBiz({"indicator_series_read": {"results": [
    {"indicator_id": "fd_open_data:mktcap", "date": "2024-12-31", "value": 1.9e12, "unit": "元"}]}})
_INFO = FakeInfo({"items": [
    {"item_id": "a1", "source": "cninfo", "title": "分红公告", "published_at": "2026-11-20T00:00:00Z"}]})


def test_read_two_channels_ordered(db):
    """7.1 前段：两通道扇出，timeline 跨通道按日期有序。"""
    s = _company_with_two_channels(db)
    out = service.read_subject(db, customer_id="c1", subject_id=s.id,
                               info_client=_INFO, business_caller=_BIZ)
    kinds = {c["type"]: c["coverage"] for c in out["channels"]}
    assert kinds == {"indicators": proj.COVERAGE_AVAILABLE, "announcements": proj.COVERAGE_AVAILABLE}
    dates = [e["date"] for e in out["timeline"]]
    assert dates == sorted(dates, reverse=True)
    assert {e["channel"] for e in out["timeline"]} == {"indicators", "announcements"}


def test_snapshot_feeds_existing_query_path(db):
    """4.3 + 7.1 后段：快照集经既有 query_contract 路径取数成功（api 档本地执行）。"""
    s = _company_with_two_channels(db)
    dataset = service.snapshot_subject(db, customer_id="c1", subject_id=s.id,
                                       info_client=_INFO, business_caller=_BIZ)
    assert dataset.storage_tier == service.datasets_service.TIER_API

    # 以快照集为 query 源——走 api_store 本地执行（零引擎），无需特化
    result = query_contract._query_dataset(
        db, dataset_id=dataset.id, customer_id="c1",
        query={"filters": [], "sort": [], "limit": 100, "columns": None},
        engine_factory=lambda _cid: (_ for _ in ()).throw(AssertionError("不应触引擎")),
    )
    # 至少有一行（时间轴里 indicators + announcements 两条）
    assert result.get("rows")
    assert len(result["rows"]) == dataset.row_count


def test_degradation_info_missing_does_not_fail_read(db):
    """7.2：fd-info 缺位 → announcements unavailable，indicators 照常，整体不失败。"""
    s = _company_with_two_channels(db)
    out = service.read_subject(db, customer_id="c1", subject_id=s.id,
                               info_client=None, business_caller=_BIZ)
    by_type = {c["type"]: c for c in out["channels"]}
    assert by_type["announcements"]["coverage"] == proj.COVERAGE_UNAVAILABLE
    assert by_type["indicators"]["coverage"] == proj.COVERAGE_AVAILABLE
