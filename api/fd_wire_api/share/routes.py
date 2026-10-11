"""签名分享链接 API 路由（wire-dashboard-share；form 扩展 wire-form-builder）。

- ``POST /api/v1/artifacts/{id}/share``（Bearer ID token → Customer，
  与 artifacts 路由同款身份键 ``require_console_customer_id``）：
  仅 published 且 kind∈{dashboard, form} 的产物可分享（否则 403 明确说明）；
  url 按 kind 分派路径（dashboard → ``/api/v1/share/dashboard/…``、
  form → ``/api/v1/share/form/…``）；跨客户一律 404（不泄露他企存在性）。
- ``GET  /api/v1/share/dashboard/{artifact_id}?t=…&v=…``（公开无鉴权）：
  验签 + v 与令牌内版本一致 + 产物仍 published + 钉死版本行在场，
  任一不满足一律 404（detail 统一 "not found"，不泄露差异）。
- ``GET  /api/v1/share/form/{artifact_id}?t=…&v=…``（公开无鉴权，同形）：
  返回钉死版本 spec（仅字段定义与文案，零行数据——公开面只读不读数）。
- ``POST /api/v1/share/form/{artifact_id}/submit?t=…&v=…``（公开写-only 面，
  design D3 校验序）：secret（503）→ 令牌/published+kind=form/钉死版本行
  （统一 404）→ 按钉死版本 spec 校验 values（422 字段级）→ 令牌级限流
  （429 + Retry-After）→ datasets 库会话取数据集（统一 404）→ 经
  ``datasets.service.submit_insert_correction`` 落 insert 修正（actor=
  ``share-form:{artifact_id}``，与 corrections 端点同闸同审计）→ 201。

两端点共用一把锁：``FD_WIRE_SHARE_SECRET`` 未配置 → 503 detail 带原因
（逐请求惰性读 env，照 downloads 先例）。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..ai.db import get_db
from ..artifacts import service as artifacts_service
from ..artifacts.form_spec import validate_form_values
from ..artifacts.models import Artifact, ArtifactVersion
from ..console.auth import require_console_customer_id
from ..datasets import service as datasets_service
from ..datasets.api_store import LocalQueryError
from ..datasets.db import get_db as get_datasets_db
from ..datasets.ingest import (
    EngineCallError,
    EngineClientFactory,
    EngineUnavailable,
    get_engine_client_factory,
)
from ..datasets.models import Dataset
from ..datasets.routes import engine_failure
from . import rate_limit, service

router = APIRouter(tags=["share"])

#: 公开端点统一失败口径：不带原因差异（未认证方不借此探测链接状态）。
_NOT_FOUND_DETAIL = "not found"

#: 可分享 kind → 公开链接路径段（design D4：url 按 kind 分派）
SHARE_KIND_PATHS: dict[str, str] = {"dashboard": "dashboard", "form": "form"}


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


class SharedFormOut(BaseModel):
    """公开打开表单结果：与 SharedDashboardOut 同形（前端同款消费）。

    form 的 spec 内只有字段定义与文案（零行数据、零读路径——公开面
    write-only 的读侧仅限所有者主动发布的表单结构）。
    """

    title: str
    spec: Any
    version: int
    expires_at: str


class FormSubmitIn(BaseModel):
    """公开提交请求体：``values`` = 整行值（按钉死版本 spec 校验）。"""

    values: dict


class FormSubmitOut(BaseModel):
    """公开提交结果：``ok`` 恒 true（失败走 4xx/5xx），``message`` =
    钉死版本 successMessage（缺席回退缺省文案）。"""

    ok: bool = True
    message: str

#: 提交成功缺省文案（spec 未配 successMessage 时）
DEFAULT_SUCCESS_MESSAGE = "提交成功"


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
    # kind 门（design D4）：dashboard 只读渲染、form 只读渲染+公开提交；
    # 其余 kind（AI 产物四类等）仍不可分享。
    if artifact.kind not in SHARE_KIND_PATHS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"产物 {artifact.id} 是 {artifact.kind}，仅仪表盘（dashboard）与"
                "表单（form）产物支持生成分享链接。"
            ),
        )
    if artifact.status != "published":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"产物 {artifact.id} 当前状态 {artifact.status}，仅已发布"
                "（published）的产物可分享——请先发布。"
            ),
        )
    token, exp = service.build_token(
        secret,
        artifact_id=artifact.id,
        version=artifact.version,
        ttl=ttl,
    )
    return ShareLinkOut(
        url=(
            f"/api/v1/share/{SHARE_KIND_PATHS[artifact.kind]}/{artifact.id}"
            f"?t={token}&v={artifact.version}"
        ),
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


# ----------------------------------------------------- form 公开面（D3/D4）


def _not_found() -> HTTPException:
    """公开面统一 404（detail 恒 ``not found``——不泄露失败原因差异）。"""
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND_DETAIL)


def _load_shared_form(
    artifact_id: int, t: str | None, v: int | None, db: Session
) -> tuple[Artifact, ArtifactVersion, int, int]:
    """公开 form 端点共用的前置链（design D3 校验序前四步）。

    secret 在位（否则 503）→ 令牌验签 + v 一致 + 未过期（统一 404）→
    产物 published **且 kind=form**（统一 404——dashboard 令牌走不进 form
    路径，反之亦然）→ 钉死版本行在场（统一 404）。

    返回 ``(artifact, pinned_version_row, version, exp)``。
    """
    try:
        secret = service.require_share_secret()
    except service.ShareDisabled as exc:
        raise _share_disabled(exc) from exc
    if t is None:
        raise _not_found()
    try:
        version, exp = service.verify_token(
            secret, artifact_id=artifact_id, token=t, v_param=v
        )
    except service.ShareLinkInvalid:
        raise _not_found()
    artifact = service.get_published_artifact(db, artifact_id)
    if artifact is None or artifact.kind != "form":
        raise _not_found()
    row = service.get_pinned_version(db, artifact_id, version)
    if row is None:  # pragma: no cover - 正常链路版本行总在场，防御位
        raise _not_found()
    return artifact, row, version, exp


@router.get(
    "/api/v1/share/form/{artifact_id}",
    response_model=SharedFormOut,
)
def open_shared_form(
    artifact_id: int,
    t: str | None = Query(default=None),
    v: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> SharedFormOut:
    """公开打开分享的表单（无鉴权）：钉死版本 spec 快照（零行数据）。

    与公开 dashboard 端点同形同闸（缺 t/v、验签失败、版本不一致、过期、
    产物非 published/非 form/不存在、版本行缺席——一律 404 统一 detail）。
    """
    artifact, row, version, exp = _load_shared_form(artifact_id, t, v, db)
    spec = dict(row.spec) if row.spec else {}
    title = spec.get("title")
    if not isinstance(title, str) or not title.strip():
        title = artifact.title
    return SharedFormOut(
        title=title,
        spec=spec,
        version=version,
        expires_at=service.expires_at_iso(exp),
    )


@router.post(
    "/api/v1/share/form/{artifact_id}/submit",
    status_code=status.HTTP_201_CREATED,
    response_model=FormSubmitOut,
)
def submit_shared_form(
    artifact_id: int,
    payload: FormSubmitIn,
    t: str | None = Query(default=None),
    v: int | None = Query(default=None),
    db: Session = Depends(get_db),
    datasets_db: Session = Depends(get_datasets_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> FormSubmitOut:
    """公开提交一条记录（design D3 校验序，write-only 零读回）：

    1. secret 在位（503）；
    2. 令牌验签 + v 一致 + 未过期（统一 404）；
    3. 产物 published + kind=form（统一 404）；
    4. 钉死版本行在场（统一 404）；
    5. 按钉死版本 ``spec.spec.fields`` 校验 values（422 字段级文案；
       spec.spec 无 fields/非 form 形状 = 404 统一口径——改版不改令牌语义）；
    6. 令牌级滑动窗限流（429 + Retry-After；超限不落库）；
    7. datasets 库会话取数据集（datasetId null/不存在/他企 = 404 统一）；
    8. ``submit_insert_correction``（actor=``share-form:{artifact_id}``——
       修正历史/WAL 可归因到具体表单，与 corrections 端点同闸同审计）。

    异常转译照 corrections 范式：QuotaExceeded→429（quota 原因如实）、
    LocalQueryError→400（列漂移如实）、引擎错→502；全链零半写。
    """
    artifact, row, _version, _exp = _load_shared_form(artifact_id, t, v, db)
    envelope = row.spec if isinstance(row.spec, dict) else {}
    inner = envelope.get("spec")
    fields = inner.get("fields") if isinstance(inner, dict) else None
    if not isinstance(inner, dict) or not isinstance(fields, list):
        # 钉死版本非 form 形状（无字段定义可用）——统一口径，不泄露差异
        raise _not_found()
    normalized, error = validate_form_values(fields, payload.values)
    if error is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=error
        )
    # 限流键 = 令牌 mac 段（验签已保证三段格式；不存完整 token）
    allowed, retry_after = rate_limit.allow(rate_limit.mac_segment(t or ""))
    if not allowed:
        limit = rate_limit.rate_per_hour()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"提交过于频繁：本链接限每 {int(rate_limit.WINDOW_SECONDS // 60)} 分钟 "
                f"{limit} 次提交，请 {retry_after} 秒后重试。"
            ),
            headers={"Retry-After": str(retry_after)},
        )
    dataset_id = inner.get("datasetId")
    if not isinstance(dataset_id, str) or not dataset_id.strip():
        # 构建中间态（未绑数据集）不可提交——统一 404
        raise _not_found()
    dataset = datasets_db.get(Dataset, dataset_id)
    if dataset is None or dataset.customer_id != artifact.customer_id:
        raise _not_found()
    try:
        datasets_service.submit_insert_correction(
            datasets_db,
            dataset=dataset,
            values=normalized,
            actor=f"share-form:{artifact_id}",
            engine_factory=engine_factory,
        )
    except LocalQueryError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except datasets_service.QuotaExceeded as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"quota: {exc.reason}",
        ) from exc
    except (EngineUnavailable, EngineCallError) as exc:
        raise engine_failure(exc) from exc
    message = inner.get("successMessage")
    if not isinstance(message, str) or not message.strip():
        message = DEFAULT_SUCCESS_MESSAGE
    return FormSubmitOut(ok=True, message=message)
