"""datasets API 的请求/响应模型（pydantic v2，契约 §3.3 路径与载荷）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

ColumnType = Literal["INTEGER", "REAL", "TEXT"]


class ColumnIn(BaseModel):
    """列声明（引擎三型之一；不确定一律 TEXT——保守由调用方保证）。"""

    name: str = Field(min_length=1, max_length=200)
    type: ColumnType = "TEXT"


class DatasetSourceIn(BaseModel):
    """数据集来源（上传 / 连接器白名单 / 声明式建集），随 kind 互斥取用。"""

    kind: Literal["upload", "connector", "declared"]
    upload_id: str | None = None
    connector_id: str | None = None
    #: 连接器本地源名（连接器本地配置 sources[].name 的映射键）；上传类忽略
    source_name: str | None = Field(default=None, max_length=200)
    #: 源内的表名/文件名（连接器拉数对象）；上传类忽略
    source_ref: str | None = Field(default=None, max_length=512)
    schedule_cron: str | None = Field(default=None, max_length=64)
    #: declared 专用：列声明 [{name, type(INTEGER|REAL|TEXT)}]（wire-customer-data-engine 2.3）
    columns: list[ColumnIn] | None = None
    #: declared 专用：主键列（成为行锚；缺省行哈希兜底）
    pk_columns: list[str] | None = None


class DatasetCreateIn(BaseModel):
    """建档：名称 + 来源（载荷严格按契约 §3.3）。"""

    name: str = Field(min_length=1, max_length=200)
    source: DatasetSourceIn


class DatasetOut(BaseModel):
    """数据集客户视图（仅本企业可见；跨企业一律 404）。"""

    model_config = ConfigDict(from_attributes=True)

    id: str
    key: str
    name: str
    source_kind: str
    #: 存储分层徽标（wire-free-tier-data-gate）：api=api 层轻量存储（免费档）、
    #: cell=引擎物化（付费档）——与 source_kind（从哪来）正交。
    storage_tier: str = "cell"
    connector_id: str | None = None
    source_name: str | None = None
    source_ref: str | None = None
    columns: list[ColumnIn] = []
    row_count: int = 0
    size_bytes: int = 0
    sync_cron: str | None = None
    sync_status: str = "idle"
    paused_reason: str | None = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_dataset(cls, dataset) -> "DatasetOut":
        return cls(
            id=dataset.id,
            key=dataset.key,
            name=dataset.name,
            source_kind=dataset.source_kind,
            storage_tier=getattr(dataset, "storage_tier", "cell"),
            connector_id=dataset.connector_id,
            source_name=getattr(dataset, "source_name", None),
            source_ref=dataset.source_ref,
            columns=[ColumnIn(**c) for c in (dataset.columns_json or [])],
            row_count=dataset.row_count,
            size_bytes=dataset.size_bytes,
            sync_cron=dataset.sync_cron,
            sync_status=dataset.sync_status,
            paused_reason=dataset.paused_reason,
            created_at=dataset.created_at,
            updated_at=dataset.updated_at,
        )


class UploadOut(BaseModel):
    """上传预览：建档前呈现列名与推断类型 + 样例行。"""

    upload_id: str
    filename: str
    columns: list[ColumnIn]
    row_count: int
    within_limit: bool = True
    sample_rows: list[dict[str, Any]] = []


class DatasetQuotaOut(BaseModel):
    """免费档配额视图（wire-free-tier-data-gate §7；付费档 max 为 null =
    无此限额，控制台隐藏配额条）。"""

    model_config = ConfigDict(from_attributes=True)

    plan_code: str
    #: 免费档口径的已用数据集个数（= api 层数据集数）
    used_datasets: int
    max_datasets: int | None = None
    max_rows_per_dataset: int | None = None


class CorrectionIn(BaseModel):
    """修正三件套：

    - ``{op:"update", row_id, column, value}`` 改值
    - ``{op:"delete", row_id}`` 删行
    - ``{op:"insert", values}`` 加行

    ``row_id`` = 预览行的 ``__row_id``（行锚，引擎算）。
    """

    op: Literal["update", "delete", "insert"]
    row_id: str | None = None
    column: str | None = None
    value: Any = None
    values: dict[str, Any] | None = None


class CorrectionOut(BaseModel):
    """修正写入回执（引擎 correction_id）。"""

    correction_id: int


class ResumeIn(BaseModel):
    """漂移人工确认：接受新 schema（``accept_columns`` 覆盖 columns_json）。"""

    accept_columns: list[ColumnIn] = Field(min_length=1)


class SyncOut(BaseModel):
    """同步历史行（客户可见；失败原因如实呈现）。"""

    model_config = ConfigDict(from_attributes=True)

    id: str
    dataset_id: str
    started_at: datetime
    finished_at: datetime | None = None
    status: str
    rows: int = 0
    error: str | None = None


class PairingTokenOut(BaseModel):
    """配对令牌：15 分钟、单次；明文只在本响应出现一次。"""

    token: str
    expires_at: datetime


class ConnectorOut(BaseModel):
    """连接器客户视图（状态由心跳推导，不落库）。"""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    version: str | None = None
    status: str
    last_heartbeat_at: datetime | None = None
    created_at: datetime
    revoked_at: datetime | None = None
    dataset_count: int = 0


class ConnectorPatchIn(BaseModel):
    """改名（白名单/调度变更走数据集端点）。"""

    name: str = Field(min_length=1, max_length=200)


class PairIn(BaseModel):
    """连接器换取 key：配对令牌 + 自报名称/版本。"""

    token: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=200)
    version: str | None = Field(default=None, max_length=64)


class PairOut(BaseModel):
    """配对回执：connector_key 明文仅此一次（库内只存 sha256）。"""

    connector_key: str
    connector_id: str


class HeartbeatIn(BaseModel):
    """心跳：版本 + 可选同步态（同步态不落库，仅在线判定用）。"""

    version: str | None = Field(default=None, max_length=64)
    sync_state: dict[str, Any] | None = None


class HeartbeatOut(BaseModel):
    """心跳回执：轮询间隔（秒），连接器据此节拍。"""

    poll_interval_seconds: int


class SyncBeginIn(BaseModel):
    """推送阶段一：声明 schema 与行数（漂移/配额判定在这里，先于引擎调用）。"""

    dataset_key: str = Field(min_length=1, max_length=40)
    columns: list[ColumnIn] = Field(min_length=1)
    pk_columns: list[str] = []
    row_count: int | None = Field(default=None, ge=0)


class SyncBeginOut(BaseModel):
    """begin 回执：sync_id 供后续 chunk/commit/abort。"""

    sync_id: str


class ChunkIn(BaseModel):
    """推送阶段二：单块 ≤2000 行（引擎侧同上限）。"""

    index: int = Field(ge=0)
    rows: list[dict[str, Any]] = Field(min_length=1, max_length=2000)


class ChunkOut(BaseModel):
    accepted: int


class CommitOut(BaseModel):
    status: Literal["ok"] = "ok"
    rows: int


class AbortOut(BaseModel):
    aborted: bool = True


class InternalConnectorOut(BaseModel):
    """内部概览：连接器健康（只读视图，无管理操作入口）。"""

    id: str
    status: str
    last_heartbeat_at: datetime | None = None


class InternalOverviewOut(BaseModel):
    """内部后台只读概览：per-cell 存储用量与连接器健康。"""

    customer_id: str
    datasets: int
    storage_bytes: int
    connectors: list[InternalConnectorOut]