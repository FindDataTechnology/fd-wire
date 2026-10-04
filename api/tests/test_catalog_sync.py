"""同步器测试：全量落库、增量（权威变更次日=重跑 sync 反映）、水位、对账、失败留痕。"""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import select

from fd_wire_api.catalog.client import utcnow
from fd_wire_api.catalog.db import sync_session
from fd_wire_api.catalog.models import CatalogSyncState, IndicatorSnapshot
from fd_wire_api.catalog.sync import IndicatorRegistrySync

from test_catalog_common import FakeRegistryClient, catalog_env, make_record  # noqa: F401


def _rows():
    with sync_session() as session:
        return list(session.execute(select(IndicatorSnapshot)).scalars())


def _state() -> CatalogSyncState:
    with sync_session() as session:
        return session.get(CatalogSyncState, 1)


def test_full_sync_lands_all_fields(catalog_env):
    catalog_env.fake.records = [
        make_record("cpi_cn", code="CN_CPI_YOY", status="verified"),
        make_record("pmi_cn", code="CN_PMI", status="registered"),
    ]
    result = IndicatorRegistrySync(client=catalog_env.fake).run()

    assert result.mode == "full"
    assert (result.created, result.updated, result.removed) == (2, 0, 0)
    assert result.total_in_mirror == 2
    rows = {r.indicator_id: r for r in _rows()}
    assert set(rows) == {"cpi_cn", "pmi_cn"}
    row = rows["cpi_cn"]
    # 全部展示字段按权威记录落库
    assert row.code == "CN_CPI_YOY"
    assert row.name_zh == "名称-cpi_cn"
    assert row.name_en == "Name cpi_cn"
    assert row.description_zh and row.description_en
    assert row.domain == "macro"
    assert row.frequency == "monthly"
    assert row.time_span_start == "2000-01" and row.time_span_end == "2026-09"
    assert row.entity_coverage_count == 31
    assert row.sample_value == "102.3"
    assert row.status == "verified"
    assert row.synced_at is not None
    assert rows["pmi_cn"].status == "registered"
    # 水位落库
    assert _state().last_watermark is not None
    assert _state().last_status == "ok"


def test_duplicate_indicator_id_upserts_single_row(catalog_env):
    later = utcnow() + timedelta(seconds=5)
    catalog_env.fake.records = [
        make_record("dup", code="OLD"),
        make_record("dup", code="NEW", status="registered", updated_at=later),
    ]
    result = IndicatorRegistrySync(client=catalog_env.fake).run()

    assert result.created == 1  # 权威主键唯一：同 id 只有一行
    rows = _rows()
    assert len(rows) == 1
    assert rows[0].code == "NEW"  # 后到（updated_at 更晚）的权威记录胜出


def test_incremental_sync_reflects_authority_change(catalog_env):
    """权威变更次日反映 = 次日重跑 sync 后镜像可见。"""
    syncer = IndicatorRegistrySync(client=catalog_env.fake)
    catalog_env.fake.records = [
        make_record("cpi_cn", status="verified"),
        make_record("pmi_cn", status="registered"),
    ]
    syncer.run()
    watermark_before = _state().last_watermark

    # —— 「次日」：权威库发生新增 / 状态变更 / 字段更新（updated_at 推进）——
    next_day = utcnow() + timedelta(days=1)
    catalog_env.fake.upsert_authority(
        make_record("coal", code="CN_COAL", domain="energy", status="registered", updated_at=next_day)
    )
    catalog_env.fake.upsert_authority(
        make_record("cpi_cn", status="verified", entity_coverage_count=42, updated_at=next_day)
    )
    catalog_env.fake.upsert_authority(
        make_record("pmi_cn", status="verified", updated_at=next_day)  # registered → verified
    )

    result = syncer.run()
    assert result.mode == "incremental"
    # 增量拉取携带上次水位
    assert catalog_env.fake.calls[-1][0] == watermark_before
    assert (result.created, result.updated) == (1, 2)

    rows = {r.indicator_id: r for r in _rows()}
    assert rows["coal"].domain == "energy" and rows["coal"].status == "registered"
    assert rows["cpi_cn"].entity_coverage_count == 42
    assert rows["pmi_cn"].status == "verified"
    assert _state().last_watermark > watermark_before


def test_incremental_sync_skips_unchanged(catalog_env):
    syncer = IndicatorRegistrySync(client=catalog_env.fake)
    catalog_env.fake.records = [make_record("cpi_cn")]
    syncer.run()

    result = syncer.run()  # 权威无变更
    assert result.mode == "incremental"
    assert result.fetched == 0
    assert (result.created, result.updated, result.removed) == (0, 0, 0)
    assert result.total_in_mirror == 1  # 既有镜像不动


def test_full_sync_reconciles_removals_but_incremental_keeps(catalog_env):
    syncer = IndicatorRegistrySync(client=catalog_env.fake)
    catalog_env.fake.records = [make_record("a"), make_record("b")]
    syncer.run()
    assert len(_rows()) == 2

    # 权威删除 b：增量同步不删（只见变更集）
    catalog_env.fake.remove_authority("b")
    result = syncer.run()
    assert result.removed == 0
    assert {r.indicator_id for r in _rows()} == {"a", "b"}

    # 全量对账：镜像与权威一致，b 被移除
    result = syncer.run(force_full=True)
    assert result.mode == "full"
    assert result.removed == 1
    assert {r.indicator_id for r in _rows()} == {"a"}
    assert result.total_in_mirror == 1


def test_sync_failure_recorded_and_reraised(catalog_env):
    class ExplodingClient(FakeRegistryClient):
        def fetch_concepts(self, updated_since=None, force_full: bool = False):
            raise RuntimeError("authority down")

    syncer = IndicatorRegistrySync(client=ExplodingClient())
    with pytest.raises(RuntimeError, match="authority down"):
        syncer.run()

    state = _state()
    assert state.last_status == "error"
    assert "authority down" in (state.last_error or "")
    assert state.last_watermark is None  # 失败不推进水位
