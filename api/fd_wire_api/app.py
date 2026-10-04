"""FastAPI 入口：`uvicorn fd_wire_api.app:app`。"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import __version__
from .catalog import init_db as init_catalog_db
from .catalog import register_catalog
from .catalog import shutdown_catalog, startup_catalog
from .config import settings
from .demands import init_db as init_demands_db
from .demands import router as demands_router
from .metering.db import ensure_schema
from .metering.settings import get_settings
from .metering.routes import router as metering_router
from .routes import example


@asynccontextmanager
async def lifespan(_: FastAPI):
    """启动钩子：计量表幂等建表（可经 METERING_AUTO_CREATE_TABLES 关闭，生产走 Alembic）。"""
    if get_settings().metering_auto_create_tables:
        ensure_schema()
    # 需求单表建表：迁移链落地前 create_all 兜底（幂等，checkfirst）。
    init_demands_db()
    # 指标目录镜像（任务 6.1）：幂等建表 + 每日同步调度（显式 lifespan 下
    # register_catalog 挂的 add_event_handler 不会触发，故在此显式调）。
    init_catalog_db()
    startup_catalog()
    try:
        yield
    finally:
        shutdown_catalog()


app = FastAPI(
    title="fd-wire-api",
    version=__version__ or "0.1.0",
    description="柏讯（wire）平台 API——结算/后台服务骨架",
    lifespan=lifespan,
)

app.include_router(example.router)
app.include_router(metering_router)
app.include_router(demands_router)
# 指标目录镜像（任务 6.1）：公开目录查询 + internal 同步触发 + 每日调度
register_catalog(app)


@app.get("/health")
def health() -> dict:
    """存活探针：部署链（ArgoCD/Caddy）与健康检查消费。"""
    return {"status": "ok", "service": "fd-wire-api", "version": app.version}
