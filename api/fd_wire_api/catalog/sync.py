"""IndicatorRegistrySync：镜像的唯一写路径（同步管道）。

流程（幂等，可重入）：
1. 读 ``CatalogSyncState.last_watermark``（增量游标）；
2. 经 ``RegistryClient`` 拉取：无水位或 ``force_full`` 时全量，否则增量
   （只拉权威库 updated_at > 水位的记录）；
3. 以 ``indicator_id`` 为锚点 upsert 镜像行并刷新 ``synced_at``；
   全量拉取时额外对账——权威库已删除的指标从镜像中移除（镜像语义）；
4. 推进水位并记录运行状态（成功/失败均落 ``CatalogSyncState``）。

代码层面镜像表没有任何其他写路径：查询侧（service/routes）只拿得到
``db.readonly_session()``，其写语句会被模型层 guard 拒绝。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select

from .client import ConceptRecord, RegistryClient, utcnow
from .db import sync_session
from .models import CatalogSyncState, IndicatorSnapshot

_STATE_ROW_ID = 1

_SYNC_FIELDS = (
    "code",
    "name_zh",
    "name_en",
    "description_zh",
    "description_en",
    "domain",
    "frequency",
    "time_span_start",
    "time_span_end",
    "entity_coverage_count",
    "sample_value",
    "status",
)


@dataclass
class SyncResult:
    """一次同步的汇总（手动触发端点与调度日志消费）。"""

    mode: str = "full"  # full | incremental
    fetched: int = 0
    created: int = 0
    updated: int = 0
    removed: int = 0
    total_in_mirror: int = 0
    watermark: datetime | None = None
    errors: list[str] = field(default_factory=list)


def _load_state(session) -> CatalogSyncState:
    state = session.get(CatalogSyncState, _STATE_ROW_ID)
    if state is None:
        state = CatalogSyncState(id=_STATE_ROW_ID)
        session.add(state)
    return state


def _apply_record(session, existing: dict[str, IndicatorSnapshot], record: ConceptRecord, now: datetime) -> str:
    """upsert 一条权威记录；返回 'created' | 'updated'。"""
    row = existing.get(record.indicator_id)
    if row is None:
        row = IndicatorSnapshot(indicator_id=record.indicator_id, synced_at=now)
        session.add(row)
        existing[record.indicator_id] = row
        outcome = "created"
    else:
        outcome = "updated"
    for attr in _SYNC_FIELDS:
        setattr(row, attr, getattr(record, attr))
    row.synced_at = now
    return outcome


class IndicatorRegistrySync:
    """从权威源同步指标镜像（仓库内唯一镜像写入口）。"""

    def __init__(self, client: RegistryClient, session_factory=sync_session, clock=utcnow):
        self._client = client
        self._session_factory = session_factory
        self._clock = clock

    def run(self, force_full: bool = False) -> SyncResult:
        now = self._clock()
        session = self._session_factory()
        try:
            state = _load_state(session)
            watermark = None if force_full else state.last_watermark
            batch = self._client.fetch_concepts(
                updated_since=watermark, force_full=force_full
            )
            result = SyncResult(
                mode="full" if (watermark is None or force_full) else "incremental",
                fetched=len(batch.items),
            )

            existing = {
                row.indicator_id: row
                for row in session.execute(select(IndicatorSnapshot)).scalars()
            }
            previous_total = len(existing)
            for record in batch.items:
                outcome = _apply_record(session, existing, record, now)
                if outcome == "created":
                    result.created += 1
                else:
                    result.updated += 1

            if result.mode == "full":
                # 全量对账：权威库不再存在的指标从镜像移除
                fetched_ids = {rec.indicator_id for rec in batch.items}
                for indicator_id, row in existing.items():
                    if indicator_id not in fetched_ids:
                        session.delete(row)
                        result.removed += 1

            result.total_in_mirror = previous_total + result.created - result.removed
            result.watermark = batch.next_watermark or now
            state.last_watermark = result.watermark
            state.last_success_at = now
            state.last_run_at = now
            state.last_status = "ok"
            state.last_error = None
            session.commit()
            return result
        except Exception as exc:
            session.rollback()
            self._record_failure(exc)
            raise
        finally:
            session.close()

    def _record_failure(self, exc: Exception) -> None:
        """失败也要留痕（独立 session，避免污染已回滚的事务）。"""
        try:
            session = self._session_factory()
            try:
                state = _load_state(session)
                state.last_run_at = self._clock()
                state.last_status = "error"
                state.last_error = f"{type(exc).__name__}: {exc}"
                session.commit()
            finally:
                session.close()
        except Exception:  # pragma: no cover - 留痕失败不应掩盖原始异常
            pass
