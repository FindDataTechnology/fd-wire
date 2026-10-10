"""签名分享链接 API 路由（wire-dashboard-share）。

- ``POST /api/v1/artifacts/{id}/share``（Bearer ID token → Customer，
  与 artifacts 路由同款身份键 ``require_console_customer_id``）：
  仅 published 且 kind=dashboard 的产物可分享（否则 403 明确说明）；
  跨客户一律 404（不泄露他企存在性）。
- ``GET  /api/v1/share/dashboard/{artifact_id}?t=…&v=…``（公开无鉴权）：
  验签 + v 与令牌内版本一致 + 产物仍 published + 钉死版本行在场，
  任一不满足一律 404（detail 统一 "not found"，不泄露差异）。

两端正点共用一把锁：``FD_WIRE_SHARE_SECRET`` 未配置 → 503 detail 带原因
（逐请求惰性读 env，照 downloads 先例）。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..ai.db import get_db
from ..artifacts import service as artifacts_service
from ..console.auth import require_console_customer_id
from . import service

router = APIRouter(tags=["share"])

#: 公开端点统一失败口径：不带原因差异（未认证方不借此探测链接状态）。
_NOT_FOUND_DETAIL = "not found"


#: 有效期枚举（wire-share-ttl-options）：天数三选一，缺省 30
ALLOWED_TTL_DAYS: tuple[int, ...] = (7, 30, 90)


class ShareCreateIn(BaseModel):
    """生成请求体（可选）：``ttl_days`` 有效期三选一（7|30|90，缺省 30）。"""

    ttl_days: int | None = None


class ShareLinkOut(BaseModel):
    """生成结果：相对 url（web 拼前缀即用）+ 到期时间 + 钉死的版本号。"""

    url: str
    expires_at: str
    version: int


class SharedDashboardOut(BaseModel):
    """公开打开结果：钉死版本的 spec 快照（信封原样：{title, spec:{…}}）。

    无 iat 侧字段可算 shared_at——省略之，以 expires_at 供前端展示到期。
    """

    title: str
    spec: Any
    version: int
    expires_at: str


def _share_disabled(exc: service.ShareDisabled) -> HTTPException:
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))


@router.post(
    "/api/v1/artifacts/{artifact_id}/share",
    response_model=ShareLinkOut,
)
def create_share_link(
    artifact_id: int,
    payload: ShareCreateIn | None = None,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> ShareLinkOut:
    """生成分享链接：钉死当前版本，有效期可选 7/30/90 天（缺省 30——
    FD_WIRE_SHARE_TTL_SECONDS 可覆盖缺省；显式 ttl_days 时以选择为准）。"""
    try:
        secret = service.require_share_secret()
    except service.ShareDisabled as exc:
        raise _share_disabled(exc) from exc
    # ttl_days 三态：缺省（无 body / 无字段）走 service 默认；显式给出则
    # 须在枚举内，否则 422 列出合法值（wire-share-ttl-options 1.1）
    if payload is None or payload.ttl_days is None:
        ttl = service.ttl_seconds()
    elif payload.ttl_days not in ALLOWED_TTL_DAYS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"ttl_days 仅支持 {'、'.join(str(d) for d in ALLOWED_TTL_DAYS)}"
                f"（天）——收到 {payload.ttl_days}"
            ),
        )
    else:
        ttl = payload.ttl_days * 24 * 3600
    try:
        artifact = artifacts_service.get_customer_artifact(
            db, artifact_id=artifact_id, customer_id=customer_id
        )
    except artifacts_service.ArtifactNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if artifact.kind != "dashboard":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"产物 {artifact.id} 是 {artifact.kind}，仅仪表盘（dashboard）"
                "产物支持生成分享链接。"
            ),
        )
    if artifact.status != "published":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"产物 {artifact.id} 当前状态 {artifact.status}，仅已发布"
                "（published）的仪表盘可分享——请先发布。"
            ),
        )
    token, exp = service.build_token(
        secret,
        artifact_id=artifact.id,
        version=artifact.version,
        ttl=ttl,
    )
    return ShareLinkOut(
        url=f"/api/v1/share/dashboard/{artifact.id}?t={token}&v={artifact.version}",
        expires_at=service.expires_at_iso(exp),
        version=artifact.version,
    )


@router.get(
    "/api/v1/share/dashboard/{artifact_id}",
    response_model=SharedDashboardOut,
)
def open_shared_dashboard(
    artifact_id: int,
    t: str | None = Query(default=None),
    v: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> SharedDashboardOut:
    """公开打开分享的仪表盘（无鉴权）：返回钉死版本的 spec 快照。

    缺 t/v、验签失败、版本不一致、过期、产物非 published/不存在、版本行
    缺席——一律 404 且 detail 统一（不向未认证方泄露差异）。
    """
    try:
        secret = service.require_share_secret()
    except service.ShareDisabled as exc:
        raise _share_disabled(exc) from exc
    if t is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND_DETAIL)
    try:
        version, exp = service.verify_token(
            secret, artifact_id=artifact_id, token=t, v_param=v
        )
    except service.ShareLinkInvalid:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND_DETAIL)
    artifact = service.get_published_artifact(db, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND_DETAIL)
    row = service.get_pinned_version(db, artifact_id, version)
    if row is None:  # pragma: no cover - 正常链路版本行总在场，防御位
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND_DETAIL)
    # 钉死版本的标题：优先取该版本 spec 信封的 title（快照自洽），
    # 缺席时回退产物当前 title。
    spec = dict(row.spec) if row.spec else {}
    title = spec.get("title")
    if not isinstance(title, str) or not title.strip():
        title = artifact.title
    return SharedDashboardOut(
        title=title,
        spec=spec,
        version=version,
        expires_at=service.expires_at_iso(exp),
    )
