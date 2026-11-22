"""追踪主体测试（wire-subject-tracking）。

覆盖：
- task 1.1/1.2：CRUD + kind/ref/通道形状校验（422 定位、零半写）；
- task 2.1-2.6：五个投影器的形状与降级（注入假 client，不打网）；
- task 3.1/3.2：扇出失败隔离、时间轴跨通道有序、跨客户隔离（404）；
- task 4.1/4.2：物化幂等、行数闸、storage_tier 锁 api、快照进既有 alert query。

基座：in-memory datasets 库（Subject 与 Dataset 同库同事务，照 test_workbench）。
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
from fd_wire_api.datasets.models import Dataset
from fd_wire_api.subjects import service
from fd_wire_api.subjects import projectors as proj
from fd_wire_api.subjects.models import Subject

if _OWNS:
    del os.environ["FD_WIRE_DATABASE_URL"]


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


# ------------------------------- 假客户端 -------------------------------


class FakeBiz:
    """business-mcp 假件：按工具名返回预置结果。"""

    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def call(self, tool, args):
        self.calls.append((tool, args))
        resp = self.responses.get(tool)
        if isinstance(resp, Exception):
            raise resp
        return resp if resp is not None else {}


class FakeInfo:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def list_items(self, query):
        self.calls.append(query)
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


# ------------------------------- CRUD -------------------------------


def test_create_and_get(db):
    s = service.create_subject(
        db, customer_id="c1", kind="company", ref={"source": "stock_code", "code": "600519"},
        title="贵州茅台", description=None,
        channels=[{"type": "indicators", "spec": {"indicator_ids": ["fd_open_data:price"]}}],
    )
    db.commit()
    got = service.get_subject(db, customer_id="c1", subject_id=s.id)
    assert got.title == "贵州茅台"
    assert len(got.channels) == 1


def test_invalid_kind_422(db):
    with pytest.raises(service.SubjectError):
        service.create_subject(
            db, customer_id="c1", kind="person", ref={"source": "stock_code", "code": "x"},
            title="t", description=None, channels=[],
        )


def test_channel_missing_params_422(db):
    with pytest.raises(service.SubjectError):
        service.create_subject(
            db, customer_id="c1", kind="company", ref={"source": "stock_code", "code": "x"},
            title="t", description=None,
            channels=[{"type": "indicators", "spec": {}}],  # 缺 indicator_ids
        )


def test_cross_customer_isolation(db):
    s = service.create_subject(
        db, customer_id="c1", kind="company", ref={"source": "stock_code", "code": "x"},
        title="t", description=None, channels=[],
    )
    db.commit()
    with pytest.raises(service.SubjectNotFound):
        service.get_subject(db, customer_id="c2", subject_id=s.id)


# ------------------------------- 投影器 -------------------------------


def test_project_indicators_ok_and_unavailable():
    rr = proj.resolve_ref("company", {"source": "stock_code", "code": "600519"})
    biz = FakeBiz({"indicator_series_read": {"results": [
        {"indicator_id": "x", "date": "2024-12-31", "value": 1.0, "unit": "元"},
    ], "errors": []}})
    r = proj.project_indicators(rr, {"indicator_ids": ["x"]}, biz)
    assert r.status == proj.STATUS_OK and r.coverage == proj.COVERAGE_AVAILABLE
    assert r.as_of == "2024-12-31"

    # 上游抛错 → unavailable，不抛
    r2 = proj.project_indicators(rr, {"indicator_ids": ["x"]}, FakeBiz(
        {"indicator_series_read": RuntimeError("down")}))
    assert r2.coverage == proj.COVERAGE_UNAVAILABLE


def test_project_announcements_ok_and_attribution_gap():
    rr = proj.resolve_ref("company", {"source": "stock_code", "code": "600519"})
    info = FakeInfo({"items": [{"item_id": "a", "title": "公告", "published_at": "2026-11-20"}]})
    r = proj.project_announcements(rr, {}, info)
    assert r.coverage == proj.COVERAGE_AVAILABLE and info.calls[0]["source_codes"] == ["600519"]

    gap = proj.project_announcements(rr, {}, FakeInfo(
        {"items": [], "empty_reason": "sources_lack_entity_attribution"}))
    assert gap.coverage == proj.COVERAGE_UNAVAILABLE


def test_project_registry_domain_unavailable():
    rr = proj.resolve_ref("company", {"source": "stock_code", "code": "600519"})
    biz = FakeBiz({"ia35_company_search": {"status": "domain_unavailable"}})
    r = proj.project_registry(rr, {"credit_code": "913"}, biz)
    assert r.coverage == proj.COVERAGE_UNAVAILABLE


def test_project_graph_neighbors():
    rr = proj.resolve_ref("company", {"source": "stock_code", "code": "600519"})
    biz = FakeBiz({"graph_search": {"algorithm": "neighbors", "results": [{"code": "801120"}]}})
    r = proj.project_graph(rr, {}, biz)
    assert r.coverage == proj.COVERAGE_AVAILABLE and r.rows[0]["code"] == "801120"
    # 默认不传 entity_type_filter——它过滤邻居类型，传中心类型(stock)会滤掉
    # industry/person 邻居致通道恒空（生产踩过的坑）
    assert biz.calls[0][1].get("entity_type_filter") is None


def test_project_graph_neighbor_type_honored():
    rr = proj.resolve_ref("company", {"source": "stock_code", "code": "300762"})
    biz = FakeBiz({"graph_search": {"results": [{"code": "801740", "entity_type": "industry"}]}})
    proj.project_graph(rr, {"neighbor_type": "industry"}, biz)
    # 显式声明邻居类型时才传 filter
    assert biz.calls[0][1]["entity_type_filter"] == "industry"


def test_project_context_defaults_unavailable():
    rr = proj.resolve_ref("country", {"source": "country_code", "code": "CN"})
    r = proj.project_context(rr, {}, FakeBiz({}))
    assert r.coverage == proj.COVERAGE_UNAVAILABLE  # 无缺省指标 → 如实降级


# ------------------------------- read 扇出 -------------------------------


def test_read_fanout_failure_isolation(db):
    s = service.create_subject(
        db, customer_id="c1", kind="company", ref={"source": "stock_code", "code": "600519"},
        title="茅台", description=None,
        channels=[
            {"type": "indicators", "spec": {"indicator_ids": ["x"]}},
            {"type": "announcements", "spec": {}},
        ],
    )
    db.commit()
    biz = FakeBiz({"indicator_series_read": {"results": [
        {"indicator_id": "x", "date": "2024-12-31", "value": 1.0, "unit": "元"}]}})
    info = FakeInfo(RuntimeError("fd-info down"))  # 公告通道挂
    out = service.read_subject(db, customer_id="c1", subject_id=s.id,
                               info_client=info, business_caller=biz)
    by_type = {c["type"]: c for c in out["channels"]}
    assert by_type["indicators"]["coverage"] == proj.COVERAGE_AVAILABLE
    assert by_type["announcements"]["coverage"] == proj.COVERAGE_UNAVAILABLE
    # 时间轴只含可用通道
    assert all(e["channel"] == "indicators" for e in out["timeline"])


def test_timeline_ordered_across_channels(db):
    s = service.create_subject(
        db, customer_id="c1", kind="company", ref={"source": "stock_code", "code": "600519"},
        title="茅台", description=None,
        channels=[
            {"type": "indicators", "spec": {"indicator_ids": ["x"]}},
            {"type": "announcements", "spec": {}},
        ],
    )
    db.commit()
    biz = FakeBiz({"indicator_series_read": {"results": [
        {"indicator_id": "x", "date": "2024-12-31", "value": 1.0, "unit": "元"}]}})
    info = FakeInfo({"items": [
        {"item_id": "a", "title": "新公告", "published_at": "2026-11-20T00:00:00Z"}]})
    out = service.read_subject(db, customer_id="c1", subject_id=s.id,
                               info_client=info, business_caller=biz)
    dates = [e["date"] for e in out["timeline"]]
    assert dates == sorted(dates, reverse=True)
    assert {e["channel"] for e in out["timeline"]} == {"indicators", "announcements"}


# ------------------------------- 快照 -------------------------------


def test_snapshot_idempotent_and_storage_tier_api(db):
    s = service.create_subject(
        db, customer_id="c1", kind="company", ref={"source": "stock_code", "code": "600519"},
        title="茅台", description=None,
        channels=[{"type": "indicators", "spec": {"indicator_ids": ["x"]}}],
    )
    db.commit()
    biz = FakeBiz({"indicator_series_read": {"results": [
        {"indicator_id": "x", "date": "2024-12-31", "value": 1.0, "unit": "元"}]}})
    d1 = service.snapshot_subject(db, customer_id="c1", subject_id=s.id,
                                  info_client=None, business_caller=biz)
    d2 = service.snapshot_subject(db, customer_id="c1", subject_id=s.id,
                                  info_client=None, business_caller=biz)
    assert d1.id == d2.id  # 幂等：同主体只一个快照集
    assert d2.storage_tier == service.datasets_service.TIER_API
    assert d2.source_kind == "subject"
    rows = db.query(Dataset).filter(Dataset.customer_id == "c1",
                                    Dataset.source_kind == "subject").all()
    assert len(rows) == 1
    assert d2.row_count == 1


# ------------------------------- 迁移链 0056 -------------------------------


@pytest.fixture()
def migrated_0056(tmp_path, monkeypatch):
    """对临时库跑 alembic upgrade head（含 0056 主体表）。"""
    from pathlib import Path

    from alembic import command
    from alembic.config import Config

    monkeypatch.delenv("FD_WIRE_DATABASE_URL", raising=False)
    db_url = f"sqlite:///{tmp_path}/subjects_migration.db"
    monkeypatch.setenv("DATABASE_URL", db_url)
    cfg = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
    command.upgrade(cfg, "head")
    return cfg, db_url


def test_migration_creates_subject_tables(migrated_0056):
    from sqlalchemy import create_engine, inspect

    _, db_url = migrated_0056
    engine = create_engine(db_url)
    insp = inspect(engine)
    names = insp.get_table_names()
    assert "subjects" in names and "subject_channels" in names
    engine.dispose()


def test_migration_schema_matches_orm(migrated_0056):
    from sqlalchemy import create_engine, inspect

    from fd_wire_api.subjects import models

    _, db_url = migrated_0056
    engine = create_engine(db_url)
    insp = inspect(engine)
    for table in (models.Subject, models.SubjectChannel):
        migrated = {c["name"] for c in insp.get_columns(table.__tablename__)}
        declared = set(table.__table__.columns.keys())
        assert migrated == declared, f"{table.__tablename__} 迁移与 ORM 列漂移: {migrated ^ declared}"
    engine.dispose()


def test_migration_downgrade_drops_subject_tables(migrated_0056):
    from alembic import command
    from sqlalchemy import create_engine, inspect

    cfg, db_url = migrated_0056
    command.downgrade(cfg, "0055_ontology_kernel_attrs")
    engine = create_engine(db_url)
    names = inspect(engine).get_table_names()
    assert "subjects" not in names and "subject_channels" not in names
    engine.dispose()
