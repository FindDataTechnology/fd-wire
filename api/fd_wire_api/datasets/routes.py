"""客户数据集客户面端点（契约 §3.3）。

客户面（``X-Customer-Id``，缺失 401；跨企业一律 404）：
- 列表/详情/删除（删除调引擎 ``delete``，引擎不可达即 502 fail-closed）
- 上传（multipart：CSV/Excel 解析 + 保守类型推断 + 样例预览 + 上限拒收）
- 建档（upload 类立即分块 ingest 引擎；connector 类只登记白名单与调度）
- 行预览（透传引擎 ``preview``）、修正三件套（透传引擎修正层）、
  同步历史、漂移恢复 ``resume``
- 连接器管理：配对令牌签发、列表（心跳推导状态）、改名、吊销

纪律：本切面对 cell 数据的一切读写都经 ``ingest.EngineToolClient``
（平台服务凭据轨道），不存在直接打开 daas.db/数据卷的路径（契约 §6.5）。
"""

from __future__ import annotations

import os
import secrets
from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    File,
    Header,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import service, uploads
from .db import get_db
from .ingest import (
    EngineCallError,
    EngineClientFactory,
    EngineUnavailable,
    TOOL_CORRECTION_ADD,
    TOOL_CORRECTION_LIST,
    TOOL_CORRECTION_REVERT,
    TOOL_DELETE,
    TOOL_INGEST_ABORT,
    TOOL_INGEST_BEGIN,
    TOOL_INGEST_CHUNK,
    TOOL_INGEST_COMMIT,
    TOOL_PREVIEW,
    get_engine_client_factory,
)
from .models import Connector, ConnectorKey, ConnectorPairingToken, Dataset, DatasetSync, Upload
from .schemas import (
    ColumnIn,
    ConnectorOut,
    ConnectorPatchIn,
    CorrectionIn,
    CorrectionOut,
    DatasetCreateIn,
    DatasetOut,
    PairingTokenOut,
    ResumeIn,
    SyncOut,
    UploadOut,
)
from .settings import get_settings
from ..provenance.ledger import append_event

router = APIRouter(tags=["datasets"])

_DEFAULT_INTERNAL_TOKEN = "wire-internal-dev"


def _customer_id(
    x_customer_id: str | None = Header(default=None, alias="X-Customer-Id"),
) -> str:
    """客户身份：与 demands 切片同款骨架鉴权，缺失即 401。"""
    if not x_customer_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少 X-Customer-Id（客户身份头）",
        )
    return x_customer_id


def require_internal(
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> None:
    """内部调用鉴权：与 FD_WIRE_INTERNAL_TOKEN 常量时间比对（抄 demands）。"""
    expected = os.getenv("FD_WIRE_INTERNAL_TOKEN", _DEFAULT_INTERNAL_TOKEN)
    if not x_internal_token or not secrets.compare_digest(x_internal_token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="内部端点需要有效的 X-Internal-Token",
        )


# ------------------------------------------------------------- 错误响应构造


def drift_response(message: str, differences: list[dict]) -> JSONResponse:
    """409 漂移：detail 带 ``drift:`` 前缀（契约 §1），differences 机器可读。"""
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": message, "differences": differences},
    )


def quota_response(reason: str) -> JSONResponse:
    """429 配额：detail 带 ``quota:`` 前缀 + 恢复途径。"""
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={"detail": f"quota: {reason}"},
    )


def engine_failure(exc: Exception) -> HTTPException:
    """引擎不可达/报错一律 502 fail-closed（绝不假成功）。"""
    prefix = "engine_unavailable" if isinstance(exc, EngineUnavailable) else "engine"
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"{prefix}: {exc}")


# ------------------------------------------------------------- 内部工具


def _dataset_or_404(db: Session, dataset_id: str, customer_id: str) -> Dataset:
    dataset = db.get(Dataset, dataset_id)
    if dataset is None or dataset.customer_id != customer_id:
        raise HTTPException(status_code=404, detail=f"数据集 {dataset_id} 不存在")
    return dataset


