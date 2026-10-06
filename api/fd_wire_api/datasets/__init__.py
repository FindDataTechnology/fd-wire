"""datasets 包：客户数据集登记/同步/修正面（wire-customer-local-data 任务组 2）。

- 客户面 ``router``：数据集 CRUD、上传建档、行预览、修正三件套、同步历史、
  漂移恢复、连接器管理（``X-Customer-Id`` 鉴权，跨企业 404）。
- 连接器面 ``connector_router``：配对/心跳/配置下发/推送三阶段
  （``Authorization: Bearer fwc_...``；key scope 仅推送 + 拉配置）
  + 内部只读概览（``X-Internal-Token``）。
- 引擎通道 ``ingest.EngineToolClient``：客户数据的一切读写都经该通道
  （平台服务凭据轨道，复用 AI_CELL_ENDPOINT_MAP / AI_PLATFORM_CREDENTIAL），
  未配置 fail-closed 502；平台侧永不直读 cell 数据卷。
- 表迁移链 ``alembic 0011``；启动 ``init_datasets_db`` 幂等兜底。

接线（FastAPI lifespan）：
```
from fd_wire_api.datasets import init_datasets_db, router, connector_router
app.include_router(router)
app.include_router(connector_router)
# lifespan 内：init_datasets_db()
```
"""

from __future__ import annotations

from .connector_routes import router as connector_router
from .db import DatasetsBase, get_db, get_session, init_db, reset_datasets_runtime
from .ingest import (
    EngineCallError,
    EngineToolClient,
    EngineUnavailable,
    get_engine_client_factory,
)
from .routes import router
from .settings import get_settings
from .uploads import UploadError, infer_type, iter_ingest_chunks

__all__ = [
    "DatasetsBase",
    "EngineCallError",
    "EngineToolClient",
    "EngineUnavailable",
    "UploadError",
    "connector_router",
    "get_db",
    "get_engine_client_factory",
    "get_session",
    "get_settings",
    "infer_type",
    "init_db",
    "iter_ingest_chunks",
    "reset_datasets_runtime",
    "router",
]


def init_datasets_db() -> None:
    """幂等建表（app lifespan 开发兜底；生产走 Alembic 0011）。"""
    init_db()