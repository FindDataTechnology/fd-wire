"""启动期建表开关的行为级用例（gate-boot-schema-creation 5.1）。

这些用例不看决策函数，而是**真的调 init_db()**、再查库里有没有表——
判据是「发不发 DDL」，不是「函数返回什么」。
"""

from __future__ import annotations

import pytest
from sqlalchemy import inspect

from fd_wire_api import db_policy
from fd_wire_api.contact import db as contact_db

TABLE = "contact_messages"


@pytest.fixture
def isolated_db(tmp_path, monkeypatch):
    """contact 切片的独立 sqlite 库（每例一个新文件）。"""
    monkeypatch.setenv("FD_WIRE_CONTACT_DATABASE_URL", f"sqlite:///{tmp_path}/contact.db")
    monkeypatch.delenv(db_policy.BOOT_AUTO_CREATE_ENV, raising=False)
    monkeypatch.delenv("FD_WIRE_CONTACT_AUTO_CREATE_TABLES", raising=False)
    monkeypatch.setenv(db_policy.BOOT_SCHEMA_CHECK_ENV, "off")
    db_policy.reset_schema_cache()
    contact_db.reset_contact_runtime()
    yield contact_db
    contact_db.reset_contact_runtime()
    db_policy.reset_schema_cache()


def _has_table(mod) -> bool:
    engine = mod.get_engine()
    try:
        return TABLE in inspect(engine).get_table_names()
    finally:
        engine.dispose()


def test_boot_switch_off_issues_no_ddl(isolated_db):
    """总开关关 → 空库上跑完 init_db 仍然没有表（零 DDL）。"""
    import os

    os.environ[db_policy.BOOT_AUTO_CREATE_ENV] = "0"
    try:
        isolated_db.init_db()
        assert not _has_table(isolated_db)
    finally:
        del os.environ[db_policy.BOOT_AUTO_CREATE_ENV]


def test_default_still_creates(isolated_db):
    """都不设 → 照旧建表（开发/测试零漂移）。"""
    isolated_db.init_db()
    assert _has_table(isolated_db)


def test_module_switch_wins_over_boot_switch(isolated_db, monkeypatch):
    """总开关关、逐模块开 → 该模块仍建表。"""
    monkeypatch.setenv(db_policy.BOOT_AUTO_CREATE_ENV, "0")
    monkeypatch.setenv("FD_WIRE_CONTACT_AUTO_CREATE_TABLES", "1")
    isolated_db.init_db()
    assert _has_table(isolated_db)


def test_strict_mode_refuses_to_start(isolated_db, monkeypatch):
    """建表关 + strict + 空库 → 拒绝启动，且错误里点名缺的表。"""
    monkeypatch.setenv(db_policy.BOOT_AUTO_CREATE_ENV, "0")
    monkeypatch.setenv(db_policy.BOOT_SCHEMA_CHECK_ENV, "strict")
    with pytest.raises(RuntimeError) as excinfo:
        isolated_db.init_db()
    assert TABLE in str(excinfo.value)
    assert not _has_table(isolated_db)