def _connector_or_404(db: Session, connector_id: str, customer_id: str) -> Connector:
    connector = db.get(Connector, connector_id)
    if connector is None or connector.customer_id != customer_id:
        raise HTTPException(status_code=404, detail=f"连接器 {connector_id} 不存在")
    return connector


def _actor(customer_id: str) -> str:
    return f"customer:{customer_id}"


def _ensure_engine_ok(exc: Exception) -> HTTPException:
    return engine_failure(exc)


# ------------------------------------------------------------- 上传


@router.post(
    "/api/v1/datasets/uploads",
    status_code=status.HTTP_201_CREATED,
    response_model=UploadOut,
)
def upload_dataset_file(
    file: UploadFile = File(...),
    customer_id: str = Depends(_customer_id),
    db: Session = Depends(get_db),
) -> UploadOut:
    """上传 CSV/Excel：解析全量、列与类型预览、50 万行与存储配额 fail-closed。"""
    settings = get_settings()
    filename = file.filename or "upload.csv"
    incoming = file.file.read()
    if not incoming:
        raise HTTPException(status_code=400, detail="上传文件为空")
    upload_dir = Path(settings.datasets_upload_dir)
    tmp_dir = upload_dir / ".incoming"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = tmp_dir / f"{service.new_uuid()}{Path(filename).suffix.lower()}"
    tmp_path.write_bytes(incoming)
    try:
        try:
            stored, parsed, content_sha256 = uploads.store_upload_file(
                source_path=tmp_path,
                original_name=filename,
                upload_dir=upload_dir,
                max_rows=settings.dataset_max_rows,
            )
        except uploads.UploadError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        tmp_path.unlink(missing_ok=True)

    try:
        service.ensure_storage_quota(
            db, customer_id=customer_id, incoming_bytes=parsed.size_bytes
        )
    except service.QuotaExceeded as exc:
        Path(stored).unlink(missing_ok=True)
        return _raise_quota(exc)

    record = Upload(
        customer_id=customer_id,
        filename=filename,
        columns_json=parsed.columns,
        row_count=parsed.row_count,
        size_bytes=parsed.size_bytes,
        stored_path=str(stored),
        # 原件内容哈希（客户端发来的原始字节；Excel 为 .xlsx 原件而非转换
        # 后 CSV）——客户可对原件独立复算（wire-provenance-ledger）
        content_sha256=content_sha256,
    )
    db.add(record)
    db.flush()  # 先取 record.id（upload 事件的 subject 要引用）
    # 上传事件入账（wire-provenance-ledger 任务 4.1）：与 uploads 落行同一
    # 事务——append_event 只 flush 不 commit，事务边界归本路由的 commit；
    # 任何失败回滚时登记行与事件一起消失，不留半条事件。建档时数据集尚
    # 不存在，不查档位恒入账（chain 便宜，档位门只作用于引擎修正类事件）。
    append_event(
        db,
        ledger=customer_id,
        type="dataset.upload.registered",
        actor={"kind": "customer", "id": customer_id, "sig": None},
        subject={"kind": "upload", "id": record.id},
        payload={
            "filename": filename,
            "content_sha256": content_sha256,
            "size_bytes": parsed.size_bytes,
            "row_count": parsed.row_count,
        },
    )
    db.commit()
    db.refresh(record)
    return UploadOut(
        upload_id=record.id,
        filename=record.filename,
        columns=[ColumnIn(**c) for c in parsed.columns],
        row_count=parsed.row_count,
        within_limit=True,
        sample_rows=parsed.sample_rows,
    )


def _raise_quota(exc: service.QuotaExceeded):
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=f"quota: {exc.reason}",
    )


# ------------------------------------------------------------- 建档 / 列表


