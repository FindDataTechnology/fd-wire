"""生命周期主路径：provision 幂等 / 状态流转 / 明确错误 / WAL / 未知客户。"""

from __future__ import annotations

import sqlite3

import pytest

from cell_manager import (
    ACTIVE,
    NOT_FOUND,
    PAUSED,
    CellManagerError,
    InvalidCellStateError,
    UnknownCellError,
)


class TestProvision:
    def test_provision_creates_volume_container_and_registry_entry(self, manager, fake_driver, fake_registry, config):
        status = manager.provision("acme")

        assert status.state == ACTIVE
        assert status.container_name == "fd-wire-cell-acme"
        assert status.registry_path == "fd-wire-cell-acme"
        # 卷：独立目录 + daas.db 就位
        volume = config.data_root / "acme"
        assert status.volume_path == str(volume)
        assert (volume / "daas.db").is_file()
        # 容器：创建并启动，env 注入隔离两件套
        info = fake_driver.inspect("fd-wire-cell-acme")
        assert info.status == "running"
        assert info.image == config.image
        assert info.env["DAAS_DATABASE_URL"] == "sqlite:////data/daas.db"
        assert info.env["WIRE_GATEWAY_URL"] == config.gateway_url
        # registry：server 条目已注册
        assert fake_registry.is_registered("fd-wire-cell-acme")

    def test_daas_db_initialized_as_empty_wal(self, manager, config):
        manager.provision("acme")
        conn = sqlite3.connect(config.data_root / "acme" / "daas.db")
        try:
            mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        finally:
            conn.close()
        assert str(mode).lower() == "wal"

    def test_provision_is_idempotent_when_active(self, manager, fake_driver, fake_registry):
        first = manager.provision("acme")
        again = manager.provision("acme")

        assert again.state == ACTIVE == first.state
        assert again.container_name == first.container_name
        # no-op 语义：不重复 create 容器、不重复注册条目
        assert fake_driver.call_count("create", "fd-wire-cell-acme") == 1
        assert fake_registry.calls.count(("register", "fd-wire-cell-acme")) == 1

    def test_provision_rejected_when_paused_with_clear_error(self, manager):
        manager.provision("acme")
        manager.pause("acme")
        with pytest.raises(InvalidCellStateError, match="paused.*resume"):
            manager.provision("acme")

    def test_provision_rejected_when_in_retention(self, manager):
        manager.provision("acme")
        manager.deprovision("acme")
        with pytest.raises(InvalidCellStateError, match="retention"):
            manager.provision("acme")

    def test_provision_rejects_unsafe_customer_id(self, manager):
        for bad in ("../escape", "/abs", ".", "..", "a/b", "", "空格 x", "x" * 65):
            with pytest.raises(CellManagerError):
                manager.provision(bad)


class TestPauseResume:
    def test_pause_stops_container_and_keeps_volume(self, manager, fake_driver, config):
        manager.provision("acme")
        status = manager.pause("acme")

        assert status.state == PAUSED
        assert fake_driver.inspect("fd-wire-cell-acme").status == "stopped"
        # 数据保留：卷文件还在
        assert (config.data_root / "acme" / "daas.db").is_file()

    def test_resume_restarts_same_container_with_volume_intact(self, manager, fake_driver, config):
        manager.provision("acme")
        manager.pause("acme")
        # 暂停期间往卷里写文件（模拟数据留存）
        marker = config.data_root / "acme" / "customer-data.bin"
        marker.write_bytes(b"tenant-data")
        status = manager.resume("acme")

        assert status.state == ACTIVE
        assert fake_driver.inspect("fd-wire-cell-acme").status == "running"
        assert marker.read_bytes() == b"tenant-data"  # 原卷原样

    def test_pause_rejected_when_already_paused(self, manager):
        manager.provision("acme")
        manager.pause("acme")
        with pytest.raises(InvalidCellStateError, match="paused"):
            manager.pause("acme")

    def test_resume_rejected_when_active(self, manager):
        manager.provision("acme")
        with pytest.raises(InvalidCellStateError, match="active"):
            manager.resume("acme")


class TestStatusUnknown:
    def test_status_unknown_customer_is_not_found(self, manager):
        status = manager.status("ghost-corp")
        assert status.state == NOT_FOUND
        assert status.to_dict()["state"] == "not_found"

    def test_operations_on_unknown_customer_raise(self, manager):
        for op in (manager.pause, manager.resume, manager.deprovision, manager.cancel_deprovision):
            with pytest.raises(UnknownCellError, match="ghost-corp"):
                op("ghost-corp")
