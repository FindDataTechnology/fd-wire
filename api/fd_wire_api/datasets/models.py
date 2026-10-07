"""datasets 切片 ORM 模型（契约 §3.2 六表）。

- ``connectors`` / ``connector_keys`` / ``connector_pairing_tokens``：
  出站连接器身份（配对令牌 15 分钟单次、key 存 sha256、吊销即时生效）。
- ``datasets``：客户数据集登记（1:1 对应一张源表/一个文件），有效数据在
  cell 引擎侧，本表只存元数据（绝不存客户源 DSN/账密）。
- ``dataset_syncs``：同步历史（status 终态 ok|failed|drift|quota；
  在飞行为 ``syncing`` 标记，abort 时整行清理——见 sync_service 说明）。
- ``uploads``：上传原件登记（stored_path 指向 api 侧暂存 CSV）。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import DatasetsBase


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def new_uuid() -> str:
    return str(uuid.uuid4())


class Connector(DatasetsBase):
    """客户内网出站连接器（一个企业可有多个，各自独立 key 与白名单）。"""

    __tablename__ = "connectors"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    customer_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(200))
    version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: 落库状态仅作留档；对外状态一律由心跳推导（见 service.connector_status）
    status: Mapped[str] = mapped_column(String(16), default="offline")
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow_naive)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ConnectorKey(DatasetsBase):
    """连接器 key（明文只在下发当次出现，库内只存 sha256）。"""

    __tablename__ = "connector_keys"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    connector_id: Mapped[str] = mapped_column(String(36), index=True)
    key_hash: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow_naive)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ConnectorPairingToken(DatasetsBase):
    """配对令牌：15 分钟有效、单次使用（库内只存 sha256）。"""

    __tablename__ = "connector_pairing_tokens"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    customer_id: Mapped[str] = mapped_column(String(64), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow_naive)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Dataset(DatasetsBase):
    """客户数据集登记（元数据；有效数据/修正层在 cell 引擎侧）。"""

    __tablename__ = "datasets"
    __table_args__ = (UniqueConstraint("customer_id", "key", name="uq_datasets_customer_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    customer_id: Mapped[str] = mapped_column(String(64), index=True)
    #: dataset_key（^[a-z][a-z0-9_]{0,39}$，企业内唯一；也是引擎表名后缀）
    key: Mapped[str] = mapped_column(String(40), index=True)
    name: Mapped[str] = mapped_column(String(200))
    #: "upload" | "connector"
    source_kind: Mapped[str] = mapped_column(String(16))
    connector_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    #: 连接器本地源名（连接器本地配置 sources[].name 的映射键）；云端绝不含 DSN
    source_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    #: 源内的表名/文件名（连接器拉数对象）或上传文件名；云端绝不含 DSN
    source_ref: Mapped[str | None] = mapped_column(String(512), nullable=True)
    #: [{name, type(INTEGER|REAL|TEXT)}]（漂移基线）
    columns_json: Mapped[list] = mapped_column(JSON, default=list)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    sync_cron: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: idle|syncing|ok|failed|paused_drift|paused_quota
    sync_status: Mapped[str] = mapped_column(String(16), default="idle")
    paused_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: 溯源档位 off|chain_only|anchored_batch|anchored_realtime（wire-provenance-ledger）
    provenance_tier: Mapped[str] = mapped_column(String(24), default="chain_only")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow_naive)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow_naive, onupdate=_utcnow_naive
    )


class DatasetSync(DatasetsBase):
    """同步历史行（wire-provenance-ledger 起终态留痕、不再删行）。

    终态 status ∈ {ok, failed, drift, quota, aborted}；``syncing`` 是在飞行
    标记（begin 落行、commit/abort 改终态——中止落 ``aborted`` 含原因而非
    删行），保证 chunk/commit 的会话映射可跨请求查回。终态行由触发器
    禁改禁删（迁移 0013）。
    """

    __tablename__ = "dataset_syncs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    dataset_id: Mapped[str] = mapped_column(String(36), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow_naive)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16))
    rows: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class Upload(DatasetsBase):
    """上传登记：列与类型预览的落点，建档消费后置 consumed_at。"""

    __tablename__ = "uploads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    customer_id: Mapped[str] = mapped_column(String(64), index=True)
    filename: Mapped[str] = mapped_column(String(512))
    columns_json: Mapped[list] = mapped_column(JSON, default=list)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    #: api 侧暂存路径（CSV 原样存；Excel 转 CSV 暂存）
    stored_path: Mapped[str] = mapped_column(String(1024))
    #: 原始文件内容哈希 sha256:<hex>（存量行无原件、如实置 NULL——wire-provenance-ledger）
    content_sha256: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow_naive)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)