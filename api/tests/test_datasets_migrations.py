"""datasets 迁移链测试（任务 2.1）：干净库 upgrade/downgrade 往返。

- upgrade head → 六表齐全、列与索引/唯一约束按契约 §3.2；
- 链头 = 0011_datasets（顺接 0010_catalog_source_db）；
- downgrade -1 → 六表全清、链头回到 0010。
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

API_DIR = Path(__file__).resolve().parent.parent

TABLES = {
    "connectors",
    "connector_keys",
    "connector_pairing_tokens",
    "datasets",
    "dataset_syncs",
    "uploads",
}


def _alembic_config() -> Config:
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "alembic"))
    return cfg


@pytest.fixture
def migrated_sqlite(tmp_path, monkeypatch):
    db_url = f"sqlite:///{tmp_path}/datasets_migration.db"
    monkeypatch.setenv("DATABASE_URL", db_url)
    command.upgrade(_alembic_config(), "head")
    return db_url


def test_upgrade_head_creates_dataset_tables(migrated_sqlite) -> None:
    engine = create_engine(migrated_sqlite)
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    assert TABLES <= tables

    assert {c["name"] for c in inspector.get_columns("connectors")} == {
        "id",
        "customer_id",
        "name",
        "version",
        "status",
        "last_heartbeat_at",
        "created_at",
        "revoked_at",
    }
    assert {c["name"] for c in inspector.get_columns("connector_keys")} == {
        "id",
        "connector_id",
        "key_hash",
        "created_at",
        "revoked_at",
    }
    assert {c["name"] for c in inspector.get_columns("connector_pairing_tokens")} == {
        "id",
        "customer_id",
        "token_hash",
        "created_at",
        "expires_at",
        "used_at",
    }
    assert {c["name"] for c in inspector.get_columns("datasets")} == {
        "id",
        "customer_id",
        "key",
        "name",
        "source_kind",
        "connector_id",
        "source_name",
        "source_ref",
        "columns_json",
        "row_count",
        "size_bytes",
        "sync_cron",
        "sync_status",
        "paused_reason",
        "created_at",
        "updated_at",
    }
    assert {c["name"] for c in inspector.get_columns("dataset_syncs")} == {
        "id",
        "dataset_id",
        "started_at",
        "finished_at",
        "status",
        "rows",
        "error",
    }
    assert {c["name"] for c in inspector.get_columns("uploads")} == {
        "id",
        "customer_id",
        "filename",
        "columns_json",
        "row_count",
        "size_bytes",
        "stored_path",
        "created_at",
        "consumed_at",
    }
    # 关键索引
    assert "ix_datasets_customer_id" in {
        ix["name"] for ix in inspector.get_indexes("datasets")
    }
    assert "ix_dataset_syncs_dataset_id" in {
        ix["name"] for ix in inspector.get_indexes("dataset_syncs")
    }
    assert "ix_connector_keys_key_hash" in {
        ix["name"] for ix in inspector.get_indexes("connector_keys")
    }
    # datasets(customer_id, key) 唯一（sqlite 以 autoindex 实现，PRAGMA 按列断言）
    with engine.connect() as conn:
        unique_sets = []
        for _, name, unique, *_ in conn.exec_driver_sql(
            "PRAGMA index_list(datasets)"
        ).fetchall():
            if not unique:
                continue
            cols = conn.exec_driver_sql(f"PRAGMA index_info({name})").fetchall()
            unique_sets.append({row[2] for row in cols})
    assert {"customer_id", "key"} in unique_sets
    engine.dispose()


def test_chain_head_is_datasets(migrated_sqlite) -> None:
    engine = create_engine(migrated_sqlite)
    with engine.connect() as conn:
        version = conn.exec_driver_sql(
            "SELECT version_num FROM alembic_version"
        ).scalar()
    assert version == "0011_datasets"
    engine.dispose()


def test_downgrade_removes_dataset_tables(migrated_sqlite, monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", migrated_sqlite)
    command.downgrade(_alembic_config(), "-1")
    engine = create_engine(migrated_sqlite)
    inspector = inspect(engine)
    assert not (TABLES & set(inspector.get_table_names()))
    with engine.connect() as conn:
        version = conn.exec_driver_sql(
            "SELECT version_num FROM alembic_version"
        ).scalar()
    assert version == "0010_catalog_source_db"
    engine.dispose()