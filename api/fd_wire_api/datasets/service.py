"""datasets 切片业务逻辑：配额、漂移判定、状态机与凭据散列。

契约锚点：
- 配额（§3.1/§3.4）：存储上限与行上限均为套餐杠杆，超限 fail-closed
  （拒收新同步/新数据集），如实带恢复途径提示。
- 漂移（§3.4）：判定在 **api 侧**——新 columns 相对 ``datasets.columns_json``
  增列=接受并追加；缺列/类型变=拒绝 + ``paused_drift``，**不调引擎**。
- 连接器状态（§3.4）：由心跳推导（``now - last_heartbeat_at > 3×poll``
  → offline），不落库。
- 凭据（§6.4）：配对令牌与连接器 key 只存 sha256；明文只在签发当次响应。
"""

from __future__ import annotations

import hashlib
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Connector, Dataset
from .settings import get_settings

#: 配对令牌有效期（契约 §3.4：15 分钟、单次）
PAIRING_TOKEN_TTL_MINUTES = 15
PAIRING_TOKEN_PREFIX = "fwp_"
CONNECTOR_KEY_PREFIX = "fwc_"

_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")


class QuotaExceeded(RuntimeError):
    """配额超限（路由层转 429；带恢复途径提示）。"""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class DriftDetected(RuntimeError):
    """破坏性 schema 漂移（路由层转 409；``differences`` 机器可读）。"""

    def __init__(self, message: str, differences: list[dict]):
        super().__init__(message)
        self.differences = differences


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def sha256_hex(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_pairing_token() -> tuple[str, str, datetime]:
    """返回 (明文, sha256, 过期时间)——明文只进响应，绝不落库。"""
    token = PAIRING_TOKEN_PREFIX + secrets.token_urlsafe(32)
    return token, sha256_hex(token), utcnow() + timedelta(minutes=PAIRING_TOKEN_TTL_MINUTES)


def new_connector_key() -> tuple[str, str]:
    token = CONNECTOR_KEY_PREFIX + secrets.token_urlsafe(32)
    return token, sha256_hex(token)


def find_by_hash(rows, raw: str, *, attr: str = "token_hash"):
    """恒定时间比对（``secrets.compare_digest``）挑出散列匹配行。"""
    digest = sha256_hex(raw)
    for row in rows:
        if secrets.compare_digest(getattr(row, attr), digest):
            return row
    return None


# ------------------------------------------------------------------ dataset key


def slugify(name: str) -> str:
    """名称 → dataset_key 基座：``^[a-z][a-z0-9_]{0,39}$``（冲突由调用方加）。

    首字符非字母时统一加 ``ds_`` 前缀（数字开头非法）；超长截断到 40。
    """
    slug = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")
    if not slug:
        slug = "dataset"
    if not slug[0].isalpha():
        slug = f"ds_{slug}"
    return slug[:40].rstrip("_") or "dataset"


def allocate_key(db: Session, *, customer_id: str, name: str) -> str:
    """企业内唯一 key：基座冲突时追加 ``_2``/``_3``…（契约 §1）。"""
    base = slugify(name)
    for seq in range(1, 1000):
        candidate = base if seq == 1 else _with_suffix(base, seq)
        if not _KEY_RE.match(candidate):  # pragma: no cover - slugify 已保证
            raise RuntimeError(f"slug 产物不合 dataset_key 约定: {candidate!r}")
        exists = db.execute(
            select(Dataset.id).where(
                Dataset.customer_id == customer_id, Dataset.key == candidate
            )
        ).first()
        if not exists:
            return candidate
    raise RuntimeError(f"无法为 {name!r} 分配 dataset_key（冲突过多）")  # pragma: no cover


def _with_suffix(base: str, seq: int) -> str:
    suffix = f"_{seq}"
    return base[: 40 - len(suffix)].rstrip("_") + suffix


# ------------------------------------------------------------------ 配额


def dataset_storage_total(
    db: Session, *, customer_id: str, exclude_dataset_id: str | None = None
) -> int:
    conditions = [Dataset.customer_id == customer_id]
    if exclude_dataset_id is not None:
        conditions.append(Dataset.id != exclude_dataset_id)
    total = db.execute(
        select(func.coalesce(func.sum(Dataset.size_bytes), 0)).where(*conditions)
    ).scalar_one()
    return int(total or 0)


def ensure_storage_quota(
    db: Session,
    *,
    customer_id: str,
    incoming_bytes: int,
    exclude_dataset_id: str | None = None,
) -> None:
    """存储配额 fail-closed：``其他数据集已用 + 本次预期 > 上限`` 即 429。"""
    limit = get_settings().dataset_storage_limit_bytes
    used = dataset_storage_total(
        db, customer_id=customer_id, exclude_dataset_id=exclude_dataset_id
    )
    if used + max(int(incoming_bytes), 0) > limit:
        raise QuotaExceeded(
            f"存储用量将超过配额（已用 {used} + 本次 {incoming_bytes} > {limit} 字节）——"
            "请删除不再需要的数据集，或联系平台提高配额"
        )


def ensure_new_dataset_room(db: Session, *, customer_id: str) -> None:
    """新数据集 fail-closed 前置：已用存储已达上限即 429（无空余可分配）。"""
    limit = get_settings().dataset_storage_limit_bytes
    used = dataset_storage_total(db, customer_id=customer_id)
    if used >= limit:
        raise QuotaExceeded(
            f"存储用量已达配额（{used} ≥ {limit} 字节）——"
            "请删除不再需要的数据集，或联系平台提高配额"
        )


def ensure_row_quota(row_count: int | None) -> None:
    """行上限 fail-closed（与引擎 ``CUSTOMER_DATASET_MAX_ROWS`` 同默认）。"""
    if row_count is None:
        return
    limit = get_settings().dataset_max_rows
    if int(row_count) > limit:
        raise QuotaExceeded(
            f"行数 {row_count} 超过单数据集上限 {limit}——"
            "请拆分数据或联系平台提高配额"
        )


def estimate_bytes(dataset: Dataset, row_count: int | None) -> int:
    """按上次快照的均值估算本次快照字节数（无历史则 0=未知，交由提交后核对）。"""
    if not row_count:
        return 0
    if dataset.row_count and dataset.size_bytes:
        return int(row_count * (dataset.size_bytes / dataset.row_count))
    return 0


# ------------------------------------------------------------------ 漂移


def diff_columns(
    baseline: list[dict], incoming: list[dict]
) -> tuple[list[dict], list[dict]]:
    """比对 columns 基线；返回 (接受后的 columns, differences)。

    增列（基线 ⊆ 新列，同型）接受并追加（引擎副本新增可空列）；缺列或
    类型变即破坏性漂移——differences 机器可读、逐列列出原因。基线为空
    （首次同步/首次建档）任何形态都接受。
    """
    normalized = [
        {"name": str(column.get("name")), "type": str(column.get("type") or "TEXT")}
        for column in incoming
    ]
    if not baseline:
        return normalized, []
    base_types = {str(c.get("name")): str(c.get("type")) for c in baseline}
    incoming_types = {c["name"]: c["type"] for c in normalized}
    differences: list[dict] = []
    for name, old_type in base_types.items():
        if name not in incoming_types:
            differences.append(
                {"column": name, "kind": "missing", "expected": old_type, "actual": None}
            )
        elif incoming_types[name] != old_type:
            differences.append(
                {
                    "column": name,
                    "kind": "type_changed",
                    "expected": old_type,
                    "actual": incoming_types[name],
                }
            )
    if differences:
        return [], differences
    merged = [
        {"name": str(c.get("name")), "type": str(c.get("type"))} for c in baseline
    ]
    merged += [c for c in normalized if c["name"] not in base_types]
    return merged, []


def drift_message(differences: list[dict]) -> str:
    parts = []
    for diff in differences:
        if diff["kind"] == "missing":
            parts.append(f"列 {diff['column']} 缺失")
        elif diff["kind"] == "type_changed":
            parts.append(
                f"列 {diff['column']} 类型变更（{diff['expected']}→{diff['actual']}）"
            )
        else:  # pragma: no cover - 未来种类兜底
            parts.append(f"列 {diff.get('column')} 漂移（{diff['kind']}）")
    return "drift: " + "；".join(parts)


# ------------------------------------------------------------------ 连接器状态


def connector_online_at(connector: Connector, *, now: datetime | None = None) -> bool:
    if connector.revoked_at is not None or connector.last_heartbeat_at is None:
        return False
    now = now or utcnow()
    return (now - connector.last_heartbeat_at) <= timedelta(
        seconds=get_settings().heartbeat_offline_seconds
    )


def connector_status(connector: Connector, *, now: datetime | None = None) -> str:
    """推导状态（不落库）：revoked > offline > online。"""
    if connector.revoked_at is not None:
        return "revoked"
    return "online" if connector_online_at(connector, now=now) else "offline"


def new_uuid() -> str:
    return str(uuid.uuid4())