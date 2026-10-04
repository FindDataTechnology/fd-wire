"""流水线衔接服务（wire-platform-v1 任务 6.5：wire-demand-pipeline）。

真实流水线执行（scraw-builder 批量生成、conformance gate、测试舰队）住在
fd-industry-data 等外部仓——本模块只做「门禁消费」：

- :func:`record_pipeline_run`——客户确认进 building 后，内部端点把流水线
  事实（pipeline_run_id/repo/branch/note）append-only 落 ``pipeline_events``；
- :func:`record_gate_result`——conformance gate 结果（真实命令为
  ``python3 fd-industry-data/scripts/conformance_gate.py``，从 finddata 根
  跑、只读；本仓绝不代跑）：``passed=false`` 仅记录、状态停留 building
  可重跑；``passed=true`` 写下通过记录；
- :func:`has_gate_pass`——``building→delivery_acceptance`` 的硬前置
  （service.apply_transition → statemachine.ensure_transition 消费：
  无通过记录 409，错误信息指明原因）。

所有事件 append-only（与 status_history 同一审计纪律）。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from .models import Demand
from .statemachine import DemandStatus, TransitionError

EVENT_PIPELINE_RUN = "pipeline_run"
EVENT_GATE_RESULT = "gate_result"


def _require_building(demand: Demand, *, action: str) -> None:
    """流水线事实只在 building 状态记录（客户确认报价之后、交付验收之前）。"""
    current = DemandStatus(demand.status)
    if current is not DemandStatus.building:
        raise TransitionError(
            current,
            DemandStatus.building,
            f"{action}只能在 building 状态记录（当前 {current.value}）——"
            "流水线事实属于构建期（awaiting_confirm→building 之后）",
        )


def record_pipeline_run(
    db: Session,
    demand: Demand,
    *,
    pipeline_run_id: str,
    repo: str | None = None,
    branch: str | None = None,
    note: str | None = None,
    by: str = "pipeline",
) -> Demand:
    """记录一次流水线事实（append-only）：run id / 仓 / 分支 / 备注。"""
    _require_building(demand, action="流水线事实")
    run_id = (pipeline_run_id or "").strip()
    if not run_id:
        raise TransitionError(
            DemandStatus(demand.status),
            DemandStatus.building,
            "pipeline_run_id 不能为空（流水线事实必须可追溯到具体 run）",
        )
    demand.append_pipeline_event(
        {
            "type": EVENT_PIPELINE_RUN,
            "pipeline_run_id": run_id,
            "repo": repo,
            "branch": branch,
            "note": note,
            "by": by,
        }
    )
    db.commit()
    db.refresh(demand)
    return demand


def record_gate_result(
    db: Session,
    demand: Demand,
    *,
    passed: bool,
    report_path: str | None = None,
    note: str | None = None,
    by: str = "pipeline",
) -> Demand:
    """记录一次 conformance gate 结果（append-only）。

    - ``passed=False``：只记录（note 如实入档），状态停留 building——可修复
      后重跑、再次提交 gate 结果；
    - ``passed=True``：写通过记录——此后 ``building→delivery_acceptance``
      迁移放行（``has_gate_pass`` 即 true）。
    """
    _require_building(demand, action="gate 结果")
    demand.append_pipeline_event(
        {
            "type": EVENT_GATE_RESULT,
            "passed": bool(passed),
            "report_path": report_path,
            "note": note,
            "by": by,
        }
    )
    db.commit()
    db.refresh(demand)
    return demand


def has_gate_pass(demand: Demand) -> bool:
    """是否已有至少一条 gate 通过记录（building→delivery_acceptance 前置）。"""
    return any(
        event.get("type") == EVENT_GATE_RESULT and event.get("passed") is True
        for event in (demand.pipeline_events or [])
    )
