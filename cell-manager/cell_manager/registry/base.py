"""RegistryClient 协议：cell 的 registry server 条目注册/摘除（可 mock）。

wire 入口（registry fork）的 server 条目是 cell 可达性的门面——
provision 即注册（同门计量，ADR-0001）、purge 即摘除（任务 5.2 联调真实 API）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class ServerEntry:
    """registry server 条目（path 为 wire 入口内的挂载路径）。"""

    path: str
    target_url: str
    display_name: str | None = None

    def to_payload(self) -> dict[str, str]:
        payload = {"path": self.path, "target_url": self.target_url}
        if self.display_name:
            payload["display_name"] = self.display_name
        return payload


@runtime_checkable
class RegistryClient(Protocol):
    """registry 借用契约（HTTP 形态见 http.py；测试用 fake.py）。"""

    def register(self, entry: ServerEntry) -> None:
        """注册（幂等：同 path 同 target 重复注册为 no-op）。"""
        ...

    def unregister(self, path: str) -> bool:
        """摘除；返回是否真摘除了条目（不存在时 False，不报错）。"""
        ...
