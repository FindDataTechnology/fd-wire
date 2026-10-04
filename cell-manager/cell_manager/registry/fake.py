"""FakeRegistryClient：内存态 registry（测试 / 无网演示）。

可选 ``persist_path``：条目表落盘（JSON）——CLI 跨进程演示时与
cells.json 簿记、FakeDriver 容器表同步存续（单测缺省纯内存）。
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from cell_manager.errors import RegistryError
from cell_manager.registry.base import ServerEntry


class FakeRegistryClient:
    """path → ServerEntry 表 + 调用记录；register 幂等、unregister 宽松。"""

    def __init__(self, persist_path: Path | str | None = None) -> None:
        self._persist_path = Path(persist_path) if persist_path is not None else None
        #: 全部调用轨迹 [("register", path) | ("unregister", path)]（不落盘）
        self.calls: list[tuple[str, str]] = []
        self._entries: dict[str, ServerEntry] = {}
        self._load()

    def register(self, entry: ServerEntry) -> None:
        self.calls.append(("register", entry.path))
        existing = self._entries.get(entry.path)
        if existing is not None and existing.target_url != entry.target_url:
            raise RegistryError(
                f"path {entry.path!r} already registered to {existing.target_url!r}"
            )
        self._entries[entry.path] = entry
        self._save()

    def unregister(self, path: str) -> bool:
        self.calls.append(("unregister", path))
        removed = self._entries.pop(path, None) is not None
        self._save()
        return removed

    # ---- 测试辅助 ----

    def is_registered(self, path: str) -> bool:
        return path in self._entries

    def entry(self, path: str) -> ServerEntry | None:
        return self._entries.get(path)

    @property
    def paths(self) -> list[str]:
        return sorted(self._entries)

    # ---- 落盘（可选） ----

    def _load(self) -> None:
        if self._persist_path is None or not self._persist_path.exists():
            return
        doc = json.loads(self._persist_path.read_text(encoding="utf-8"))
        for item in doc.get("entries", []):
            entry = ServerEntry(
                path=item["path"],
                target_url=item["target_url"],
                display_name=item.get("display_name"),
            )
            self._entries[entry.path] = entry

    def _save(self) -> None:
        if self._persist_path is None:
            return
        doc = {
            "entries": [
                {
                    "path": e.path,
                    "target_url": e.target_url,
                    "display_name": e.display_name,
                }
                for e in self._entries.values()
            ]
        }
        self._persist_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._persist_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self._persist_path)
