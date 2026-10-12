"""数据集质量快照端点（wire-asset-catalog 任务组 4，customer 面）。

客户面鉴权与 datasets 切片同款（``Bearer ID token → require_console_customer_id``）：

- ``GET /api/v1/quality/summary?dataset_ids=a,b,c``——列表徽章聚合视图
  （freshness/last_refresh_at/row_count/status；任何登录角色含 viewer 可读）；
- ``GET /api/v1/datasets/{dataset_id}/quality``——详情：最新快照（失败/
  不支持如实呈现，不用旧值冒充）+ 历史趋势 + 新鲜度 + 声明节奏；
- ``POST /api/v1/datasets/{dataset_id}/quality/refresh``——手动触发
  （owner/editor；viewer 对变更类方法统一 403——wire-team-spaces 门禁），
  引擎计算在服务端完成，返回快照行（含 ``failed``/``unsupported`` 的
  如实失败记录）。

口径标注：质量信息是**指示性检查，非质量认证**（spec「呈现如实」），
两个读端点响应都带 ``note`` 字段，控制台据此外显。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..console.auth import require_console_customer_id
from ..datasets.db import get_db
from ..datasets.ingest import (
    EngineClientFactory,
    get_engine_client_factory,
)
from ..datasets.models import Dataset
from ..datasets.routes import require_cell_tier
from . import service
from .service import DISCLAIMER

router = APIRouter(tags=["dataset-quality"])

#: 单次 summary 的 dataset_ids 数量上限（列表页徽章批量拉取的合理上界）
_SUMMARY_MAX_IDS = 200


def _dataset_or_404(db: Session, dataset_id: str, customer_id: str) -> Dataset:
    """数据集属主校验（跨企业/不存在一律 404，不泄露存在性）。"""
    dataset = db.get(Dataset, dataset_id)
    if dataset is None or dataset.customer_id != customer_id:
        raise HTTPException(status_code=404, detail=f"数据集 {dataset_id} 不存在")
    return dataset


@router.get("/api/v1/quality/summary")
def get_quality_summary(
    dataset_ids: str = Query(
        ..., description="逗号分隔的数据集 id 列表（列表页徽章批量拉取）"
    ),
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> dict:
    """徽章聚合：每数据集 freshness + last_refresh_at + row_count + status。"""
    ids: list[str] = []
    for chunk in dataset_ids.split(","):
        name = chunk.strip()
        if name and name not in ids:
            ids.append(name)
    if not ids:
        raise HTTPException(status_code=422, detail="dataset_ids 不能为空")
    if len(ids) > _SUMMARY_MAX_IDS:
        raise HTTPException(
            status_code=422,
            detail=f"dataset_ids 一次至多 {_SUMMARY_MAX_IDS} 个（本次 {len(ids)}）",
        )
    statuses = service.quality_summary(db, customer_id, ids)
    return {"statuses": statuses, "note": DISCLAIMER}


@router.get("/api/v1/datasets/{dataset_id}/quality")
def get_dataset_quality(
    dataset_id: str,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
) -> dict:
    """质量详情：latest（含失败/不支持如实态）+ 历史趋势 + 新鲜度 + 节奏。"""
    dataset = _dataset_or_404(db, dataset_id, customer_id)
    return service.quality_detail(db, dataset)


@router.post("/api/v1/datasets/{dataset_id}/quality/refresh")
def refresh_dataset_quality(
    dataset_id: str,
    customer_id: str = Depends(require_console_customer_id),
    db: Session = Depends(get_db),
    engine_factory: EngineClientFactory = Depends(get_engine_client_factory),
) -> dict:
    """手动触发一次质量快照（owner/editor；viewer 403 由统一角色门禁拦）。

    返回快照行本身——引擎失败/不支持时行内 ``status``/``error_text``
    如实呈现（不伪造成功）。api 层数据集（免费档）403 档位闸：质量计算
    在 cell 引擎侧，api 层数据不在引擎侧，平台侧直读被红线禁止。
    """
    dataset = _dataset_or_404(db, dataset_id, customer_id)
    require_cell_tier(dataset, "质量快照")
    snapshot = service.capture_snapshot(
        customer_id,
        dataset,
        service.TRIGGER_MANUAL,
        client=engine_factory(customer_id),
        db=db,
    )
    return service.snapshot_to_dict(snapshot)
