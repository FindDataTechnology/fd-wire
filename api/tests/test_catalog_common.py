"""catalog 镜像测试的共享环境（本文件自身不含测试）。

提供：
- ``FakeRegistryClient``：权威源假实现（数据驱动 updated_at 增量过滤，
  记录每次调用的水位入参）；
- ``catalog_env`` fixture：隔离的 SQLite 镜像库 + 挂好 catalog 路由的
  FastAPI 应用（同步器注入假客户端，调度关闭）。
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from fd_wire_api.catalog import catalog_settings, init_db, register_catalog, reset_engines
from fd_wire_api.catalog.client import ConceptBatch, ConceptRecord, utcnow
from fd_wire_api.catalog.routes import get_registry_client

INTERNAL_TOKEN = "test-internal-token"


def make_record(indicator_id: str, **overrides) -> ConceptRecord:
    """带默认展示字段的权威记录。"""
    base = dict(
        code=indicator_id.upper(),
        name_zh=f"名称-{indicator_id}",
        name_en=f"Name {indicator_id}",
        description_zh=f"描述-{indicator_id}",
        description_en=f"Description {indicator_id}",
        domain="macro",
        frequency="monthly",
        time_span_start="2000-01",
        time_span_end="2026-09",
        entity_coverage_count=31,
        sample_value="102.3",
        status="verified",
        updated_at=utcnow(),
    )
    base.update(overrides)
    return ConceptRecord(indicator_id=indicator_id, **base)


class FakeRegistryClient:
    """权威源假实现：updated_since 水位过滤；调用入参全记录。"""

    def __init__(self, records: list[ConceptRecord] | None = None):
        self.records: list[ConceptRecord] = list(records or [])
        self.calls: list[tuple[object | None, bool]] = []

    def upsert_authority(self, record: ConceptRecord) -> None:
        """模拟权威库新增/变更（以 indicator_id 为准）。"""
        self.records = [r for r in self.records if r.indicator_id != record.indicator_id]
        self.records.append(record)

    def remove_authority(self, indicator_id: str) -> None:
        self.records = [r for r in self.records if r.indicator_id != indicator_id]

    def fetch_concepts(self, updated_since=None, force_full: bool = False) -> ConceptBatch:
        self.calls.append((updated_since, force_full))
        if updated_since is None or force_full:
            items = list(self.records)
        else:
            items = [
                r
                for r in self.records
                if r.updated_at is not None and r.updated_at > updated_since
            ]
        stamps = [r.updated_at for r in self.records if r.updated_at is not None]
        batch = ConceptBatch(
            items=items,
            next_watermark=max(stamps) if stamps else (updated_since or utcnow()),
            full=updated_since is None or force_full,
        )
        return batch


@pytest.fixture
def catalog_env(tmp_path, monkeypatch):
    """隔离镜像库 + 应用 + 假权威源。"""
    db_url = f"sqlite:///{tmp_path/'catalog_mirror.db'}"
    monkeypatch.setattr(catalog_settings, "catalog_database_url", db_url)
    monkeypatch.setattr(catalog_settings, "database_url", None)
    monkeypatch.setattr(catalog_settings, "catalog_internal_token", INTERNAL_TOKEN)
    monkeypatch.setattr(catalog_settings, "catalog_sync_enabled", False)
    monkeypatch.setattr(catalog_settings, "catalog_sync_on_startup", False)
    reset_engines()
    init_db()

    app = FastAPI()
    register_catalog(app)
    fake = FakeRegistryClient()
    app.dependency_overrides[get_registry_client] = lambda: fake
    client = TestClient(app)

    env = SimpleNamespace(
        app=app,
        client=client,
        fake=fake,
        db_url=db_url,
        internal_token=INTERNAL_TOKEN,
    )
    yield env
    reset_engines()
