"""追踪主体服务（wire-subject-tracking）。

职责分四块：

1. **CRUD**：主体与其通道的声明/读取/删除（客户隔离，他企 404）。
2. **read**：扇出全通道、逐个 try 包裹（失败隔离），合并对齐时间轴。
3. **snapshot**：把一次 read 结果落成客户数据集（``source_kind="subject"``、
   显式 ``storage_tier=api``——数据物理在 api 层行存储，见 design D2/D5），幂等。
4. **削面装配**：为 workbench / 调度提供计数与执行入口。

所有上游调用经 projectors（客户端可注入）。事务边界：CRUD 与快照各自 commit；
快照失败整段 rollback 零半写。
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..datasets import api_store
from ..datasets import service as datasets_service
from ..datasets.models import Dataset
from . import projectors as proj
from .models import CHANNEL_TYPES, SUBJECT_KINDS, Subject, SubjectChannel


class SubjectError(ValueError):
    """领域错误（route 层译 4xx）。"""


class SubjectNotFound(SubjectError):
    """主体不存在或他企（不泄露存在性 → 404）。"""


# ---------------------------------------------------------------------------
# 客户端工厂（可注入）
# ---------------------------------------------------------------------------


def get_info_client():
    """fd-info 客户端（复用 artifacts 的 HttpInfoClient；FD_INFO_URL 缺省时 None）。"""
    import os

    from ..artifacts.info_contract import HttpInfoClient

    url = os.environ.get("FD_INFO_URL")
    if not url:
        return None
    return HttpInfoClient(url, os.environ.get("FD_INFO_TOKEN") or None)


def _subject_mcp_url() -> str:
    """主体通道上游端点（business-mcp 类工具面）。

    解析顺序：``SUBJECT_MCP_URL`` 显式覆盖 → ``INDICATOR_FETCH_URL``（与建集
    同源）→ ``indicator_fetch`` 的代码默认。之所以留 SUBJECT_MCP_URL：生产
    cheap 集群无 business-mcp，指标/工商/背景通道要指到实际可达的联邦服务
    （如 fd-open-data-mcp 或经 registry 的 business 条目）；端点配错时各通道
    如实 unavailable，不崩（失败隔离见 projectors）。
    """
    import os

    from ..datasets.indicator_fetch import get_indicator_fetch_settings

    explicit = os.environ.get("SUBJECT_MCP_URL")
    if explicit:
        raw = explicit.rstrip("/")
        return raw if raw.endswith("/mcp") else f"{raw}/mcp"
    return get_indicator_fetch_settings().mcp_url


def get_business_caller():
    """business-mcp 类工具面客户端（NativeMcpClient 包一层；端点见 _subject_mcp_url）。

    凭据解析：``SUBJECT_MCP_TOKEN`` 显式覆盖 → ``AI_PLATFORM_CREDENTIAL``（平台
    服务凭据——经 registry 入口调 business-mcp 的计量轨凭据，生产实测 200）→
    ``INDICATOR_FETCH_TOKEN``。生产经 registry 入口时用平台凭据；直连
    business-mcp 时用 internal token。
    """
    import os

    from fd_mcp_client import NativeMcpClient
    from ..datasets.indicator_fetch import get_indicator_fetch_settings

    url = _subject_mcp_url()
    token = (
        os.environ.get("SUBJECT_MCP_TOKEN")
        or os.environ.get("AI_PLATFORM_CREDENTIAL")
        or get_indicator_fetch_settings().indicator_fetch_token
        or None
    )

    class _Caller:
        def __init__(self) -> None:
            self._client = NativeMcpClient(url, credential=token, label="主体追踪端点")

        def call(self, tool: str, args: dict[str, Any]) -> dict[str, Any]:
            return self._client.call(tool, args)

        def close(self) -> None:
            self._client.close()

    return _Caller()


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


def _validate_channels(channels: list[dict]) -> list[dict]:
    """通道声明校验：type ∈ 词表、spec 必备参数齐全。非法抛 SubjectError（route 译 422）。"""
    out: list[dict] = []
    for ch in channels:
        ctype = ch.get("type")
        if ctype not in CHANNEL_TYPES:
            raise SubjectError(f"通道类型非法：{ctype!r}（合法：{sorted(CHANNEL_TYPES)}）")
        spec = ch.get("spec") or {}
        if ctype == "indicators" and not spec.get("indicator_ids"):
            raise SubjectError("indicators 通道缺 indicator_ids")
        if ctype == "context" and not (spec.get("indicator_ids") or spec.get("entity_type")):
            raise SubjectError("context 通道缺 indicator_ids 或 entity_type")
        out.append({"type": ctype, "spec": spec})
    return out


def create_subject(
    db: Session, *, customer_id: str, kind: str, ref: dict, title: str,
    description: str | None, channels: list[dict],
) -> Subject:
    if kind not in SUBJECT_KINDS:
        raise SubjectError(f"kind 非法：{kind!r}（合法：{sorted(SUBJECT_KINDS)}）")
    if not ref or not ref.get("source"):
        raise SubjectError("ref 必须含 source")
    validated = _validate_channels(channels)
    subject = Subject(
        customer_id=customer_id, kind=kind, ref=ref, title=title.strip(),
        description=description,
    )
    for ch in validated:
        subject.channels.append(SubjectChannel(type=ch["type"], spec=ch["spec"]))
    db.add(subject)
    db.flush()
    return subject


def list_subjects(db: Session, *, customer_id: str, kind: str | None = None) -> list[Subject]:
    stmt = select(Subject).where(Subject.customer_id == customer_id).order_by(Subject.id.desc())
    if kind:
        stmt = stmt.where(Subject.kind == kind)
    return list(db.execute(stmt).scalars())


def get_subject(db: Session, *, customer_id: str, subject_id: int) -> Subject:
    subject = db.get(Subject, subject_id)
    if subject is None or subject.customer_id != customer_id:
        raise SubjectNotFound(f"主体 {subject_id} 不存在")
    return subject


def archive_subject(db: Session, *, customer_id: str, subject_id: int) -> None:
    subject = get_subject(db, customer_id=customer_id, subject_id=subject_id)
    db.delete(subject)  # cascade 删通道（models 的 delete-orphan）


def add_channel(
    db: Session, *, customer_id: str, subject_id: int, ctype: str, spec: dict
) -> SubjectChannel:
    subject = get_subject(db, customer_id=customer_id, subject_id=subject_id)
    validated = _validate_channels([{"type": ctype, "spec": spec}])[0]
    ch = SubjectChannel(subject_id=subject.id, type=validated["type"], spec=validated["spec"])
    db.add(ch)
    db.flush()
    return ch


def remove_channel(db: Session, *, customer_id: str, subject_id: int, channel_id: int) -> None:
    subject = get_subject(db, customer_id=customer_id, subject_id=subject_id)
    ch = db.get(SubjectChannel, channel_id)
    if ch is None or ch.subject_id != subject.id:
        raise SubjectNotFound(f"通道 {channel_id} 不属于主体 {subject_id}")
    db.delete(ch)


def count_by_kind(db: Session, *, customer_id: str) -> dict[str, int]:
    rows = db.execute(
        select(Subject.kind, Subject.id).where(Subject.customer_id == customer_id)
    ).all()
    counts: dict[str, int] = {}
    for kind, _ in rows:
        counts[kind] = counts.get(kind, 0) + 1
    return counts


# ---------------------------------------------------------------------------
# read：扇出 + 时间轴
# ---------------------------------------------------------------------------


def read_subject(
    db: Session,
    *,
    customer_id: str,
    subject_id: int,
    info_client=None,
    business_caller=None,
) -> dict[str, Any]:
    subject = get_subject(db, customer_id=customer_id, subject_id=subject_id)
    rr = proj.resolve_ref(subject.kind, subject.ref or {})

    info = info_client if info_client is not None else get_info_client()
    biz = business_caller if business_caller is not None else get_business_caller()
    own_biz = business_caller is None

    results: list[proj.ChannelResult] = []
    try:
        for ch in subject.channels:
            results.append(_project_one(ch, rr, info, biz))
    finally:
        if own_biz and hasattr(biz, "close"):
            biz.close()

    timeline = _merge_timeline(results)
    return {
        "subject": _subject_dict(subject),
        "channels": [r.to_dict() for r in results],
        "timeline": timeline,
        "as_of": _now_iso(),
    }


def _project_one(ch: SubjectChannel, rr: proj.ResolvedRef, info, biz) -> proj.ChannelResult:
    """单个通道，try 包裹——任一通道异常只影响该通道。"""
    try:
        if ch.type == "indicators":
            return proj.project_indicators(rr, ch.spec, biz)
        if ch.type == "announcements":
            if info is None:
                return proj.unavailable("announcements", "fd-info 未配置（FD_INFO_URL）")
            return proj.project_announcements(rr, ch.spec, info)
        if ch.type == "registry":
            return proj.project_registry(rr, ch.spec, biz)
        if ch.type == "graph":
            return proj.project_graph(rr, ch.spec, biz)
        if ch.type == "context":
            return proj.project_context(rr, ch.spec, biz)
        return proj.unavailable(ch.type, f"未知通道类型：{ch.type}")
    except Exception as exc:  # noqa: BLE001 - 失败隔离：一个通道挂了不拖整次读
        return proj.unavailable(ch.type, f"通道读取异常: {exc}")


def _merge_timeline(results: list[proj.ChannelResult]) -> list[dict]:
    """把各通道 rows 归一成 {date, channel, summary, ref} 按 date DESC 合并。

    **不推断因果**——只是时间对齐的事实视图（design D4）。
    """
    events: list[dict] = []
    for r in results:
        if r.coverage == proj.COVERAGE_UNAVAILABLE:
            continue
        for row in r.rows:
            date = _row_date(row)
            if not date:
                continue
            events.append({
                "date": date,
                "channel": r.type,
                "summary": _row_summary(row),
                "ref": _row_ref(r.type, row),
            })
    events.sort(key=lambda e: e["date"], reverse=True)
    return events


def _row_date(row: dict) -> str | None:
    for key in ("published_at", "date", "time", "as_of", "snapshot_year"):
        v = row.get(key)
        if v:
            return str(v)[:10]
    return None


def _row_summary(row: dict) -> str:
    for key in ("title", "name", "企业名称", "summary", "value", "code"):
        if row.get(key) is not None:
            return str(row[key])[:200]
    return ""


def _row_ref(ctype: str, row: dict) -> dict[str, Any]:
    if ctype == "announcements":
        return {"item_id": row.get("item_id"), "source": row.get("source")}
    if ctype in ("indicators", "context"):
        return {"indicator_id": row.get("indicator_id"), "date": row.get("date")}
    if ctype == "graph":
        return {"code": row.get("code") or row.get("node"), "entity_type": row.get("entity_type")}
    return {"code": row.get("credit_code") or row.get("code")}


# ---------------------------------------------------------------------------
# snapshot：物化为客户数据集（幂等）
# ---------------------------------------------------------------------------


#: 快照行形状（扁平时间轴）——列定义稳定，供 panel/alert query 引用。
SNAPSHOT_COLUMNS = [
    {"name": "date", "type": "TEXT"},
    {"name": "channel", "type": "TEXT"},
    {"name": "summary", "type": "TEXT"},
    {"name": "ref_json", "type": "TEXT"},
]


def snapshot_subject(
    db: Session,
    *,
    customer_id: str,
    subject_id: int,
    info_client=None,
    business_caller=None,
) -> Dataset:
    """把一次 read 结果落成客户数据集（``source_kind="subject"``）。

    幂等：同客户 + 同 subject（source_ref=subject_id）有活跃快照集则更新其行，
    否则新建。显式 ``storage_tier=api``（数据在 api 层行存储）。行数/存储闸照
    既有建集规则，失败整段 rollback 零半写。
    """
    subject = get_subject(db, customer_id=customer_id, subject_id=subject_id)
    read = read_subject(
        db, customer_id=customer_id, subject_id=subject_id,
        info_client=info_client, business_caller=business_caller,
    )
    rows = [
        {
            "date": e["date"],
            "channel": e["channel"],
            "summary": e["summary"],
            "ref_json": json.dumps(e["ref"], ensure_ascii=False),
        }
        for e in read["timeline"]
    ]
    size_bytes = sum(len(json.dumps(r, ensure_ascii=False, default=str)) for r in rows)

    datasets_service.ensure_storage_quota(db, customer_id=customer_id, incoming_bytes=size_bytes)

    existing = db.execute(
        select(Dataset).where(
            Dataset.customer_id == customer_id,
            Dataset.source_kind == "subject",
            Dataset.source_ref == str(subject_id),
        ).order_by(Dataset.created_at.desc()).limit(1)
    ).scalars().first()

    if existing is not None:
        dataset = existing
        api_store.ingest_indicator_rows(
            db, dataset=dataset, columns=SNAPSHOT_COLUMNS, rows=rows, size_bytes=size_bytes
        )
    else:
        dataset = Dataset(
            customer_id=customer_id,
            key=datasets_service.allocate_key(db, customer_id=customer_id,
                                              name=f"主体-{subject.title}"),
            name=f"追踪·{subject.title}",
            source_kind="subject",
            source_ref=str(subject_id),
            columns_json=SNAPSHOT_COLUMNS,
            row_count=0,
            size_bytes=0,
            sync_status="ok",
            storage_tier=datasets_service.TIER_API,  # D2：数据在 api 层，显式锁
        )
        db.add(dataset)
        db.flush()
        api_store.ingest_indicator_rows(
            db, dataset=dataset, columns=SNAPSHOT_COLUMNS, rows=rows, size_bytes=size_bytes
        )

    subject.snapshot_dataset_id = dataset.id
    db.commit()
    db.refresh(dataset)
    return dataset


# ---------------------------------------------------------------------------
# 内部工具
# ---------------------------------------------------------------------------


def _subject_dict(subject: Subject) -> dict[str, Any]:
    return {
        "id": subject.id,
        "kind": subject.kind,
        "ref": subject.ref or {},
        "title": subject.title,
        "description": subject.description,
        "snapshot_dataset_id": subject.snapshot_dataset_id,
        "channels": [
            {"id": c.id, "type": c.type, "spec": c.spec or {}} for c in subject.channels
        ],
    }


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
