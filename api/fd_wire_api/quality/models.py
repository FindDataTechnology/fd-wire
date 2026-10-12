"""质量快照 ORM 模型（wire-asset-catalog 任务组 4，design D2/D4/D6）。

``dataset_quality_snapshots`` 挂 ``DatasetsBase``（与 datasets 切片同库
同引擎；生产走 alembic 0031，``create_all`` 为开发兜底）：

- **只追加**（append-only）：全模块只有 INSERT 与保留期清理（裁剪最旧
  行），不存在任何 UPDATE 路径与改/删端点——历史快照不可改，趋势可信
  （spec「历史不可改」；与 asset_meta_events 同款代码纪律，DB 层不加
  不可变机器）。
- **只有聚合计数与比率，绝无数据值**（红线 2 的存储面落地）：行数、
  主键唯一性比例、按列样本空值率（列名 + 比率 + 抽样行数）——写入前经
  :func:`fd_wire_api.quality.service._sanitize_null_rates` 白名单过滤，
  引擎多给的任何字段（含可能的样本行）一律丢弃。
- 失败如实：引擎不支持（旧 cell 无质量工具）落 ``unsupported``、其他
  失败落 ``failed`` + ``error_text``，绝不用旧快照冒充当前值。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..datasets.db import DatasetsBase


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


#: 触发方式枚举（spec「快照触发时机」：创建/同步/派生/手动）
TRIGGERED_BY_VALUES: tuple[str, ...] = ("create", "sync", "materialize", "manual")

#: 快照状态常量（ok=正常；unsupported=引擎暂不支持；failed=计算失败）
STATUS_OK = "ok"
STATUS_FAILED = "failed"
STATUS_UNSUPPORTED = "unsupported"

#: 快照状态枚举（spec「引擎不支持时降级显示」）
STATUS_VALUES: tuple[str, ...] = (STATUS_OK, STATUS_FAILED, STATUS_UNSUPPORTED)


class DatasetQualitySnapshot(DatasetsBase):
    """数据集质量快照（每数据集保留最近 N 条，N 见 quality/settings）。

    列语义（除 ``error_text`` 外全部来自引擎 ``customer_dataset_quality``
    工具的聚合输出；缺字段诚实置 NULL，绝不猜数）：

    - ``computed_at``：引擎侧计算时间（解析失败回落平台当前时间）；
    - ``row_count``：数据集行数（引擎聚合计数）；
    - ``pk_declared`` / ``pk_unique_ratio``：是否声明键列 / 键唯一性比例；
      **未声明键列时比例恒为 NULL**（不给伪造数字，spec「诚实处理」）；
    - ``null_rates_json``：``[{column, null_rate, sampled_rows}]``（按列
      样本空值率；白名单过滤，只承载聚合比率）；
    - ``sample_limit_hit``：空值率抽样是否触顶（超限标注，不谎报全量）。
    """

    __tablename__ = "dataset_quality_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    dataset_id: Mapped[str] = mapped_column(String(36), index=True)
    computed_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow_naive)
    #: create | sync | materialize | manual
    triggered_by: Mapped[str] = mapped_column(String(16))
    #: ok | failed | unsupported
    status: Mapped[str] = mapped_column(String(16))
    row_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    pk_unique_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    pk_declared: Mapped[bool] = mapped_column(Boolean, default=False)
    null_rates_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    sample_limit_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    error_text: Mapped[str | None] = mapped_column(Text, nullable=True)
