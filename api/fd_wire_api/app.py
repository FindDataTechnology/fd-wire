"""FastAPI 入口：`uvicorn fd_wire_api.app:app`。"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import __version__
from .admin import router as admin_router
from .ai import init_db as init_ai_db
from .ai import router as ai_router
# 产物生命周期（wire-artifacts-persistence）：/api/v1/artifacts 全端点
from .artifacts import router as artifacts_router
from .billing.routes import router as billing_router
from .catalog import init_db as init_catalog_db
from .catalog import register_catalog
from .catalog import shutdown_catalog, startup_catalog
from .config import settings
from .console import init_db as init_console_db
from .console import router as console_router
from .datasets import connector_router as datasets_connector_router
from .datasets import init_datasets_db
from .datasets import router as datasets_router
# 连接器分发的公开下载面（wire-connector-distribution 任务 1）
from .downloads import router as downloads_router
from .demands import admin_router as demands_admin_router
from .demands import init_db as init_demands_db
from .demands import pipeline_router as demands_pipeline_router
from .demands import router as demands_router
from .materialization import init_db as init_materialization_db
from .materialization import router as materialization_router
from .materialization import (
    start_materialization_scheduler,
    stop_materialization_scheduler,
)
from .provenance import router as provenance_router
from .provenance import init_provenance_db
from .provenance.forwarder import start_forwarder_loop, stop_forwarder_loop
from .provenance.sealing import start_sealer_loop, stop_sealer_loop
from .provenance.selfcheck import start_selfcheck_loop, stop_selfcheck_loop
from .metering.db import ensure_schema
from .metering.driver import start_metering_driver, stop_metering_driver
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
    # 计费（任务 4.2）：billing_* 三表 + 档位 seed（幂等；公开三档 + 旧三档
    # 禁用，见 billing/plans.py）。
    from .billing import init_billing

    init_billing()
    # 控制台域（wire-self-serve-launch 4.3）：console_onboardings 断点簿记表
    # 幂等建表兜底（生产走 alembic 0015）。
    init_console_db()
    # 内部后台（任务 7.1）：审核意见表幂等建表兜底（生产走 0007）。
    from .admin import init_db as init_admin_db

    init_admin_db()
    # AI 对话构建循环（任务 5.4）：对话/消息/产物暂存三表幂等建表兜底
    # （生产走 Alembic 迁移链 0005_ai）。
    init_ai_db()
    # 产物物化计量（任务 5.6）：转正登记表幂等建表兜底（生产走 0009）+
    # cron 调度循环（MATERIALIZATION_INTERVAL 扫描，硬停前置在 runner 内）。
    init_materialization_db()
    start_materialization_scheduler()
    # 计量入账驱动（sub2api 入账管道）：周期「registry 审计摄取 → 当月结算」。
    # REGISTRY_MONGO_URI / SUB2API_ADMIN_KEY 未配置时对应段自动跳过。
    start_metering_driver()
    # 客户数据集（wire-customer-local-data 任务组 2）：登记/同步/修正/上传
    # 表幂等建表兜底（生产走 Alembic 0011）。
    init_datasets_db()
    # 溯源账本（wire-provenance-ledger）：账本表兜底（生产走 Alembic 0012；
    # 含触发器安装）+ 三个后台任务——WAL 转发（引擎事件入账）、epoch 封存
    # （backend=none 时空转）、夜间完整性自检（只读）。
    init_provenance_db()
    start_forwarder_loop()
    start_sealer_loop()
    start_selfcheck_loop()
    try:
        yield
    finally:
        stop_selfcheck_loop()
        stop_sealer_loop()
        stop_forwarder_loop()
        stop_metering_driver()
        stop_materialization_scheduler()
        shutdown_catalog()


app = FastAPI(
    title="fd-wire-api",
    version=__version__ or "0.1.0",
    description="柏讯（wire）平台 API——结算/后台服务骨架",
    lifespan=lifespan,
)

app.include_router(example.router)
app.include_router(metering_router)
# billing 域路由（wire-self-serve-launch 1.3/3.1）：公开档位 + 内部额度查询
app.include_router(billing_router)
# 控制台面（wire-self-serve-launch 4.2/4.3/6.1）：登录配置下发 + 首登自动
# 开户 + 客户自助用量（Bearer ID token 身份）
app.include_router(console_router)
app.include_router(demands_router)
# 需求单 AI 预评估与人工报价（任务 6.4）：评估独立触发 + 确认台内部视图
app.include_router(demands_admin_router)
# 需求单流水线衔接与私有 scope 交付（任务 6.5/6.6）：流水线事实记录 +
# conformance gate 门禁 + 交付建客户私有 scope + 授权转公开
app.include_router(demands_pipeline_router)
# AI 对话构建循环（任务 5.4）：对话会话 + 构建循环 + 产物暂存端点
app.include_router(ai_router)
# 产物生命周期（wire-artifacts-persistence）：持久化/版本化/状态机
# （表与 ai 切片同引擎，create_all 兜底由 init_ai_db 覆盖；生产走 0021）
app.include_router(artifacts_router)
# 指标目录镜像（任务 6.1）：公开目录查询 + internal 同步触发 + 每日调度
register_catalog(app)
# 内部后台（任务 7.1）：客户/账本/需求单派发/目录治理/用量分轨
# （双闸鉴权 wire-self-serve-launch 5.1：X-Admin-Token + Bearer 角色闸；
# 未配置 fail-closed；表迁移走 alembic 0007）
app.include_router(admin_router)
# 产物物化计量（任务 5.6）：draft 转正 + 运行摘要内部端点
# （X-Internal-Token 鉴权，未配置 fail-closed；表迁移走 alembic 0009）
app.include_router(materialization_router)
# 客户数据集（wire-customer-local-data 任务组 2）：客户面（Bearer ID token，
# wire-self-serve-launch 4.5 身份切换）
app.include_router(datasets_router)

# REST 数据面（wire-customer-data-engine）：读写端点 + key 管理面 + 后台只读
from .data_plane import routes as data_plane_keys_routes  # noqa: E402
from .data_plane.data_routes import router as data_plane_router  # noqa: E402

app.include_router(data_plane_router)
app.include_router(data_plane_keys_routes.router)
app.include_router(data_plane_keys_routes.admin_router)
# 连接器面（Bearer fwc_...）与内部只读概览；客户数据读写全经引擎 MCP 通道
app.include_router(datasets_connector_router)
# 连接器分发的公开下载面（wire-connector-distribution 任务 1）：
# /api/v1/downloads/connector/*（manifest + 二进制；无鉴权——下载件不含
# 敏感数据；FD_WIRE_DOWNLOADS_DIR 未配置时诚实 404 并说明原因）
app.include_router(downloads_router)
# 溯源账本（wire-provenance-ledger 任务组 2）：客户面概览/时间线/状态/调档
# （Bearer 身份，4.5）+ 内部 ingest 入账端点（X-Provenance-Token）
app.include_router(provenance_router)


@app.get("/health")
def health() -> dict:
    """存活探针：部署链（ArgoCD/Caddy）与健康检查消费。"""
    return {"status": "ok", "service": "fd-wire-api", "version": app.version}
