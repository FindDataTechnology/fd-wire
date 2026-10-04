"""FastAPI 入口：`uvicorn fd_wire_api.app:app`。"""

from fastapi import FastAPI

from . import __version__
from .config import settings
from .routes import example

app = FastAPI(
    title="fd-wire-api",
    version=__version__ or "0.1.0",
    description="柏讯（wire）平台 API——结算/后台服务骨架",
)

app.include_router(example.router)


@app.get("/health")
def health() -> dict:
    """存活探针：部署链（ArgoCD/Caddy）与健康检查消费。"""
    return {"status": "ok", "service": "fd-wire-api", "version": app.version}
