"""数据需求单八态状态机（wire-demand-pipeline 切片 6.3）。

状态全集（8 态）：
    submitted → evaluating → quoted → awaiting_confirm → building
    → delivery_acceptance → delivered；评估开始的各态可 → rejected。

纪律：
- 迁移只经 ``ALLOWED_TRANSITIONS`` 白名单，非法迁移抛 ``TransitionError``
  （路由层统一转 409）。
- ``evaluating → quoted`` 有硬前置：后台人工报价确认
  ``confirmed_by_operator=true``，没有人工确认绝不进 quoted。
- ``building → delivery_acceptance`` 有硬前置（任务 6.5）：必须已有一条
  conformance gate 通过记录（``gate_passed=true``，来自
  ``POST /internal/demands/{id}/gate-result``）——无通过记录直接 409，
  错误信息指明原因。
- 进入 ``rejected`` 必带 ``reason``，留档于 ``rejection_reason``。
- ``building → building`` 是唯一合法"停留"迁移：conformance gate 不过时
  需求单停留在构建中并如实追加构建问题 note，不进入交付验收。
- ``status_history`` 只追加（append-only），任何迁移不得改写历史条目。
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum


class DemandStatus(str, Enum):
    """需求单状态（客户全程可见）。"""

    submitted = "submitted"                    # 已提交
    evaluating = "evaluating"                  # 评估中（AI 预评估）
    quoted = "quoted"                          # 已报价（人工确认后）
    awaiting_confirm = "awaiting_confirm"      # 待确认（报价已发出）
    building = "building"                      # 构建中（爬虫流水线）
    delivery_acceptance = "delivery_acceptance"  # 交付验收
    delivered = "delivered"                    # 已交付
    rejected = "rejected"                      # 已拒绝（带理由留档）


#: 终态：不再有任何出边。
TERMINAL_STATUSES: frozenset[DemandStatus] = frozenset(
    {DemandStatus.delivered, DemandStatus.rejected}
)

#: 合法迁移白名单（current → 允许的 target 集合）。
#:
#: - submitted→evaluating          触发=后台/AI 接单开始预评估
#: - evaluating→quoted             前置=人工报价确认（confirmed_by_operator）
#: - evaluating→rejected           评估不可行（必带 reason）
#: - quoted→awaiting_confirm       报价发出给客户
#: - quoted→rejected               报价阶段撤单
#: - awaiting_confirm→building     客户确认报价，进入构建流水线
#: - awaiting_confirm→rejected     客户放弃/撤单
#: - building→delivery_acceptance  conformance gate 通过
#: - building→building             停留：gate 不过，如实展示构建问题 note
#: - delivery_acceptance→delivered 客户验收确认
ALLOWED_TRANSITIONS: dict[DemandStatus, frozenset[DemandStatus]] = {
    DemandStatus.submitted: frozenset({DemandStatus.evaluating}),
    DemandStatus.evaluating: frozenset({DemandStatus.quoted, DemandStatus.rejected}),
    DemandStatus.quoted: frozenset(
        {DemandStatus.awaiting_confirm, DemandStatus.rejected}
    ),
    DemandStatus.awaiting_confirm: frozenset(
        {DemandStatus.building, DemandStatus.rejected}
    ),
    DemandStatus.building: frozenset(
        {DemandStatus.delivery_acceptance, DemandStatus.building}
    ),
    DemandStatus.delivery_acceptance: frozenset({DemandStatus.delivered}),
    DemandStatus.delivered: frozenset(),
    DemandStatus.rejected: frozenset(),
}


class TransitionError(Exception):
    """非法迁移或前置条件不满足（路由层转 409）。"""

    def __init__(self, current: DemandStatus, target: DemandStatus, why: str) -> None:
        self.current = current
        self.target = target
        self.why = why
        super().__init__(f"{current.value} → {target.value} 不允许：{why}")


def utc_now_iso() -> str:
    """历史时间戳：UTC ISO-8601（客户时间线的 ``at`` 字段）。"""
    return datetime.now(timezone.utc).isoformat()


def allowed_targets(current: DemandStatus) -> frozenset[DemandStatus]:
    """当前状态允许迁往的状态集合。"""
    return ALLOWED_TRANSITIONS.get(current, frozenset())


def ensure_transition(
    current: DemandStatus,
    target: DemandStatus,
    *,
    confirmed_by_operator: bool = False,
    reason: str | None = None,
    note: str | None = None,
    gate_passed: bool = False,
) -> None:
    """校验一次迁移的合法性与其前置条件，非法即抛 ``TransitionError``。

    前置条件（在白名单之外额外强制）：
    - ``evaluating→quoted`` 必须 ``confirmed_by_operator=True``（人工报价确认）；
    - ``building→delivery_acceptance`` 必须 ``gate_passed=True``
      （有一条 conformance gate 通过记录，任务 6.5 门禁）；
    - 任意→``rejected`` 必须携带非空 ``reason``；
    - ``building→building`` 停留必须携带非空 ``note``（如实展示构建问题）。

    ``gate_passed`` 缺省 False——调用方不提供 gate 事实时一律拒绝进入
    交付验收（默认拒绝，绝不放行）。
    """
    if current in TERMINAL_STATUSES:
        raise TransitionError(
            current, target, f"{current.value} 是终态，不允许再迁移"
        )
    if target not in allowed_targets(current):
        raise TransitionError(
            current,
            target,
            "不在合法迁移表内，允许的目标："
            + ("、".join(t.value for t in sorted(allowed_targets(current))) or "无"),
        )
    if (
        current is DemandStatus.evaluating
        and target is DemandStatus.quoted
        and not confirmed_by_operator
    ):
        raise TransitionError(
            current,
            target,
            "前置条件不满足：必须后台人工确认报价（confirmed_by_operator=true）"
            "才能进入 quoted",
        )
    if (
        current is DemandStatus.building
        and target is DemandStatus.delivery_acceptance
        and not gate_passed
    ):
        raise TransitionError(
            current,
            target,
            "前置条件不满足：没有 conformance gate 通过记录——须先经 "
            "POST /internal/demands/{id}/gate-result 提交 passed=true"
            "（gate 不过即停留 building，可重跑后再次提交）",
        )
    if target is DemandStatus.rejected and not (reason or "").strip():
        raise TransitionError(
            current, target, "拒绝必须携带理由（reason），并留档客户可见"
        )
    if (
        current is DemandStatus.building
        and target is DemandStatus.building
        and not (note or "").strip()
    ):
        raise TransitionError(
            current,
            target,
            "构建停留（gate 不过）必须如实携带构建问题说明（note）",
        )
