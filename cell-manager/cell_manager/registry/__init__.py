"""registry client 包：协议 + 工厂。"""

from __future__ import annotations

import os
from typing import Mapping

from cell_manager.config import CellManagerConfig
from cell_manager.errors import ConfigError
from cell_manager.registry.base import RegistryClient, ServerEntry
from cell_manager.registry.fake import FakeRegistryClient
from cell_manager.registry.http import HttpRegistryClient

__all__ = [
    "RegistryClient",
    "ServerEntry",
    "FakeRegistryClient",
    "HttpRegistryClient",
    "build_registry_client",
]


def build_registry_client(
    config: CellManagerConfig, env: Mapping[str, str] | None = None
) -> RegistryClient:
    """按配置构造 registry client（CELL_REGISTRY_MODE=http|fake）。

    fake 模式条目表落盘到 ``<home>/state/fake-registry.json``——CLI 跨进程
    演示时与 cells.json 簿记同步存续（单测直构缺省纯内存）。
    """
    if config.registry_mode == "fake":
        return FakeRegistryClient(persist_path=config.home / "state" / "fake-registry.json")
    if config.registry_mode == "http":
        e = dict(os.environ if env is None else env)
        return HttpRegistryClient(
            config.registry_url,
            servers_path=e.get("CELL_REGISTRY_SERVERS_PATH"),
            token=e.get("CELL_REGISTRY_TOKEN"),
        )
    raise ConfigError(f"unknown registry mode: {config.registry_mode!r}")
