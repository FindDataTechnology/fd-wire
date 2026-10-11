"""工单生成与投递编排（wire-demand-generation-orchestration 任务 2）。

把 in_progress 需求单确定性映射成 fd-industry-data 仓 health-loop 的
「生成工单」YAML（design D3 映射表），并以**舰队拉取器**通道投递（design
D1 定案）：wire 暴露内部拉取端点（``FD_WIRE_INTERNAL_TOKEN``），由
fd-industry-data 侧拉取工作流拉工单→写 ``reports/health-tickets/``→
GITHUB_TOKEN 自推 main→回 ack；工单再经对方仓每日巡检工作流代交给萬星
生成 agent。wire 只产出与供拉取文件，绝不 merge、绝不写 schedule、
**零外部 git 凭据**（deploy key 被 org 禁、PAT 需交互铸造的调研定案，
design D6 红线）。

红线纪律：
- 脱敏（design D6）：工单全文不得含 ``contact_email``；公司名不进工单
  （brief.notes 只留 ``customer_id`` 前 8 位脱敏代号——工单进公开仓）。
- 冲突即拒：slug 在对方仓已占用（raw 探测 ``spiders/<slug>/manifest.yaml``
  返回 200）时出单拒绝转人工；网络异常按占用处理（宁可拒不可撞）。
- 诚实降级：拉取器未部署（无 ack）时出单响应照常携带工单全文供人工
  推送并明示等待状态——绝不展示任何自动化投递成功假象。
- ack 幂等：同一工单重复 ack 不重复记 ``pipeline_run`` 事件。
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
import yaml
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Demand
from .statemachine import DemandStatus

# ---------------------------------------------------------------- 常量（契约冻结）

#: 目标仓（公开镜像仓；工单由其拉取工作流落仓自推、巡检工作流代交）。
INDUSTRY_REPO_NAME = "fd-industry-data"
#: slug 占用探测：公开 raw 通道读 spiders/<slug>/manifest.yaml（200=占用）。
SLUG_PROBE_URL = (
    "https://raw.githubusercontent.com/FindDataTechnology/"
    "fd-industry-data/main/spiders/{slug}/manifest.yaml"
)
#: 工单落仓目录（对方仓拉取工作流的写入目标——wire 侧只产出路径名）。
TICKETS_DIR = "reports/health-tickets"
#: 工单文件名：``<YYYYMMDD>-wire-<demand.code>.yaml``（date=UTC 今日）。
TICKET_FILENAME_RE = re.compile(r"^[0-9]{8}-wire-[A-Za-z0-9][A-Za-z0-9.-]*\.yaml$")
#: 完整工单相对路径（拉取器按此落盘；ack 按此对账）。
TICKET_PATH_RE = re.compile(
    r"^reports/health-tickets/[0-9]{8}-wire-[A-Za-z0-9][A-Za-z0-9.-]*\.yaml$"
)
#: slug 契约：``^[a-z0-9][a-z0-9-]*$``、截 40 字符。
SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")
SLUG_MAX_LEN = 40

#: brief.cadence 合法值（design D3：daily/hourly/weekly，非法值并入 notes）。
VALID_CADENCES = frozenset({"daily", "hourly", "weekly"})
DEFAULT_CADENCE = "daily"

#: slug 探测超时（秒）。
SLUG_PROBE_TIMEOUT = 10.0

#: pipeline_events 事件类型（与 pipeline.py 的常量口径一致）。
EVENT_WORKORDER_EXPORTED = "workorder_exported"
EVENT_PIPELINE_RUN = "pipeline_run"
#: ack 记录的 pipeline_run 事件备注（投递事实由对方仓拉取器回 ack 确认）。
WORKORDER_DELIVERED_NOTE = "workorder delivered"


class WorkorderIn(BaseModel):
    """出单请求体：slug 可覆写（操作员人工指定 unit 名），缺省从首源地址派生。"""

    slug: str | None = Field(default=None, max_length=128)


class WorkorderAckIn(BaseModel):
    """拉取器 ack 请求体：对方仓工作流落仓自推成功后回告的工单路径。"""

    ticket_path: str = Field(min_length=1, max_length=256)


class WorkorderNotFound(LookupError):
    """ack 的工单路径对不上任何导出留档——路由层转 404。"""


# ---------------------------------------------------------------- slug 与文件名


def derive_slug(source_url: str, override: str | None = None) -> str:
    """从源地址派生 spider slug：override 优先，否则取 hostname。

    净化规则：去 ``www.`` 前缀 → 非法字符（含点）压成 ``-`` → 折叠连续
    ``-``、去首尾 ``-`` → 压 ``^[a-z0-9][a-z0-9-]*$`` → 截 40 字符。
    无法派生（无主机名/净化后为空）抛 :class:`ValueError`。
    """
    candidate = (override or "").strip()
    if not candidate:
        hostname = (urlparse(source_url or "").hostname or "").lower()
        if not hostname:
            raise ValueError(
                f"无法从源地址派生 slug：{source_url!r} 没有可解析的主机名"
            )
        candidate = hostname
    if candidate.startswith("www."):
        candidate = candidate[4:]
    slug = re.sub(r"[^a-z0-9-]+", "-", candidate.lower())
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    if len(slug) > SLUG_MAX_LEN:
        slug = slug[:SLUG_MAX_LEN].rstrip("-")
    if not slug:
        raise ValueError(
            f"无法从源地址派生 slug：{source_url!r} 净化后为空"
        )
    return slug


def ticket_filename(demand: Demand) -> str:
    """工单文件名：``<YYYYMMDD>-wire-<demand.code>.yaml``（date=UTC 今日）。"""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"{today}-wire-{demand.code}.yaml"


def customer_code(demand: Demand) -> str:
    """客户脱敏代号：``customer_id`` 前 8 位（公司名不进公开仓，design D6）。"""
    return (demand.customer_id or "")[:8]


def demand_source_urls(demand: Demand) -> list[str]:
    """需求单源地址（合规门已校验的公开 URL）；存量单无值=空列表。"""
    return [str(u) for u in (demand.source_urls or []) if str(u).strip()]


# ---------------------------------------------------------------- 工单构造（纯函数）


def build_workorder(demand: Demand, *, slug: str | None = None) -> tuple[str, str]:
    """把需求单映射成 health-loop 生成工单 YAML（design D3 冻结契约）。

    返回 ``(yaml 文本, tickets 相对路径)``。纯函数：同一需求单同日两次
    调用字节级一致（yaml ``sort_keys=False`` 保字段序、entities_hint
    序列化固定排序）。脱敏红线在映射内保证：``contact_email`` 与公司名
    绝不入单（notes 只留需求单编码 + 客户代号）。
    """
    source_urls = demand_source_urls(demand)
    if not source_urls:
        raise ValueError(
            f"需求单 {demand.code} 缺少 source_urls——生成工单必须来自带"
            "合法源地址的新单（存量单请人工补源地址或线下处理）"
        )
    unit_slug = slug or derive_slug(source_urls[0])
    filename = ticket_filename(demand)
    ticket_path = f"{TICKETS_DIR}/{filename}"

    # cadence：frequency_expect 映射 daily/hourly/weekly；缺省 daily；
    # 非法值不丢——原文并入 notes（design D3）。
    frequency_raw = (demand.frequency_expect or "").strip()
    cadence = (
        frequency_raw.lower()
        if frequency_raw.lower() in VALID_CADENCES
        else DEFAULT_CADENCE
    )

    # expectations：intent 原文；entities_hint 有则附实体提示（固定序列化）。
    expectations = demand.intent or ""
    if demand.entities_hint:
        expectations += (
            "\n\n实体提示："
            + json.dumps(
                demand.entities_hint, ensure_ascii=False, sort_keys=True
            )
        )

    # notes：审计线索三段——需求单编码 / 客户脱敏代号 / 未映射频率原文。
    notes_segments = [
        f"wire 需求单 {demand.code}",
        f"客户代号 {customer_code(demand)}",
    ]
    if frequency_raw and frequency_raw.lower() not in VALID_CADENCES:
        notes_segments.append(f"frequency 未映射：{frequency_raw}")

    ticket = {
        "kind": "generate",
        "unit": f"spiders/{unit_slug}/",
        "category": None,
        "brief": {
            "source_urls": source_urls,
            "expectations": expectations,
            "cadence": cadence,
            "notes": "；".join(notes_segments),
        },
        "golden": [f"spiders/{unit_slug}/golden/"],
        "verify": {
            "commands": [
                f"python3 scripts/health_verify.py --ticket {ticket_path}"
            ]
        },
    }
    yaml_text = yaml.safe_dump(
        ticket,
        sort_keys=False,
        allow_unicode=True,
        width=4096,
        default_flow_style=False,
    )
    return yaml_text, ticket_path


# ---------------------------------------------------------------- slug 冲突探测


def check_slug_free(slug: str, *, http_client: httpx.Client | None = None) -> bool:
    """探测 slug 在 fd-industry-data 仓是否空闲（公开 raw 通道）。

    ``spiders/<slug>/manifest.yaml`` 404=空闲；200（及其它任何状态、网络
    异常）一律按占用处理——宁可拒不可撞（fail-closed）。
    """
    if not SLUG_PATTERN.fullmatch(slug or ""):
        return False  # 非法 slug 不进 URL（防注入），按占用拒
    url = SLUG_PROBE_URL.format(slug=slug)
    owns_client = http_client is None
    client = http_client or httpx.Client(timeout=SLUG_PROBE_TIMEOUT)
    try:
        try:
            resp = client.get(url)
        except httpx.HTTPError:
            return False
        return resp.status_code == 404
    finally:
        if owns_client:
            client.close()


# ---------------------------------------------------------------- 拉取队列（pending / ack）


def _latest_export_index(
    events: list[dict], ticket_path: str | None = None
) -> int | None:
    """事件流里最新一条 ``workorder_exported`` 的下标（可按路径过滤）。"""
    index: int | None = None
    for idx, event in enumerate(events):
        if event.get("type") != EVENT_WORKORDER_EXPORTED:
            continue
        if ticket_path is not None and event.get("ticket_path") != ticket_path:
            continue
        index = idx
    return index


def _acked_after(events: list[dict], export_idx: int) -> bool:
    """导出之后是否已有对应 ack（pipeline_run 且 id==工单文件名）。"""
    filename = (events[export_idx].get("ticket_path") or "").rsplit("/", 1)[-1]
    return any(
        event.get("type") == EVENT_PIPELINE_RUN
        and event.get("pipeline_run_id") == filename
        for event in events[export_idx + 1 :]
    )


def latest_unacked_export(events: list[dict]) -> dict | None:
    """事件流里最新一条未被 ack 的 ``workorder_exported``（None=无待投）。

    ack 判定按事件序（append-only 下标）：该导出**之后**存在
    ``pipeline_run`` 且 ``pipeline_run_id`` == 工单文件名。同日重出新单
    （同路径新导出）因此不会误吃旧 ack；更新导出天然取代旧导出。
    """
    export_idx = _latest_export_index(events)
    if export_idx is None or _acked_after(events, export_idx):
        return None
    return events[export_idx]


def pending_workorders(db: Session) -> list[dict]:
    """待投递工单清单：仅 in_progress 单、每单至多一条最新未 ack 导出。

    拉取器（fd-industry-data 侧工作流）按此清单落仓自推；导出留档即
    入队——无需额外队列表。
    """
    stmt = (
        select(Demand)
        .where(Demand.status == DemandStatus.in_progress.value)
        .order_by(Demand.id)
    )
    pending: list[dict] = []
    for demand in db.scalars(stmt):
        export = latest_unacked_export(list(demand.pipeline_events or []))
        if export is None:
            continue
        pending.append(
            {
                "demand_id": demand.id,
                "code": demand.code,
                "ticket_path": export.get("ticket_path"),
                "sha256": export.get("sha256"),
                "ticket_yaml": export.get("ticket_yaml"),
                "exported_at": export.get("at"),
            }
        )
    return pending


def ack_workorder(db: Session, ticket_path: str) -> dict:
    """拉取器回 ack：工单已由对方仓落仓自推——wire 记 ``pipeline_run``。

    - 查无该路径的导出留档 → :class:`WorkorderNotFound`（未知工单）；
    - 幂等（spec 场景「ack 幂等」）：该路径**最新导出**已 ack 时重复
      ack 不重复追加事件，返回既有已 ack 状态；同日重出新单（ack 之后
      的新导出）再 ack 会如实记第二次投递事实；
    - 投递是既成事实的观测留档：即使需求单已迁出 in_progress 也照记。
    """
    normalized = (ticket_path or "").strip()
    if not TICKET_PATH_RE.fullmatch(normalized):
        raise WorkorderNotFound(
            f"工单路径 {ticket_path!r} 形态不合契约"
            f"（{TICKETS_DIR}/<YYYYMMDD>-wire-<code>.yaml）"
        )
    demand = _demand_for_ticket(db, normalized)
    if demand is None:
        raise WorkorderNotFound(
            f"工单 {ticket_path!r} 没有任何导出留档（未知工单）"
        )
    events = list(demand.pipeline_events or [])
    export_idx = _latest_export_index(events, ticket_path=normalized)
    assert export_idx is not None  # _demand_for_ticket 命中即有该路径导出
    filename = normalized.rsplit("/", 1)[-1]
    if _acked_after(events, export_idx):  # 幂等：最新导出已 ack
        return {
            "demand_id": demand.id,
            "ticket_path": normalized,
            "pipeline_run_id": filename,
            "acked": True,
            "already_acked": True,
        }
    demand.append_pipeline_event(
        {
            "type": EVENT_PIPELINE_RUN,
            "pipeline_run_id": filename,
            "repo": INDUSTRY_REPO_NAME,
            "branch": "main",
            "note": WORKORDER_DELIVERED_NOTE,
            "pr_url": None,
        }
    )
    db.commit()
    db.refresh(demand)
    return {
        "demand_id": demand.id,
        "ticket_path": normalized,
        "pipeline_run_id": filename,
        "acked": True,
        "already_acked": False,
    }


def _demand_for_ticket(db: Session, ticket_path: str) -> Demand | None:
    """找到导出过该工单路径的需求单（路径含业务编码，天然一对一）。"""
    for demand in db.scalars(select(Demand).order_by(Demand.id)):
        for event in demand.pipeline_events or []:
            if (
                event.get("type") == EVENT_WORKORDER_EXPORTED
                and event.get("ticket_path") == ticket_path
            ):
                return demand
    return None
