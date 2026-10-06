"""客户数据集连接器面端点（契约 §3.3/§3.4）+ 内部只读概览。

连接器面（``Authorization: Bearer fwc_...``；不匹配/已吊销一律 401）：
- ``POST /api/v1/connectors/pair``：配对令牌换连接器 key（明文仅此一次）
- ``POST /api/v1/connector/heartbeat``：心跳 + 版本上报（在线态由心跳推导）
- ``GET  /api/v1/connector/config``：本连接器白名单数据集 + 调度 + 上限
  （响应**零凭据**：不下发任何 DSN/账密/key）
- ``POST /api/v1/connector/syncs`` 三阶段：begin → chunks → commit/abort
  （漂移与配额判定在 **api 侧**，破坏性变更不调引擎）

该 key 在客户面/MCP/计量读端点一律无效（scope 仅推送 + 拉配置）；
内部概览走 ``X-Internal-Token``，只读、无任何管理操作。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import service
from .db import get_db
from .ingest import (
    EngineCallError,
    EngineClientFactory,
    EngineUnavailable,
    TOOL_INGEST_ABORT,
    TOOL_INGEST_BEGIN,
    TOOL_INGEST_CHUNK,
    TOOL_INGEST_COMMIT,
    get_engine_client_factory,
)
from .models import Connector, ConnectorKey, ConnectorPairingToken, Dataset, DatasetSync
from .routes import drift_response, engine_failure, quota_response, require_internal
from .schemas import (
    AbortOut,
    ChunkIn,
    ChunkOut,
    CommitOut,
    HeartbeatIn,
    HeartbeatOut,
    InternalConnectorOut,
    InternalOverviewOut,
    PairIn,
    PairOut,
    SyncBeginIn,
    SyncBeginOut,
)
from .settings import get_settings

router = APIRouter(tags=["datasets-connectors"])

#: 推送会话（begin 建档；chunk/commit 查回；abort 清理）。跨请求进程内映射：
#: api 单实例部署；服务重启后会话失效，abort 仍可清理登记行（幂等）。
_SYNC_SESSIONS: dict[str, "SyncSession"] = {}


@dataclass
class SyncSession:
    """一次推送的引擎侧状态（dataset_syncs 行只存可展示字段）。"""

    sync_id: str
    dataset_id: str
    connector_id: str
    engine_ingest_id: str
    schema: list[dict] = field(default_factory=list)
    next_chunk_index: int = 0
    start_index: int = 0
    estimated_bytes: int = 0


# ------------------------------------------------------------------ 鉴权


def _bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="缺少 Authorization: Bearer 连接器 key")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Authorization 需为 Bearer <连接器 key>")
    return token.strip()


def require_connector_key(
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> Connector:
    """连接器 key 鉴权：sha256 恒定时间比对；吊销即时生效（401）。

    key 只认 ``fwc_`` 前缀；该 key 不构成任何客户/MCP 读取身份。
    """
    token = _bearer_token(authorization)
    if not token.startswith(service.CONNECTOR_KEY_PREFIX):
        raise HTTPException(status_code=401, detail="连接器 key 无效或已吊销")
    rows = (
        db.execute(select(ConnectorKey).where(ConnectorKey.revoked_at.is_(None)))
        .scalars()
        .all()
    )
    key_row = service.find_by_hash(rows, token, attr="key_hash")
    if key_row is None:
        raise HTTPException(status_code=401, detail="连接器 key 无效或已吊销")
    connector = db.get(Connector, key_row.connector_id)
    if connector is None or connector.revoked_at is not None:
        raise HTTPException(status_code=401, detail="连接器已吊销")
    return connector


# ------------------------------------------------------------------ 配对


@router.post(
    "/api/v1/connectors/pair",
    status_code=status.HTTP_201_CREATED,
    response_model=PairOut,
)
def pair(payload: PairIn, db: Session = Depends(get_db)) -> PairOut:
    """配对令牌（15 分钟、单次）换连接器 key；明文仅本响应一次。

    同名（同企业、未吊销）连接器视为同一台机器重配：复用连接器行、追加
    新 key（旧 key 不自动吊销，控制台提示客户），既有白名单/数据集绑定
    保持不变；已吊销的连接器不复生（视为全新连接器）。
    """
    token = payload.token.strip()
    if not token.startswith(service.PAIRING_TOKEN_PREFIX):
        raise HTTPException(status_code=401, detail="配对令牌无效或已过期")
    rows = (
        db.execute(select(ConnectorPairingToken).where(ConnectorPairingToken.used_at.is_(None)))
        .scalars()
        .all()
    )
    row = service.find_by_hash(rows, token)
    now = service.utcnow()
    if row is None or row.expires_at <= now:
        raise HTTPException(status_code=401, detail="配对令牌无效或已过期")
    row.used_at = now
    connector = db.execute(
        select(Connector).where(
            Connector.customer_id == row.customer_id,
            Connector.name == payload.name,
            Connector.revoked_at.is_(None),
        )
    ).scalar_one_or_none()
    if connector is None:
        connector = Connector(
            customer_id=row.customer_id,
            name=payload.name,
            version=payload.version,
            status="offline",
        )
        db.add(connector)
        db.flush()
    elif payload.version:
        connector.version = payload.version
    key_text, key_hash = service.new_connector_key()
    db.add(ConnectorKey(connector_id=connector.id, key_hash=key_hash))
    db.commit()
    return PairOut(connector_key=key_text, connector_id=connector.id)


# ------------------------------------------------------------------ 心跳 / 配置


@router.post("/api/v1/connector/heartbeat", response_model=HeartbeatOut)
def heartbeat(
    payload: HeartbeatIn,
    connector: Connector = Depends(require_connector_key),
    db: Session = Depends(get_db),
) -> HeartbeatOut:
    """心跳：刷新在线态与版本；sync_state 仅回执，不落库。"""
    connector.last_heartbeat_at = service.utcnow()
    connector.status = "online"
    if payload.version:
        connector.version = payload.version
    db.commit()
    return HeartbeatOut(poll_interval_seconds=get_settings().dataset_connector_poll_seconds)


@router.get("/api/v1/connector/config")
def connector_config(
    connector: Connector = Depends(require_connector_key),
    db: Session = Depends(get_db),
) -> dict:
    """白名单数据集 + 调度 + 上限下发（响应零凭据，源凭据只在连接器本地）。"""
    settings = get_settings()
    datasets = (
        db.execute(
            select(Dataset)
            .where(
                Dataset.customer_id == connector.customer_id,
                Dataset.connector_id == connector.id,
            )
            .order_by(Dataset.created_at, Dataset.id)
        )
        .scalars()
        .all()
    )
    return {
        "connector_id": connector.id,
        "poll_interval_seconds": settings.dataset_connector_poll_seconds,
        "min_sync_interval_seconds": settings.dataset_min_sync_minutes * 60,
        "limits": {
            "max_rows": settings.dataset_max_rows,
            "storage_limit_bytes": settings.dataset_storage_limit_bytes,
            "storage_used_bytes": service.dataset_storage_total(
                db, customer_id=connector.customer_id
            ),
        },
        "datasets": [
            {
                "dataset_key": dataset.key,
                "name": dataset.name,
                "source": dataset.source_name,
                "source_ref": dataset.source_ref,
                "schedule_cron": dataset.sync_cron,
                "columns": list(dataset.columns_json or []),
                "row_count": dataset.row_count,
                "sync_status": dataset.sync_status,
            }
            for dataset in datasets
        ],
    }


# ------------------------------------------------------------------ 推送三阶段


def _dataset_for_connector(db: Session, connector: Connector, dataset_key: str) -> Dataset:
    dataset = db.execute(
        select(Dataset).where(
            Dataset.customer_id == connector.customer_id,
            Dataset.key == dataset_key,
            Dataset.connector_id == connector.id,
        )
    ).scalar_one_or_none()
    if dataset is None:
        raise HTTPException(
            status_code=404, detail=f"数据集 {dataset_key} 不在本连接器白名单"
        )
    return dataset


def _record_sync(
    db: Session, dataset: Dataset, *, status_: str, rows: int, error: str | None
) -> DatasetSync:
    now = service.utcnow()
    row = DatasetSync(
        dataset_id=dataset.id,
        started_at=now,
        finished_at=now,
        status=status_,
        rows=rows,
        error=error,
    )
    db.add(row)
    return row


def _pause(dataset: Dataset, status_: str, reason: str | None) -> None:
    dataset.sync_status = status_
    dataset.paused_reason = reason


def _is_quota_error(exc: Exception) -> bool:
    message = str(exc)
    return "quota" in message.lower() or "上限" in message


def _sync_or_404(db: Session, connector: Connector, sync_id: str) -> DatasetSync:
    row = db.get(DatasetSync, sync_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"同步 {sync_id} 不存在")
    dataset = db.get(Dataset, row.dataset_id)
    if (
        dataset is None
        or dataset.customer_id != connector.customer_id
        or dataset.connector_id != connector.id
    ):
        raise HTTPException(status_code=404, detail=f"同步 {sync_id} 不存在")
    return row


def _session_or_409(sync_id: str) -> SyncSession:
    session = _SYNC_SESSIONS.get(sync_id)
    if session is None:
        raise HTTPException(
            status_code=409,
            detail="sync 会话已失效（服务重启或已结束）——请 abort 后重新 begin",
        )
    return session


@router.post(
    "/api/v1/connector/syncs",
    status_code=status.HTTP_201_CREATED,
    response_model=SyncBeginOut,
)
def begin_sync(
    payload: SyncBeginIn,
    connector: Connector = Depends(require_connector_key),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> SyncBeginOut:
    """阶段一：漂移/配额预检（api 侧）→ 引擎 ``ingest_begin``。"""
    dataset = _dataset_for_connector(db, connector, payload.dataset_key)
    incoming = [c.model_dump() for c in payload.columns]

    if dataset.sync_status == "paused_drift":
        return drift_response(
            "drift: 数据集处于漂移暂停，等待人工确认（resume）后才能再次同步",
            [],
        )

    # 配额预检（行上限 + 存储上限）：fail-closed，先于任何引擎调用。
    try:
        service.ensure_row_quota(payload.row_count)
        service.ensure_storage_quota(
            db,
            customer_id=dataset.customer_id,
            incoming_bytes=service.estimate_bytes(dataset, payload.row_count),
            exclude_dataset_id=dataset.id,
        )
    except service.QuotaExceeded as exc:
        _pause(dataset, "paused_quota", exc.reason)
        _record_sync(db, dataset, status_="quota", rows=payload.row_count or 0, error=exc.reason)
        db.commit()
        return quota_response(exc.reason)

    # 漂移判定（api 侧）：增列=接受；缺列/类型变=拒绝 + 暂停，不调引擎。
    merged, differences = service.diff_columns(dataset.columns_json or [], incoming)
    if differences:
        reason = service.drift_message(differences)
        _pause(dataset, "paused_drift", reason)
        _record_sync(db, dataset, status_="drift", rows=payload.row_count or 0, error=reason)
        db.commit()
        return drift_response(reason, differences)

    client = engine_factory(dataset.customer_id)
    # 同一数据集的上一次在飞同步（未 abort 就重来）：清理旧登记与会话，
    # 并 best-effort 让引擎 abort 其 __staging（引擎 ingest_begin 自身幂等，
    # 这里只是把 api 侧历史清干净，避免历史里留下永远 syncing 的行）。
    stale_rows = (
        db.execute(
            select(DatasetSync).where(
                DatasetSync.dataset_id == dataset.id,
                DatasetSync.status == "syncing",
            )
        )
        .scalars()
        .all()
    )
    for stale in stale_rows:
        stale_session = _SYNC_SESSIONS.pop(stale.id, None)
        if stale_session is not None:
            try:
                client.call(TOOL_INGEST_ABORT, {"ingest_id": stale_session.engine_ingest_id})
            except (EngineUnavailable, EngineCallError):
                pass
        db.delete(stale)
    if stale_rows:
        db.commit()
    try:
        begun = client.call(
            TOOL_INGEST_BEGIN,
            {
                "dataset_key": dataset.key,
                "columns": incoming,
                "pk_columns": list(payload.pk_columns),
                "row_count": payload.row_count,
                "actor": f"connector:{connector.id}",
            },
        )
        engine_ingest_id = str(begun.get("ingest_id") or "")
        if not engine_ingest_id:
            raise EngineCallError("引擎 ingest_begin 未返回 ingest_id")
    except (EngineUnavailable, EngineCallError) as exc:
        # 失败态只落 sync_status/历史 error；paused_reason 专用于两种暂停态
        _pause(dataset, "failed", None)
        _record_sync(db, dataset, status_="failed", rows=0, error=str(exc))
        db.commit()
        raise engine_failure(exc) from exc

    sync_id = service.new_uuid()
    db.add(DatasetSync(id=sync_id, dataset_id=dataset.id, status="syncing", rows=0))
    dataset.sync_status = "syncing"
    dataset.paused_reason = None
    db.commit()
    _SYNC_SESSIONS[sync_id] = SyncSession(
        sync_id=sync_id,
        dataset_id=dataset.id,
        connector_id=connector.id,
        engine_ingest_id=engine_ingest_id,
        schema=merged,
    )
    return SyncBeginOut(sync_id=sync_id)


@router.post("/api/v1/connector/syncs/{sync_id}/chunks", response_model=ChunkOut)
def push_chunk(
    sync_id: str,
    payload: ChunkIn,
    connector: Connector = Depends(require_connector_key),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> ChunkOut:
    """阶段二：块序号校验（防重放）→ 透传引擎 ``ingest_chunk``。"""
    row = _sync_or_404(db, connector, sync_id)
    if row.status != "syncing":
        raise HTTPException(
            status_code=409, detail=f"同步 {sync_id} 已结束（{row.status}），不能再推送分块"
        )
    session = _session_or_409(sync_id)
    if payload.index != session.next_chunk_index:
        raise HTTPException(
            status_code=409,
            detail=f"wrong_index: 期望 {session.next_chunk_index}，收到 {payload.index}",
        )
    dataset = db.get(Dataset, session.dataset_id)
    client = engine_factory(connector.customer_id)
    try:
        result = client.call(
            TOOL_INGEST_CHUNK,
            {
                "ingest_id": session.engine_ingest_id,
                "rows": payload.rows,
                "start_index": session.start_index,
            },
        )
    except (EngineUnavailable, EngineCallError) as exc:
        row.status = "failed"
        row.error = str(exc)
        row.finished_at = service.utcnow()
        if dataset is not None:
            _pause(dataset, "failed", None)
        _SYNC_SESSIONS.pop(sync_id, None)
        db.commit()
        raise engine_failure(exc) from exc
    accepted = int(result.get("accepted") or len(payload.rows))
    session.next_chunk_index += 1
    session.start_index += accepted
    session.estimated_bytes += len(json.dumps(payload.rows, ensure_ascii=False))
    return ChunkOut(accepted=accepted)


@router.post("/api/v1/connector/syncs/{sync_id}/commit", response_model=CommitOut)
def commit_sync(
    sync_id: str,
    connector: Connector = Depends(require_connector_key),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> CommitOut:
    """阶段三：存储终检 → 引擎 ``ingest_commit``（原子替换）→ 更新登记。"""
    row = _sync_or_404(db, connector, sync_id)
    if row.status != "syncing":
        raise HTTPException(
            status_code=409, detail=f"同步 {sync_id} 已结束（{row.status}），不能重复提交"
        )
    session = _session_or_409(sync_id)
    dataset = db.get(Dataset, session.dataset_id)
    client = engine_factory(connector.customer_id)

    try:
        service.ensure_storage_quota(
            db,
            customer_id=dataset.customer_id,
            incoming_bytes=max(
                session.estimated_bytes,
                service.estimate_bytes(dataset, session.start_index),
            ),
            exclude_dataset_id=dataset.id,
        )
    except service.QuotaExceeded as exc:
        try:
            client.call(TOOL_INGEST_ABORT, {"ingest_id": session.engine_ingest_id})
        except (EngineUnavailable, EngineCallError):
            pass
        _SYNC_SESSIONS.pop(sync_id, None)
        row.status = "quota"
        row.error = exc.reason
        row.finished_at = service.utcnow()
        _pause(dataset, "paused_quota", exc.reason)
        db.commit()
        return quota_response(exc.reason)

    try:
        result = client.call(TOOL_INGEST_COMMIT, {"ingest_id": session.engine_ingest_id})
    except (EngineUnavailable, EngineCallError) as exc:
        if _is_quota_error(exc):
            try:
                client.call(TOOL_INGEST_ABORT, {"ingest_id": session.engine_ingest_id})
            except (EngineUnavailable, EngineCallError):
                pass
            _SYNC_SESSIONS.pop(sync_id, None)
            row.status = "quota"
            row.error = str(exc)
            row.finished_at = service.utcnow()
            _pause(dataset, "paused_quota", str(exc))
            db.commit()
            return quota_response(str(exc))
        _SYNC_SESSIONS.pop(sync_id, None)
        row.status = "failed"
        row.error = str(exc)
        row.finished_at = service.utcnow()
        _pause(dataset, "failed", None)
        db.commit()
        raise engine_failure(exc) from exc

    _SYNC_SESSIONS.pop(sync_id, None)
    rows = int(result.get("rows") or session.start_index)
    size_bytes = int(result.get("size_bytes") or 0)
    dataset.row_count = rows
    dataset.size_bytes = size_bytes
    dataset.columns_json = list(session.schema)
    dataset.sync_status = "ok"
    dataset.paused_reason = None
    row.status = "ok"
    row.rows = rows
    row.finished_at = service.utcnow()
    # 引擎已落库后的精确尺寸终检：越限则保留快照但暂停后续写入（fail-closed）。
    settings = get_settings()
    others = service.dataset_storage_total(
        db, customer_id=dataset.customer_id, exclude_dataset_id=dataset.id
    )
    if others + size_bytes > settings.dataset_storage_limit_bytes:
        _pause(
            dataset,
            "paused_quota",
            f"存储用量超过配额（本数据集 {size_bytes} 字节）——"
            "请删除数据集或提高配额",
        )
    db.commit()
    return CommitOut(rows=rows)


@router.post("/api/v1/connector/syncs/{sync_id}/abort", response_model=AbortOut)
def abort_sync(
    sync_id: str,
    connector: Connector = Depends(require_connector_key),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> AbortOut:
    """中止：引擎 ``ingest_abort`` 清理暂存 + 清理在飞登记（幂等）。"""
    row = _sync_or_404(db, connector, sync_id)
    session = _SYNC_SESSIONS.pop(sync_id, None)
    dataset = db.get(Dataset, row.dataset_id)
    if session is not None:
        try:
            engine_factory(connector.customer_id).call(
                TOOL_INGEST_ABORT, {"ingest_id": session.engine_ingest_id}
            )
        except (EngineUnavailable, EngineCallError):
            pass  # 暂存清理失败不阻断本地清理（引擎 commit 前的 __staging 不对外可见）
    if row.status == "syncing":
        db.delete(row)
    if dataset is not None and dataset.sync_status == "syncing":
        dataset.sync_status = "idle"
        dataset.paused_reason = None
    db.commit()
    return AbortOut(aborted=True)


# ------------------------------------------------------------------ 内部只读概览


@router.get(
    "/internal/datasets/overview",
    response_model=list[InternalOverviewOut],
    dependencies=[Depends(require_internal)],
)
def internal_overview(db: Session = Depends(get_db)) -> list[InternalOverviewOut]:
    """per-cell 存储用量与连接器健康（只读；无吊销/删除/白名单管理入口）。"""
    dataset_rows = db.execute(
        select(
            Dataset.customer_id,
            func.count(Dataset.id),
            func.coalesce(func.sum(Dataset.size_bytes), 0),
        ).group_by(Dataset.customer_id)
    ).all()
    now = service.utcnow()
    connectors = db.execute(select(Connector)).scalars().all()
    by_customer: dict[str, list[Connector]] = {}
    for connector in connectors:
        by_customer.setdefault(connector.customer_id, []).append(connector)

    customer_ids = sorted(set(by_customer) | {row[0] for row in dataset_rows})
    overview: list[InternalOverviewOut] = []
    stats = {row[0]: (int(row[1]), int(row[2])) for row in dataset_rows}
    for customer_id in customer_ids:
        count, storage = stats.get(customer_id, (0, 0))
        overview.append(
            InternalOverviewOut(
                customer_id=customer_id,
                datasets=count,
                storage_bytes=storage,
                connectors=[
                    InternalConnectorOut(
                        id=c.id,
                        status=service.connector_status(c, now=now),
                        last_heartbeat_at=c.last_heartbeat_at,
                    )
                    for c in by_customer.get(customer_id, [])
                ],
            )
        )
    return overview