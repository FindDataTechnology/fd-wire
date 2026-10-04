"""计量管道配置（全部 env 可覆盖，独立于 config.py 的借用契约端点）。

环境变量一览：

- ``DATABASE_URL``：计量库连接串，默认 ``sqlite:///./fd_wire_dev.db``；
  测试指向临时文件或内存库。
- ``METERING_INGEST_TOKEN``：``POST /internal/metering/events`` 与轮询触发
  端点的 bearer 校验令牌；未配置时推送端点 fail-closed（403），
  部署时必须显式提供。
- ``PLATFORM_IDENTITIES``：平台服务身份名单（逗号分隔的 username，
  大小写不敏感）。命中的调用 → credential_track=platform，
  否则 customer（AI 探索调用不计入客户账单的归属依据）。
- ``METERING_SOURCE_MAP``：来源标记映射表，``server=yizuo,wanxing-mcp=wanxing``
  形式（也接受 JSON 对象）。命中 server（精确或前缀 ``name*``）→ 对应
  source；platform 轨道恒为 ``platform-internal``；其余 ``customer``。
- ``REGISTRY_MONGO_URI`` / ``REGISTRY_MONGO_DB`` /
  ``REGISTRY_MONGO_COLLECTION``：registry Mongo 直读轮询（可选路径）；
  URI 未配置时该路径禁用。
- ``METERING_POLL_LIMIT``：单次轮询批量上限，默认 500。
- ``METERING_AUTO_CREATE_TABLES``：启动时 ``create_all``（默认 true，
  便于开发；生产用 Alembic 迁移并可关闭）。
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: source 标记的合法取值（wire-facade-metering 规格口径）
ALLOWED_SOURCES: tuple[str, ...] = ("yizuo", "wanxing", "platform-internal", "customer")

#: 凭据轨道的合法取值
ALLOWED_TRACKS: tuple[str, ...] = ("platform", "customer")


def _parse_source_map(raw: str | dict[str, str] | None) -> dict[str, str]:
    """把 env 串（``a=x,b=y`` 或 JSON 对象）解析为 server → source 映射。"""
    if not raw:
        return {}
    if isinstance(raw, dict):
        pairs = raw
    else:
        text = raw.strip()
        if text.startswith("{"):
            pairs = json.loads(text)
        else:
            pairs = {}
            for chunk in text.split(","):
                chunk = chunk.strip()
                if not chunk:
                    continue
                if "=" not in chunk:
                    raise ValueError(f"METERING_SOURCE_MAP 片段缺少 '=': {chunk!r}")
                key, _, value = chunk.partition("=")
                pairs[key.strip()] = value.strip()
    for key, value in pairs.items():
        if value not in ALLOWED_SOURCES:
            raise ValueError(
                f"METERING_SOURCE_MAP[{key!r}]={value!r} 不在允许集合 {ALLOWED_SOURCES}"
            )
    return dict(pairs)


class MeteringSettings(BaseSettings):
    """计量管道运行时配置：同名环境变量优先。"""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./fd_wire_dev.db"
    metering_ingest_token: str | None = None
    platform_identities: str = ""
    metering_source_map: str = ""
    registry_mongo_uri: str | None = None
    registry_mongo_db: str | None = None
    registry_mongo_collection: str = "audit_events"
    metering_poll_limit: int = 500
    metering_auto_create_tables: bool = True

    @field_validator("metering_source_map")
    @classmethod
    def _validate_source_map(cls, v: str) -> str:
        _parse_source_map(v)  # 仅校验，保留原始串
        return v

    def platform_identity_set(self) -> frozenset[str]:
        """平台服务身份名单（小写精确匹配）。"""
        return frozenset(
            name.strip().lower() for name in self.platform_identities.split(",") if name.strip()
        )

    def source_map(self) -> dict[str, str]:
        """server → source 映射（解析后的 dict）。"""
        return _parse_source_map(self.metering_source_map)


@lru_cache(maxsize=1)
def get_settings() -> MeteringSettings:
    """进程内单例；测试用 ``reset_metering_runtime()`` 后重设 env 再取。"""
    return MeteringSettings()


def describe() -> dict[str, Any]:
    """当前生效的计量配置一览（不含令牌明文，排障用）。"""
    s = get_settings()
    return {
        "database_url": s.database_url,
        "ingest_token_configured": bool(s.metering_ingest_token),
        "platform_identities": sorted(s.platform_identity_set()),
        "source_map": s.source_map(),
        "registry_mongo_configured": bool(s.registry_mongo_uri and s.registry_mongo_db),
        "registry_mongo_collection": s.registry_mongo_collection,
        "poll_limit": s.metering_poll_limit,
    }
