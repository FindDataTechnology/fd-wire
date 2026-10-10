"""产物生命周期 API 路由（wire-artifacts-persistence）。

客户侧（Bearer ID token → logto_sub → Customer，与 ai/datasets 切片
同款身份键 ``require_console_customer_id``）：

- ``GET  /api/v1/artifacts``                 本企业产物列表（kind/status 过滤、更新倒序）
- ``GET  /api/v1/artifacts/{id}``             产物详情（他企一律 404）
- ``PUT  /api/v1/artifacts/{id}``             spec 更新（最小校验 → 追加新版本）
- ``GET  /api/v1/artifacts/{id}/versions``     版本历史（append-only，新在前）
- ``GET  /api/v1/artifacts/{id}/versions/{n}`` 查看任一历史版本
- ``POST /api/v1/artifacts/{id}/publish``      发布（draft → published）
- ``POST /api/v1/artifacts/{id}/archive``      归档（→ archived，不删除）
- ``POST /api/v1/artifacts/{id}/restore``      恢复（archived → draft）
- ``POST /api/v1/artifacts/{id}/refresh``      手动刷新（wire-dashboard-refresh：
                                               仅 dashboard；≥1 面板带合法 query
                                               → 契约路径零 LLM 确定性重取
                                               （wire-dashboard-query-contract），
                                               否则 AI 无头轮按面板 source 取数
                                               → 新版本落盘）
- ``POST /api/v1/artifacts/from-draft``        会话草稿导入为 draft 产物

版本行只读——没有任何改写历史版本的端点（append-only 由路由面保证）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..ai.db import get_db
from ..ai.executor import CELL_NOT_PROVISIONED_MESSAGE, CellNotProvisionedError
from ..ai.protocols import LlmClient, ToolExecutor
# LLM/工具执行依赖直接复用 ai 路由的出口函数（同一依赖对象——测试照
# test_ai_api 的 dependency_overrides 手法注入 mock，生产同为网关/cell 实现）。
from ..ai.routes import get_llm_client, get_tool_executor
from ..ai.settings import get_settings
from ..console.auth import require_console_customer_id
from ..datasets.db import get_db as get_datasets_db
from ..datasets.ingest import EngineClientFactory, get_engine_client_factory
from . import query_contract, refresh, service
from .models import ArtifactStatus
from .schemas import (
    ArtifactDetailOut,
    ArtifactFromDraftIn,
    ArtifactOut,
    ArtifactRefreshOut,
    ArtifactUpdateIn,
    ArtifactVersionDetailOut,
    ArtifactVersionOut,
    artifact_detail,
    version_detail,
)

router = APIRouter(tags=["artifacts"])


def _artifact_or_404(db: Session, artifact_id: int, customer_id: str):
    try:
        return service.get_customer_artifact(
            db, artifact_id=artifact_id, customer_id=customer_id
        )
    except service.ArtifactNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/api/v1/artifacts", response_model=list[ArtifactOut])
def list_artifacts(
    kind: str | None = Query(default=None),
    artifact_status: str | None = Query(default=None, alias="status"),
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> list[ArtifactOut]:
    """本企业产物列表（按更新时间倒序；kind/status 可选过滤）。"""
    rows = service.list_artifacts(
        db, customer_id=customer_id, kind=kind, status=artifact_status
    )
    return [ArtifactOut.model_validate(a) for a in rows]


@router.get("/api/v1/artifacts/{artifact_id}", response_model=ArtifactDetailOut)
def get_artifact(
    artifact_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> ArtifactDetailOut:
    """产物详情（当前 spec + 状态迁移记录；他企或不存在一律 404）。"""
    artifact = _artifact_or_404(db, artifact_id, customer_id)
    return artifact_detail(artifact, service.current_spec(db, artifact))


@router.put("/api/v1/artifacts/{artifact_id}", response_model=ArtifactDetailOut)
def update_artifact(
    artifact_id: int,
    payload: ArtifactUpdateIn,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> ArtifactDetailOut:
    """spec 更新：最小校验通过后追加新版本并递增计数（archived 拒改 409）。"""
    artifact = _artifact_or_404(db, artifact_id, customer_id)
    try:
        artifact = service.update_spec(
            db, artifact, spec=payload.spec, customer_id=customer_id
        )
    except service.ArtifactLocked as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except service.InvalidArtifactSpec as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return artifact_detail(artifact, service.current_spec(db, artifact))


@router.get(
    "/api/v1/artifacts/{artifact_id}/versions",
    response_model=list[ArtifactVersionOut],
)
def list_versions(
    artifact_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> list[ArtifactVersionOut]:
    """版本历史（新版本在前；历史版本 append-only 不可改）。"""
    artifact = _artifact_or_404(db, artifact_id, customer_id)
    rows = service.list_versions(db, artifact)
    return [ArtifactVersionOut.model_validate(r) for r in rows]


@router.get(
    "/api/v1/artifacts/{artifact_id}/versions/{version}",
    response_model=ArtifactVersionDetailOut,
)
def get_version(
    artifact_id: int,
    version: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> ArtifactVersionDetailOut:
    """查看任一历史版本（含该版本 spec 快照）。"""
    artifact = _artifact_or_404(db, artifact_id, customer_id)
    try:
        row = service.get_version(db, artifact, version)
    except service.ArtifactNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return version_detail(row)


def _transition(artifact_id: int, action: str, customer_id: str, db: Session):
    """状态迁移端点共用骨架：取产物 → 迁移 → 404/409 语义映射。"""
    artifact = _artifact_or_404(db, artifact_id, customer_id)
    handler = {
        "publish": service.publish_artifact,
        "archive": service.archive_artifact,
        "restore": service.restore_artifact,
    }[action]
    try:
        artifact = handler(db, artifact, customer_id=customer_id)
    except service.InvalidStatusTransition as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return artifact_detail(artifact, service.current_spec(db, artifact))


@router.post("/api/v1/artifacts/{artifact_id}/publish", response_model=ArtifactDetailOut)
def publish_artifact(
    artifact_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> ArtifactDetailOut:
    """发布：draft → published（非法迁移 409 说明合法路径）。"""
    return _transition(artifact_id, "publish", customer_id, db)


@router.post("/api/v1/artifacts/{artifact_id}/archive", response_model=ArtifactDetailOut)
def archive_artifact(
    artifact_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> ArtifactDetailOut:
    """归档：draft/published → archived（不删除，留操作记录）。"""
    return _transition(artifact_id, "archive", customer_id, db)


@router.post("/api/v1/artifacts/{artifact_id}/restore", response_model=ArtifactDetailOut)
def restore_artifact(
    artifact_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> ArtifactDetailOut:
    """恢复：archived → draft（唯一回退边；恢复后方可再编辑/发布）。"""
    return _transition(artifact_id, "restore", customer_id, db)


@router.post(
    "/api/v1/artifacts/from-draft",
    status_code=status.HTTP_201_CREATED,
    response_model=ArtifactDetailOut,
)
def import_from_draft(
    payload: ArtifactFromDraftIn,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> ArtifactDetailOut:
    """会话草稿导入：固化为 draft 产物（version=1，保留来源会话指针）。

    会话不存在/非本人、草稿不存在一律 404（不泄露他企存在性）。
    """
    try:
        artifact = service.import_from_draft(
            db,
            customer_id=customer_id,
            conversation_id=payload.conversation_id,
            draft_id=payload.draft_id,
        )
    except service.ArtifactNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except service.InvalidArtifactSpec as exc:  # pragma: no cover - 防御位
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return artifact_detail(artifact, service.current_spec(db, artifact))


def _release(client: object) -> None:
    """释放带 close() 的依赖客户端（生产网关/执行器；测试假件无 close）。"""
    if hasattr(client, "close"):
        client.close()


@router.post(
    "/api/v1/artifacts/{artifact_id}/refresh", response_model=ArtifactRefreshOut
)
def refresh_artifact(
    artifact_id: int,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
    datasets_db: Session = Depends(get_datasets_db),
    llm: LlmClient = Depends(get_llm_client),
    tool_executor: ToolExecutor = Depends(get_tool_executor),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> ArtifactRefreshOut:
    """手动刷新：契约决策——≥1 面板带合法 query → 契约路径（确定性逐面板
    执行，零 LLM，响应 mode=contract + 逐面板结果）；0 个 → AI 无头轮按
    各面板 source 重取数（mode=ai，既有行为零漂移）。两路成功后同 PUT
    语义落新版本（append-only + 审计）。

    语义边界：跨客户 404；kind≠dashboard 403；archived 409（先恢复）；
    同产物刷新进行中再触发 409（进程内单飞锁，两路共用）；AI 路径无
    cell 403 档位提示（零引擎调用）；LLM/引擎失败或契约全面板失败 502
    带原因——**失败零半写**（任何失败都不产生新版本行）。
    """
    artifact = _artifact_or_404(db, artifact_id, customer_id)
    if artifact.kind != "dashboard":
        raise HTTPException(
            status_code=403,
            detail=(
                f"产物 {artifact.id} 是 {artifact.kind}，仅仪表盘（dashboard）"
                "支持数据刷新。"
            ),
        )
    if artifact.status == ArtifactStatus.archived.value:
        raise HTTPException(
            status_code=409,
            detail=(
                f"产物 {artifact.id} 已归档（archived），不可刷新——"
                "请先恢复（restore）为草稿后再刷新。"
            ),
        )
    if not refresh.acquire_refresh_lock(artifact.id):
        raise HTTPException(
            status_code=409,
            detail=(
                f"产物 {artifact.id} 正在刷新中，请稍候再试"
                "（同一产物同时仅允许一次刷新）"
            ),
        )
    try:
        # 契约决策（锁内看当前版本）：≥1 合法 query 面板 → 确定性路径，
        # 不触碰 llm/tool_executor；空计划（旧看板/全非法 query）→ AI 轮。
        current = service.current_spec(db, artifact)
        if query_contract.contract_refresh_plan(current):
            # 契约路径查 datasets 表 → 必须用 datasets 库会话（生产
            # wire_platform/wire_datasets 分库，ai 会话落不到表）。
            new_spec, panel_results = query_contract.refresh_spec_with_contracts(
                datasets_db,
                spec=current,
                customer_id=customer_id,
                engine_factory=engine_factory,
            )
            mode, panels = "contract", panel_results
        else:
            new_spec = refresh.refresh_dashboard_spec(
                current_spec=current,
                llm=llm,
                tool_executor=tool_executor,
                customer_id=customer_id,
                max_turns=get_settings().ai_max_turns,
            )
            mode, panels = "ai", None
        # 成功才落盘：同 PUT 语义（契约路径快照即终态、AI 轮内已做最小
        # 校验，此处追加新版本行 + operator 审计 + title 投影）。
        artifact = service.update_spec(db, artifact, spec=new_spec, customer_id=customer_id)
    except CellNotProvisionedError:
        # 无 cell（免费档，仅 AI 路径会走到）：沿用 AI 构建的未开通档位提示。
        raise HTTPException(
            status_code=403, detail=CELL_NOT_PROVISIONED_MESSAGE
        )
    except refresh.RefreshFailed as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except service.InvalidArtifactSpec as exc:  # pragma: no cover - 轮内已校验
        raise HTTPException(status_code=502, detail=f"刷新输出未过校验：{exc}") from exc
    except service.ArtifactLocked as exc:  # pragma: no cover - 竞态归档防御位
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    finally:
        refresh.release_refresh_lock(artifact.id)
        _release(llm)
        _release(tool_executor)
    return ArtifactRefreshOut(
        version=artifact.version,
        refreshed_at=service.utc_now_iso(),
        mode=mode,
        panels=panels,
    )
