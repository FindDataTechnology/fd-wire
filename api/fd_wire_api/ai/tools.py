"""五类产物工具的 schema 与「产物 spec 写入」假语义执行。

v1 工具语义：LLM 只拿到五类产物的 **spec 写入** 工具——执行=把 spec
暂存进 ``ai_draft_artifacts``（status=draft）。真正的 cell 物化
（落库/建刷新/渲染）是任务 5.3/5.5 的活；这里绝不产生半成品——
入参不合法即拒绝暂存并把错误如实回灌给 LLM。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .models import ARTIFACT_STATUS_DRAFT, AIDraftArtifact

#: 产物工具名 → 暂存 kind 短名（五类产物：仪表盘/组合指标/研究报告/告警/定时刷新）
ARTIFACT_TOOL_KINDS: dict[str, str] = {
    "dashboard_spec_create": "dashboard",
    "composite_indicator_create": "composite_indicator",
    "research_report_create": "research_report",
    "alert_rule_create": "alert_rule",
    "refresh_schedule_create": "refresh_schedule",
}


def _artifact_tool_schema(name: str, kind_cn: str, spec_desc: str) -> dict:
    """五类产物工具共用一个「写入产物规格」参数面（假语义，spec 自由 JSON）。"""
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": (
                f"写入一份{kind_cn}产物规格：spec 暂存为草稿（draft），"
                "经客户确认后由平台物化到本企业 cell。spec 不完整时不要调用。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": f"{kind_cn}产物名称（客户可见）",
                    },
                    "spec": {
                        "type": "object",
                        "description": spec_desc,
                    },
                },
                "required": ["title", "spec"],
            },
        },
    }


#: 提供给 LLM 的五类产物工具 schema（OpenAI tools 形态）
TOOL_SCHEMAS: list[dict] = [
    _artifact_tool_schema(
        "dashboard_spec_create",
        "仪表盘",
        # v1 结构示例对齐 web 渲染器契约（web/src/console/dashboard/spec.ts）：
        # 面板 type 四值 / span 三档 / snapshot 内嵌取数结果——AI 产物默认
        # 可渲染可分享（wire-dashboard-share）；面板可选 query 引用——刷新
        # 走确定性契约路径零 AI（wire-dashboard-query-contract）。
        (
            "仪表盘规格 v1（JSON）："
            '{"title":"仪表盘名","panels":[{"id":"p1",'
            '"type":"kpi|line|bar|table","title":"面板标题","span":1,'
            '"source":"指标code或数据集名",'
            '"query":{"dataset_id":"数据集id",'
            '"filters":[{"column":"列名","op":"eq|in|gt|gte|lt|lte|contains|startswith","value":null}],'
            '"sort":[{"column":"列名","dir":"asc|desc"}],"limit":100,"columns":["列名"]},'
            '"snapshot":{"columns":["年份","GDP"],"rows":[["2023",129.4]]},'
            '"config":{"unit":"万亿元","subtitle":"不变价"}}]}。'
            "字段说明：type 必取 kpi/line/bar/table；span 为 3 列栅格宽度"
            "（1/2/3）；把取到的数据写进 snapshot（columns 列名 + rows 行值，"
            "kpi 数值取 rows[0][0]，line/bar 首列为 x 轴其余为系列，table "
            "整表呈现）——渲染器只读 snapshot，不要放占位符或待查标记；"
            "config 可选（unit/subtitle/yName/xName）。面板 source 应填"
            "指标 code 或数据集名（后续「刷新数据」依赖此标注重新取数）。"
            "面板数据取自数据集查询工具（dataset_query 等）时，该面板必须"
            "同时带 query 引用：把所用 dataset_id 与 filters/sort/limit/"
            "columns 查询形参如实写进 panel.query（「刷新数据」按契约确定性"
            "重取，零 AI）；kpi 单值面板用 rows 模式约定：sort 到最近一期 + "
            "limit 1 + columns 投影到值列；source 仍填展示标注。"
        ),
    ),
    _artifact_tool_schema(
        "composite_indicator_create",
        "组合指标",
        "组合指标规格：公式、来源指标 code、单位与口径（JSON）",
    ),
    _artifact_tool_schema(
        "research_report_create",
        "研究报告",
        "研究报告规格：大纲、章节要点、数据范围（JSON）",
    ),
    _artifact_tool_schema(
        "alert_rule_create",
        "告警规则",
        "告警规则规格：触发条件、阈值、通知渠道（JSON）",
    ),
    _artifact_tool_schema(
        "refresh_schedule_create",
        "定时刷新",
        "定时刷新规格：刷新频率、客户时区、目标产物（JSON）",
    ),
]


def validate_artifact_args(tool_name: str, args: dict[str, Any]) -> str | None:
    """校验产物工具入参；返回错误文案（None=合法）。

    不合法绝不落暂存表——「不留半成品」的第一道闸。
    """
    if tool_name not in ARTIFACT_TOOL_KINDS:
        return f"未知产物工具: {tool_name!r}"
    if not isinstance(args, dict):
        return f"工具 {tool_name} 入参必须是 JSON 对象"
    title = args.get("title")
    if not isinstance(title, str) or not title.strip():
        return f"工具 {tool_name} 缺少非空 title"
    spec = args.get("spec")
    if not isinstance(spec, dict) or not spec:
        return f"工具 {tool_name} 缺少非空 spec 对象"
    return None


def stage_artifact(
    db: Session,
    *,
    conversation_id: int,
    customer_id: str,
    tool_name: str,
    args: dict[str, Any],
) -> dict:
    """产物工具的「执行」：spec 暂存进 ``ai_draft_artifacts``。

    返回回灌给 LLM 的结果 dict（``ok`` + artifact 概要或错误说明）。
    """
    error = validate_artifact_args(tool_name, args)
    if error is not None:
        return {"ok": False, "error": error}
    artifact = AIDraftArtifact(
        conversation_id=conversation_id,
        customer_id=customer_id,
        kind=ARTIFACT_TOOL_KINDS[tool_name],
        spec=dict(args),
        status=ARTIFACT_STATUS_DRAFT,
    )
    db.add(artifact)
    db.commit()
    db.refresh(artifact)
    return {
        "ok": True,
        "artifact_id": artifact.id,
        "kind": artifact.kind,
        "title": args.get("title"),
        "status": artifact.status,
        "note": "产物规格已暂存为草稿（draft），待客户确认后物化到企业 cell",
    }
