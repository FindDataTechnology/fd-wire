"""cell-manager 配置：全部 env 可配（README「借用契约」同款纪律）。

布局（单一 home 之下，卷与簿记分离）::

    <home>/volumes/<customer_id>/daas.db   # 每 cell 独立数据卷（平台侧永不直读）
    <home>/state/cells.json                # 生命周期簿记（原子写）
    <home>/audit/audit.log                 # JSONL 审计留档（append-only）

环境变量::

    CELL_MANAGER_HOME      管理面根目录（默认 ~/.fd-wire/cell-manager）
    CELL_DATA_ROOT         数据卷根（默认 <home>/volumes）
    CELL_STATE_FILE        簿记文件（默认 <home>/state/cells.json）
    CELL_AUDIT_LOG         审计日志（默认 <home>/audit/audit.log）
    CELL_IMAGE             cell 容器镜像（占位默认，部署时指 TCR 真实镜像）
    CELL_GATEWAY_URL       注入容器的 WIRE_GATEWAY_URL（wire 入口，计量门）
    CELL_REGISTRY_URL      registry 借用契约地址（注册 server 条目用）
    CELL_REGISTRY_MODE     registry client 形态：http | fake（默认 http）
    CELL_REGISTRY_AUTH/TOKEN/COOKIE/CSRF  http 模式鉴权（见 registry/http.py::auth_from_env）
    CELL_TARGET_URL_TEMPLATE  registry 条目 target 模板（{container_name} 占位）
    CELL_RETENTION_DAYS    注销保留期天数（默认 30，0=立即到期）
    CELL_DRIVER            容器驱动：docker | fake（默认 docker）
"""

from __future__ import annotations

import re
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from .errors import ConfigError, InvalidCustomerIdError

#: customer_id 白名单：字母数字开头，仅 [A-Za-z0-9._-]，长度 1..64。
#: 首字符必须字母数字，天然排除 "." / ".." / 绝对路径等路径逃逸形态。
_CUSTOMER_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

#: registry server 条目路径与容器名共用前缀（wire 入口同门计量，任务 5.2 对齐）
CELL_NAME_PREFIX = "fd-wire-cell-"

DEFAULT_IMAGE = "registry.tencentyun.com/finddata/fd-daas-mcp:placeholder"
DEFAULT_GATEWAY_URL = "https://wire.finddatatech.cloud/mcp"
DEFAULT_REGISTRY_URL = "https://mcp.finddatatech.cloud"
DEFAULT_TARGET_URL_TEMPLATE = "http://{container_name}:8000/mcp"
DEFAULT_RETENTION_DAYS = 30


def validate_customer_id(customer_id: str) -> str:
    """校验并原样返回 customer_id；不合法即抛 ``InvalidCustomerIdError``。"""
    if not isinstance(customer_id, str) or not _CUSTOMER_ID_RE.match(customer_id):
        raise InvalidCustomerIdError(
            f"invalid customer_id {customer_id!r}: must match "
            r"[A-Za-z0-9][A-Za-z0-9._-]{0,63} (alnum start, no path separators)"
        )
    return customer_id


@dataclass(frozen=True)
class CellManagerConfig:
    """运行时配置（不可变；``from_env`` 构造，测试可直构或注入 env mapping）。"""

    home: Path
    data_root: Path
    state_file: Path
    audit_log: Path
    image: str
    gateway_url: str
    registry_url: str
    registry_mode: str
    target_url_template: str
    retention_days: int
    driver_name: str

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "CellManagerConfig":
        """从环境（或注入的 mapping，测试用）构造；非法取值抛 ``ConfigError``。"""
        e = dict(os.environ if env is None else env)
        home = Path(e.get("CELL_MANAGER_HOME") or Path.home() / ".fd-wire" / "cell-manager")
        data_root = Path(e.get("CELL_DATA_ROOT") or home / "volumes")
        state_file = Path(e.get("CELL_STATE_FILE") or home / "state" / "cells.json")
        audit_log = Path(e.get("CELL_AUDIT_LOG") or home / "audit" / "audit.log")
        raw_days = e.get("CELL_RETENTION_DAYS", str(DEFAULT_RETENTION_DAYS))
        try:
            retention_days = int(raw_days)
        except ValueError as exc:
            raise ConfigError(f"CELL_RETENTION_DAYS must be an integer, got {raw_days!r}") from exc
        if retention_days < 0:
            raise ConfigError(f"CELL_RETENTION_DAYS must be >= 0, got {retention_days}")
        driver_name = e.get("CELL_DRIVER", "docker").strip().lower()
        if driver_name not in ("docker", "fake"):
            raise ConfigError(f"CELL_DRIVER must be 'docker' or 'fake', got {driver_name!r}")
        registry_mode = e.get("CELL_REGISTRY_MODE", "http").strip().lower()
        if registry_mode not in ("http", "fake"):
            raise ConfigError(f"CELL_REGISTRY_MODE must be 'http' or 'fake', got {registry_mode!r}")
        return cls(
            home=home,
            data_root=data_root,
            state_file=state_file,
            audit_log=audit_log,
            image=e.get("CELL_IMAGE") or DEFAULT_IMAGE,
            gateway_url=e.get("CELL_GATEWAY_URL") or DEFAULT_GATEWAY_URL,
            registry_url=e.get("CELL_REGISTRY_URL") or DEFAULT_REGISTRY_URL,
            registry_mode=registry_mode,
            target_url_template=e.get("CELL_TARGET_URL_TEMPLATE") or DEFAULT_TARGET_URL_TEMPLATE,
            retention_days=retention_days,
            driver_name=driver_name,
        )

    # ---- 派生命名（隔离保证：每 cell 独立卷目录 + 独立容器名 + 独立条目路径） ----

    def volume_dir(self, customer_id: str) -> Path:
        return self.data_root / validate_customer_id(customer_id)

    def container_name(self, customer_id: str) -> str:
        return CELL_NAME_PREFIX + validate_customer_id(customer_id)

    def registry_path(self, customer_id: str) -> str:
        return CELL_NAME_PREFIX + validate_customer_id(customer_id)

    def target_url(self, customer_id: str) -> str:
        return self.target_url_template.format(container_name=self.container_name(customer_id))