@router.post(
    "/api/v1/datasets",
    status_code=status.HTTP_201_CREATED,
    response_model=DatasetOut,
)
def create_dataset(
    payload: DatasetCreateIn,
    customer_id: str = Depends(_customer_id),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> DatasetOut:
    """建档：upload 类立即 ingest 引擎（成功后 consumed_at 置位）。"""
    source = payload.source
    try:
        service.ensure_new_dataset_room(db, customer_id=customer_id)
    except service.QuotaExceeded as exc:
        _raise_quota(exc)
    if source.kind == "upload":
        return _create_from_upload(
            db, customer_id=customer_id, name=payload.name, source=source,
            engine_factory=engine_factory,
        )
    if source.kind == "connector":
        return _create_from_connector(
            db, customer_id=customer_id, name=payload.name, source=source
        )
    raise HTTPException(  # pragma: no cover - pydantic Literal 已拦
        status_code=400, detail="source.kind 必须是 upload 或 connector"
    )


def _create_from_connector(
    db: Session, *, customer_id: str, name: str, source
) -> DatasetOut:
    if not source.connector_id:
        raise HTTPException(status_code=400, detail="connector 来源必须带 connector_id")
    if not source.source_name:
        raise HTTPException(
            status_code=400,
            detail="connector 来源必须带 source_name（连接器本地源名）",
        )
    if not source.source_ref:
        raise HTTPException(
            status_code=400, detail="connector 来源必须带 source_ref（源内表名/文件名）"
        )
    connector = _connector_or_404(db, source.connector_id, customer_id)
    if connector.revoked_at is not None:
        raise HTTPException(status_code=409, detail="连接器已吊销，不能绑定数据集")
    dataset = Dataset(
        customer_id=customer_id,
        key=service.allocate_key(db, customer_id=customer_id, name=name),
        name=name,
        source_kind="connector",
        connector_id=connector.id,
        source_name=source.source_name,
        source_ref=source.source_ref,
        columns_json=[],
        row_count=0,
        size_bytes=0,
        sync_cron=source.schedule_cron,
        sync_status="idle",
    )
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return DatasetOut.from_dataset(dataset)


def _create_from_upload(
    db: Session,
    *,
    customer_id: str,
    name: str,
    source,
    engine_factory: EngineClientFactory,
) -> DatasetOut:
    if not source.upload_id:
        raise HTTPException(status_code=400, detail="upload 来源必须带 upload_id")
    record = db.get(Upload, source.upload_id)
    if record is None or record.customer_id != customer_id:
        raise HTTPException(status_code=404, detail=f"上传 {source.upload_id} 不存在")
    if record.consumed_at is not None:
        raise HTTPException(status_code=409, detail="该上传已建过数据集（单次消费）")
    columns = [dict(c) for c in (record.columns_json or [])]
    try:
        service.ensure_storage_quota(
            db, customer_id=customer_id, incoming_bytes=record.size_bytes
        )
    except service.QuotaExceeded as exc:
        _raise_quota(exc)

    key = service.allocate_key(db, customer_id=customer_id, name=name)
    client = engine_factory(customer_id)
    actor = _actor(customer_id)
    ingest_id: str | None = None
    committed: dict
    try:
        begun = client.call(
            TOOL_INGEST_BEGIN,
            {
                "dataset_key": key,
                "columns": columns,
                "pk_columns": [],
                "row_count": record.row_count,
                "actor": actor,
            },
        )
        ingest_id = str(begun.get("ingest_id") or "")
        if not ingest_id:
            raise EngineCallError("引擎 ingest_begin 未返回 ingest_id")
        start_index = 0
        for chunk in uploads.iter_ingest_chunks(Path(record.stored_path), columns):
            client.call(
                TOOL_INGEST_CHUNK,
                {"ingest_id": ingest_id, "rows": chunk, "start_index": start_index},
            )
            start_index += len(chunk)
        committed = client.call(TOOL_INGEST_COMMIT, {"ingest_id": ingest_id})
    except (EngineUnavailable, EngineCallError) as exc:
        if ingest_id:
            try:
                client.call(TOOL_INGEST_ABORT, {"ingest_id": ingest_id})
            except Exception:  # noqa: BLE001 - best-effort 清理，不掩盖原因
                pass
        raise _ensure_engine_ok(exc) from exc

    row_count = int(committed.get("rows") or record.row_count)
    size_bytes = int(committed.get("size_bytes") or record.size_bytes)
    dataset = Dataset(
        customer_id=customer_id,
        key=key,
        name=name,
        source_kind="upload",
        connector_id=None,
        source_ref=record.filename,
        columns_json=columns,
        row_count=row_count,
        size_bytes=size_bytes,
        sync_status="ok",
    )
    # 引擎已落库后的最终核对：若精确尺寸越限，保留快照但暂停后续写入。
    limit = get_settings().dataset_storage_limit_bytes
    if service.dataset_storage_total(db, customer_id=customer_id) + size_bytes > limit:
        dataset.sync_status = "paused_quota"
        dataset.paused_reason = (
            f"存储用量超过配额 {limit} 字节（本数据集 {size_bytes} 字节）——"
            "请删除数据集或提高配额"
        )
    record.consumed_at = service.utcnow()
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return DatasetOut.from_dataset(dataset)


@router.get("/api/v1/datasets", response_model=list[DatasetOut])
def list_datasets(
    customer_id: str = Depends(_customer_id),
    db: Session = Depends(get_db),
) -> list[DatasetOut]:
    """本企业数据集列表（卡片）。"""
    datasets = (
        db.execute(
            select(Dataset)
            .where(Dataset.customer_id == customer_id)
            .order_by(Dataset.created_at.desc(), Dataset.id)
        )
        .scalars()
        .all()
    )
    return [DatasetOut.from_dataset(d) for d in datasets]


@router.get("/api/v1/datasets/{dataset_id}", response_model=DatasetOut)
def get_dataset(
    dataset_id: str,
    customer_id: str = Depends(_customer_id),
    db: Session = Depends(get_db),
) -> DatasetOut:
    return DatasetOut.from_dataset(_dataset_or_404(db, dataset_id, customer_id))


@router.delete("/api/v1/datasets/{dataset_id}")
def delete_dataset(
    dataset_id: str,
    customer_id: str = Depends(_customer_id),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> dict:
    """删除：先调引擎 drop 三表与元数据（不可达即 502，绝不假删）。

    同步历史行**保留不删**（dataset_syncs append-only，触发器层禁删；
    行内只有状态/行数/错误文本，无客户数据——孤儿化由设计接受，
    wire-provenance-ledger「不可变登记基线」）。
    """
    dataset = _dataset_or_404(db, dataset_id, customer_id)
    client = engine_factory(customer_id)
    try:
        client.call(TOOL_DELETE, {"dataset_key": dataset.key, "actor": _actor(customer_id)})
    except (EngineUnavailable, EngineCallError) as exc:
        raise _ensure_engine_ok(exc) from exc
    db.delete(dataset)
    db.commit()
    return {"deleted": True}


# ------------------------------------------------------------- 预览 / 修正


@router.get("/api/v1/datasets/{dataset_id}/rows")
def preview_rows(
    dataset_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    customer_id: str = Depends(_customer_id),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> dict:
    """行预览：透传引擎 ``preview``（含修正后的有效视图 + ``__row_id``）。"""
    dataset = _dataset_or_404(db, dataset_id, customer_id)
    client = engine_factory(customer_id)
    try:
        result = client.call(
            TOOL_PREVIEW,
            {
                "dataset_key": dataset.key,
                "limit": page_size,
                "offset": (page - 1) * page_size,
                "include_corrected": True,
            },
        )
    except (EngineUnavailable, EngineCallError) as exc:
        raise _ensure_engine_ok(exc) from exc
    return {**result, "page": page, "page_size": page_size}


@router.post(
    "/api/v1/datasets/{dataset_id}/corrections",
    status_code=status.HTTP_201_CREATED,
    response_model=CorrectionOut,
)
def add_correction(
    dataset_id: str,
    payload: CorrectionIn,
    customer_id: str = Depends(_customer_id),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> CorrectionOut:
    """修正三件套透传：改值/删行/加行，落引擎覆盖层（云端不写回客户源）。"""
    dataset = _dataset_or_404(db, dataset_id, customer_id)
    if payload.op == "insert":
        if not payload.values:
            raise HTTPException(status_code=400, detail="insert 必须带 values（整行值）")
        arguments = {
            "dataset_key": dataset.key,
            "op": "insert",
            "anchor": None,
            "values": payload.values,
            "actor": _actor(customer_id),
        }
    elif payload.op == "update":
        if not payload.row_id or not payload.column:
            raise HTTPException(
                status_code=400, detail="update 必须带 row_id 与 column"
            )
        if "value" not in payload.model_fields_set:
            raise HTTPException(status_code=400, detail="update 必须带 value（可为 null）")
        arguments = {
            "dataset_key": dataset.key,
            "op": "update",
            "anchor": payload.row_id,
            "values": {payload.column: payload.value},
            "actor": _actor(customer_id),
        }
    else:  # delete
        if not payload.row_id:
            raise HTTPException(status_code=400, detail="delete 必须带 row_id")
        arguments = {
            "dataset_key": dataset.key,
            "op": "delete",
            "anchor": payload.row_id,
            "values": {},
            "actor": _actor(customer_id),
        }
    client = engine_factory(customer_id)
    try:
        result = client.call(TOOL_CORRECTION_ADD, arguments)
    except (EngineUnavailable, EngineCallError) as exc:
        raise _ensure_engine_ok(exc) from exc
    correction_id = result.get("correction_id")
    if correction_id is None:
        raise engine_failure(EngineCallError("引擎未返回 correction_id"))
    return CorrectionOut(correction_id=int(correction_id))


@router.get("/api/v1/datasets/{dataset_id}/corrections")
def list_corrections(
    dataset_id: str,
    include_reverted: bool = Query(default=True),
    include_dangling: bool = Query(default=True),
    customer_id: str = Depends(_customer_id),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> dict:
    """修正历史（含悬空与已回滚；审计留痕，不静默丢弃）。"""
    dataset = _dataset_or_404(db, dataset_id, customer_id)
    client = engine_factory(customer_id)
    try:
        result = client.call(
            TOOL_CORRECTION_LIST,
            {
                "dataset_key": dataset.key,
                "include_reverted": include_reverted,
                "include_dangling": include_dangling,
            },
        )
    except (EngineUnavailable, EngineCallError) as exc:
        raise _ensure_engine_ok(exc) from exc
    return result


@router.post("/api/v1/datasets/{dataset_id}/corrections/{correction_id}/revert")
def revert_correction(
    dataset_id: str,
    correction_id: int,
    customer_id: str = Depends(_customer_id),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> dict:
    """单条回滚：引擎标记 reverted 并重建有效表；修正留档。"""
    dataset = _dataset_or_404(db, dataset_id, customer_id)
    client = engine_factory(customer_id)
    try:
        result = client.call(
            TOOL_CORRECTION_REVERT,
            {
                "dataset_key": dataset.key,
                "correction_id": correction_id,
                "actor": _actor(customer_id),
            },
        )
    except (EngineUnavailable, EngineCallError) as exc:
        raise _ensure_engine_ok(exc) from exc
    return {"reverted": bool(result.get("reverted", True))}


# ------------------------------------------------------------- 同步历史 / 恢复


@router.get("/api/v1/datasets/{dataset_id}/syncs", response_model=list[SyncOut])
def list_syncs(
    dataset_id: str,
    customer_id: str = Depends(_customer_id),
    db: Session = Depends(get_db),
) -> list[SyncOut]:
    dataset = _dataset_or_404(db, dataset_id, customer_id)
    rows = (
        db.execute(
            select(DatasetSync)
            .where(DatasetSync.dataset_id == dataset.id)
            .order_by(DatasetSync.started_at.desc(), DatasetSync.id)
        )
        .scalars()
        .all()
    )
    return [SyncOut.model_validate(row) for row in rows]


@router.post("/api/v1/datasets/{dataset_id}/resume", response_model=DatasetOut)
def resume_dataset(
    dataset_id: str,
    payload: ResumeIn,
    customer_id: str = Depends(_customer_id),
    db: Session = Depends(get_db),
) -> DatasetOut:
    """漂移人工确认：接受新 schema（``accept_columns``）后恢复同步。"""
    dataset = _dataset_or_404(db, dataset_id, customer_id)
    if dataset.sync_status != "paused_drift":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"数据集不在漂移暂停态（当前 {dataset.sync_status}），无需恢复",
        )
    dataset.columns_json = [c.model_dump() for c in payload.accept_columns]
    dataset.paused_reason = None
    dataset.sync_status = "idle"
    db.commit()
    db.refresh(dataset)
    return DatasetOut.from_dataset(dataset)


# ------------------------------------------------------------- 连接器管理


@router.post(
    "/api/v1/connectors/pairing-tokens",
    status_code=status.HTTP_201_CREATED,
    response_model=PairingTokenOut,
)
def create_pairing_token(
    customer_id: str = Depends(_customer_id),
    db: Session = Depends(get_db),
) -> PairingTokenOut:
    """签发配对令牌：15 分钟、单次；库内只存 sha256。"""
    token, token_hash, expires_at = service.new_pairing_token()
    db.add(
        ConnectorPairingToken(
            customer_id=customer_id, token_hash=token_hash, expires_at=expires_at
        )
    )
    db.commit()
    return PairingTokenOut(token=token, expires_at=expires_at)


@router.get("/api/v1/connectors", response_model=list[ConnectorOut])
def list_connectors(
    customer_id: str = Depends(_customer_id),
    db: Session = Depends(get_db),
) -> list[ConnectorOut]:
    """连接器列表：状态由心跳推导（online/offline/revoked）。"""
    connectors = (
        db.execute(
            select(Connector)
            .where(Connector.customer_id == customer_id)
            .order_by(Connector.created_at.desc(), Connector.id)
        )
        .scalars()
        .all()
    )
    counts = dict(
        db.execute(
            select(Dataset.connector_id, func.count(Dataset.id))
            .where(Dataset.customer_id == customer_id)
            .group_by(Dataset.connector_id)
        ).all()
    )
    return [
        ConnectorOut(
            id=c.id,
            name=c.name,
            version=c.version,
            status=service.connector_status(c),
            last_heartbeat_at=c.last_heartbeat_at,
            created_at=c.created_at,
            revoked_at=c.revoked_at,
            dataset_count=int(counts.get(c.id, 0)),
        )
        for c in connectors
    ]


@router.patch("/api/v1/connectors/{connector_id}", response_model=ConnectorOut)
def rename_connector(
    connector_id: str,
    payload: ConnectorPatchIn,
    customer_id: str = Depends(_customer_id),
    db: Session = Depends(get_db),
) -> ConnectorOut:
    connector = _connector_or_404(db, connector_id, customer_id)
    connector.name = payload.name
    db.commit()
    db.refresh(connector)
    return ConnectorOut(
        id=connector.id,
        name=connector.name,
        version=connector.version,
        status=service.connector_status(connector),
        last_heartbeat_at=connector.last_heartbeat_at,
        created_at=connector.created_at,
        revoked_at=connector.revoked_at,
    )


@router.delete("/api/v1/connectors/{connector_id}")
def revoke_connector(
    connector_id: str,
    customer_id: str = Depends(_customer_id),
    db: Session = Depends(get_db),
) -> dict:
    """吊销：连接器与其全部 key 即时失效（后续推送 401；动作留档）。"""
    connector = _connector_or_404(db, connector_id, customer_id)
    now = service.utcnow()
    connector.revoked_at = connector.revoked_at or now
    keys = (
        db.execute(select(ConnectorKey).where(ConnectorKey.connector_id == connector.id))
        .scalars()
        .all()
    )
    for key in keys:
        key.revoked_at = key.revoked_at or now
    db.commit()
    return {"revoked": True, "keys_revoked": len(keys)}