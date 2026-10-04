"""指标目录镜像的运行时配置。

全部 env 可重指（与仓级「借用契约」纪律一致）：
- ``INDICATOR_REGISTRY_URL``：权威源（fd-open-data-mcp 侧 list_concepts 族）基地址；
  MCP streamable-http 的 ``/mcp`` 后缀由客户端自动补齐。
- ``INDICATOR_REGISTRY_TOKEN``：权威源 Bearer 凭据（公网 MCP 入口鉴权）；空 = 匿名。
- ``CATALOG_DATABASE_URL``：镜像库专用覆盖（缺省落平台库，见下）。
- ``DATABASE_URL``：平台库（计量迁移链 ``api/alembic`` 管理的库）；
  未显式给 ``CATALOG_DATABASE_URL`` 时镜像表建在这里。
- ``CATALOG_INTERNAL_TOKEN``：内部手动触发同步的 token；为空时触发端点一律拒绝。
- ``CATALOG_SYNC_INTERVAL_SECONDS``：同步循环间隔，默认 24h。
- ``CATALOG_SYNC_ENABLED`` / ``CATALOG_SYNC_ON_STARTUP``：调度开关与启动即同步。
"""

from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_INTERVAL_SECONDS = 24 * 60 * 60  # 每日
_DEFAULT_PLATFORM_DB = "sqlite:///./fd_wire_dev.db"


class CatalogSettings(BaseSettings):
    """目录镜像设置：同名环境变量优先。"""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # 权威源（统一指标注册目录 / fd-open-data-mcp 的 list_concepts 族）。
    # 缺省指向网内权威副本（与权威库同一 Postgres）；公网入口
    # https://mcp.finddatatech.cloud/fd-open-data-mcp 亦可（走网关鉴权，
    # 需 INDICATOR_REGISTRY_TOKEN）。/mcp 后缀由客户端自动补齐。
    indicator_registry_url: str = "http://fd-open-data-mcp.fd-prod.svc:8300"
    # 权威源 Bearer 凭据（公网 MCP 入口鉴权；空 = 匿名，网内副本即匿名）
    indicator_registry_token: str = ""
    # 镜像库连接串：显式给 CATALOG_DATABASE_URL 则用之；否则跟随平台库 DATABASE_URL
    catalog_database_url: str | None = None
    # 平台库（alembic 迁移链 0002_catalog 落镜像表于此）
    database_url: str | None = None
    # 手动触发同步的 internal token
    catalog_internal_token: str = ""
    # 调度
    catalog_sync_interval_seconds: float = float(_DEFAULT_INTERVAL_SECONDS)
    catalog_sync_enabled: bool = True
    catalog_sync_on_startup: bool = True
    # 启动即同步前的小额宽限（避开极短生命周期的进程）
    catalog_sync_startup_grace_seconds: float = 10.0

    @property
    def sync_interval_seconds(self) -> float:
        return max(1.0, self.catalog_sync_interval_seconds)

    @property
    def startup_grace_seconds(self) -> float:
        return max(0.0, self.catalog_sync_startup_grace_seconds)

    @property
    def effective_database_url(self) -> str:
        if self.catalog_database_url:
            return self.catalog_database_url
        if self.database_url:
            return self.database_url
        return _DEFAULT_PLATFORM_DB


settings = CatalogSettings()
