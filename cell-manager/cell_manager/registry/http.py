"""HttpRegistryClient：registry 借用契约的 HTTP 形态（stdlib urllib，零依赖）。

**契约占位声明**：registry fork 的 server 条目管理 API 由任务 2.x/5.2 定形，
本客户端按「借用契约」纪律实现（端点 env 可重指、默认占位），
联调时只需对齐路径/字段名——manager 与测试不感知。
端点::

    POST   {CELL_REGISTRY_URL}{CELL_REGISTRY_SERVERS_PATH  默认 /api/servers}
    DELETE {CELL_REGISTRY_URL}{CELL_REGISTRY_SERVERS_PATH}/{path}
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Mapping

from cell_manager.errors import RegistryError
from cell_manager.registry.base import ServerEntry

DEFAULT_SERVERS_PATH = "/api/servers"
_TIMEOUT = 10  # 秒


class HttpRegistryClient:
    """urllib 实现的 registry client（真实 HTTP；测试一律用 FakeRegistryClient）。"""

    def __init__(
        self,
        base_url: str,
        *,
        servers_path: str | None = None,
        token: str | None = None,
        timeout: float = _TIMEOUT,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._servers_path = servers_path or DEFAULT_SERVERS_PATH
        self._token = token
        self._timeout = timeout

    def register(self, entry: ServerEntry) -> None:
        payload = json.dumps(entry.to_payload()).encode("utf-8")
        # 幂等：已注册同 path 同 target 的 409 视为成功
        self._request("POST", self._servers_path, data=payload, ok=(200, 201, 204, 409))

    def unregister(self, path: str) -> bool:
        # 404 = 本就不存在 → 宽松返回 False（与 FakeClient 语义一致）
        status = self._request("DELETE", f"{self._servers_path}/{path}", ok=(200, 202, 204, 404))
        return status != 404

    # ---- 内部 ----

    def _request(self, method: str, path: str, *, data: bytes | None = None, ok: tuple[int, ...]) -> int:
        url = f"{self._base}{path}"
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                status = resp.status
                resp.read()
        except urllib.error.HTTPError as exc:
            status = exc.code
            if status not in ok:
                raise RegistryError(
                    f"registry {method} {url} -> HTTP {status}: {exc.read()[:200]!r}"
                ) from exc
        except urllib.error.URLError as exc:
            raise RegistryError(f"registry {method} {url} unreachable: {exc.reason}") from exc
        if status not in ok:
            raise RegistryError(f"registry {method} {url} -> unexpected HTTP {status}")
        return status


def registry_env_overrides(env: Mapping[str, str]) -> dict[str, str | None]:
    """从 env 提取可重指契约项（供工厂读取；缺省走占位）。"""
    return {
        "servers_path": env.get("CELL_REGISTRY_SERVERS_PATH"),
        "token": env.get("CELL_REGISTRY_TOKEN"),
    }
