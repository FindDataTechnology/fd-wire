"""产物生命周期业务逻辑：版本化保存、状态机迁移、会话草稿导入。"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai.models import AIDraftArtifact
from ..ai.service import ConversationNotFound, get_customer_conversation
from ..datasets.models import Dataset
from .form_spec import validate_form_spec
from .models import Artifact, ArtifactStatus, ArtifactVersion


class ArtifactNotFound(LookupError):
    """产物不存在（或不属于该客户）——路由层转 404（不泄露他企存在性）。"""


class InvalidArtifactSpec(ValueError):
    """spec 未过最小校验（沿用 ai.tools.validate_artifact_args 同口径）——路由层转 422。"""


class ArtifactLocked(Exception):
    """archived 产物拒改——路由层转 409（提示先恢复）。"""


class InvalidStatusTransition(Exception):
    """非法状态迁移——路由层转 409（说明合法路径）。"""


def utc_now_iso() -> str:
    """状态留痕时间戳：UTC ISO-8601（与 demands.status_history 同口径）。"""
    return datetime.now(timezone.utc).isoformat()


def validate_spec(spec: object) -> str | None:
    """spec 最小校验（沿用 ai.tools.validate_artifact_args 的既有口径）：
    非空 title 字符串 + 非空 spec 对象；返回错误文案（None=合法）。"""
    if not isinstance(spec, dict):
        return "spec 必须是 JSON 对象"
    title = spec.get("title")
    if not isinstance(title, str) or not title.strip():
        return "spec 缺少非空 title"
    inner = spec.get("spec")
    if not isinstance(inner, dict) or not inner:
        return "spec.spec 必须是非空 JSON 对象"
    return None


#: form 产物 kind 短名（spec 校验按 kind 分派追加 form 结构层的依据）
FORM_KIND = "form"

#: alert_rule 产物 kind 短名（保存时追加规则契约层的依据）
ALERT_KIND = "alert_rule"


class InvalidAlertArtifactSpec(InvalidArtifactSpec):
    """alert_rule 规则契约未过校验（alerts.spec_validate）——路由层转 400
    （告警规则是机读调试面，契约文案如实定位字段；与 form 的 422 面分置）。"""


def validate_kind_spec(kind: str, spec: object) -> str | None:
    """按 kind 分派 spec 校验（wire-form-builder design D1）：

    通用层先行（validate_spec：title 非空 + spec.spec 非空——既有口径
    零漂移）；kind=form 再追加 form 结构层（form_spec.validate_form_spec，
    design D1 第①层）。dashboard 及其余 kind 语义不变（仅通用层）。
    """
    error = validate_spec(spec)
    if error is not None:
        return error
    if kind == FORM_KIND and isinstance(spec, dict):
        return validate_form_spec(spec.get("spec"))
    return None


def _validate_alert_spec(spec: object) -> None:
    """alert_rule 保存路径的规则契约层（wire-alert-evaluation）。

    对信封内层 ``spec.spec`` 跑 ``alerts.spec_validate.validate_alert_spec``
    （query 过 parse_panel_query / 聚合与条件枚举 / 区间 / webhook 前缀）；
    不过抛 :class:`InvalidAlertArtifactSpec`（路由层 400 detail=文案）。
    只在**新版本保存**时裁决——存量不合形 spec 不回溯（评估器对存量记
    error 事件受冷却约束，绝不崩溃）。
    """
    if not isinstance(spec, dict):  # pragma: no cover - 前置校验已保证
        return
    from ..alerts.spec_validate import validate_alert_spec

    error = validate_alert_spec(spec.get("spec"))
    if error is not None:
        raise InvalidAlertArtifactSpec(error)


def _require_form_dataset(
    spec: object, *, datasets_db: Session | None, customer_id: str
) -> None:
    """form spec 的 datasetId 属主校验（design D1 第②层，零引擎调用）。

    datasetId 为 null（构建中间态——可保存不可提交）直接放行；非空时必须
    在 datasets 库会话中命中**本企业**现存数据集，不存在或他企一律
    InvalidArtifactSpec（路由层 422，不泄露他企存在性）。

    ``datasets_db`` 必须是 datasets 库会话（生产 wire_platform/wire_datasets
    分库——查 datasets 表不能走 ai 库会话，照 query_contract 先例由路由
    注入）；缺席时 fail-closed 拒存（不允许跳过属主校验的写路径）。
    列名是否仍在数据集中不在此裁决（design D1 第③层：提交时如实 422）。
    """
    if not isinstance(spec, dict):  # pragma: no cover - 前置校验已保证
        return
    inner = spec.get("spec")
    dataset_id = inner.get("datasetId") if isinstance(inner, dict) else None
    if dataset_id is None:
        return
    dataset = (
        datasets_db.get(Dataset, dataset_id) if datasets_db is not None else None
    )
    if dataset is None or dataset.customer_id != customer_id:
        raise InvalidArtifactSpec(f"数据集 {dataset_id} 不存在")


def operator_label(customer_id: str) -> str:
    """版本/留痕的操作者标注（控制台会话写入口径）。"""
    return f"console:{customer_id}"


def get_customer_artifact(db: Session, *, artifact_id: int, customer_id: str) -> Artifact:
    """客户侧产物：不存在或非本企业一律 404。"""
    artifact = db.get(Artifact, artifact_id)
    if artifact is None or artifact.customer_id != customer_id:
        raise ArtifactNotFound(f"artifact {artifact_id} 不存在")
    return artifact


def list_artifacts(
    db: Session,
    *,
    customer_id: str,
    kind: str | None = None,
    status: str | None = None,
) -> list[Artifact]:
    """本企业产物列表（按更新时间倒序；kind/status 可选过滤）。"""
    stmt = select(Artifact).where(Artifact.customer_id == customer_id)
    if kind is not None:
        stmt = stmt.where(Artifact.kind == kind)
    if status is not None:
        stmt = stmt.where(Artifact.status == status)
    stmt = stmt.order_by(Artifact.updated_at.desc(), Artifact.id.desc())
    return list(db.scalars(stmt).all())


def current_spec(db: Session, artifact: Artifact) -> dict:
    """当前 spec：版本表中 version=产物计数的最新行。"""
    row = db.scalar(
        select(ArtifactVersion).where(
            ArtifactVersion.artifact_id == artifact.id,
            ArtifactVersion.version == artifact.version,
        )
    )
    return dict(row.spec) if row is not None else {}


def list_versions(db: Session, artifact: Artifact) -> list[ArtifactVersion]:
    """版本历史（新版本在前）。"""
    stmt = (
        select(ArtifactVersion)
        .where(ArtifactVersion.artifact_id == artifact.id)
        .order_by(ArtifactVersion.version.desc())
    )
    return list(db.scalars(stmt).all())


def get_version(db: Session, artifact: Artifact, version: int) -> ArtifactVersion:
    """取指定版本（append-only：任何版本只读）。"""
    row = db.scalar(
        select(ArtifactVersion).where(
            ArtifactVersion.artifact_id == artifact.id,
            ArtifactVersion.version == version,
        )
    )
    if row is None:
        raise ArtifactNotFound(f"artifact {artifact.id} 无版本 {version}")
    return row


def update_spec(
    db: Session,
    artifact: Artifact,
    *,
    spec: object,
    customer_id: str,
    datasets_db: Session | None = None,
) -> Artifact:
    """spec 更新：校验（kind 分派）→ 追加新版本行（append-only）并递增计数。

    archived 拒改（先恢复）；title 随 spec.title 投影同步。

    form 产物在通用校验之上追加两层（wire-form-builder design D1，全部在
    版本行落库前——任何拒绝**零半写**）：结构层（validate_form_spec）+
    datasetId 属主层（``datasets_db``=datasets 库会话，datasetId 非空时验
    存在且属本企业，见 _require_form_dataset）。alert_rule 产物追加规则
    契约层（_validate_alert_spec，InvalidAlertArtifactSpec→路由层 400）。
    dashboard 及其余 kind 仅走通用层（语义零漂移，``datasets_db`` 不参与）。
    """
    if artifact.status == ArtifactStatus.archived.value:
        raise ArtifactLocked(
            f"产物 {artifact.id} 已归档（archived），不可编辑——请先恢复（restore）为草稿再修改。"
        )
    error = validate_kind_spec(artifact.kind, spec)
    if error is not None:
        raise InvalidArtifactSpec(error)
    if artifact.kind == FORM_KIND:
        _require_form_dataset(
            spec, datasets_db=datasets_db, customer_id=artifact.customer_id
        )
    if artifact.kind == ALERT_KIND:
        _validate_alert_spec(spec)
    spec = dict(spec)  # type: ignore[arg-type]
    artifact.version += 1
    db.add(
        ArtifactVersion(
            artifact_id=artifact.id,
            version=artifact.version,
            spec=spec,
            operator=operator_label(customer_id),
        )
    )
    artifact.title = str(spec["title"]).strip()[:200]
    artifact.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    db.refresh(artifact)
    return artifact


# ------------------------------------------------------------------ 状态机

#: 合法迁移表：当前态 → 允许动作（draft→published→archived 单向；
#: archived→draft 恢复是唯一回退边）。
_TRANSITIONS: dict[str, dict[str, ArtifactStatus]] = {
    "draft": {"publish": ArtifactStatus.published, "archive": ArtifactStatus.archived},
    "published": {"archive": ArtifactStatus.archived},
    "archived": {"restore": ArtifactStatus.draft},
}

#: 动作说明（非法迁移 409 时说明合法路径用）。
_ACTION_HINTS: dict[str, str] = {
    "publish": "合法路径：draft --publish--> published（已发布或已归档的产物请先恢复为草稿）",
    "archive": "合法路径：draft/published --archive--> archived",
    "restore": "合法路径：archived --restore--> draft（仅归档产物可恢复）",
}


def _transition(
    db: Session, artifact: Artifact, *, action: str, customer_id: str
) -> Artifact:
    target = _TRANSITIONS.get(artifact.status, {}).get(action)
    if target is None:
        raise InvalidStatusTransition(
            f"产物 {artifact.id} 当前状态 {artifact.status} 不允许 {action}——"
            + _ACTION_HINTS[action]
        )
    by = operator_label(customer_id)
    note = {
        "publish": "发布（draft → published）",
        "archive": "归档（→ archived，数据保留不删除）",
        "restore": "恢复为草稿（archived → draft）",
    }[action]
    artifact.status = target.value
    artifact.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    history = list(artifact.status_history or [])
    history.append(
        {"status": target.value, "at": utc_now_iso(), "by": by, "note": note}
    )
    artifact.status_history = history
    db.commit()
    db.refresh(artifact)
    return artifact


def publish_artifact(db: Session, artifact: Artifact, *, customer_id: str) -> Artifact:
    """发布：draft → published（published 是稳定引用位）。"""
    return _transition(db, artifact, action="publish", customer_id=customer_id)


def archive_artifact(db: Session, artifact: Artifact, *, customer_id: str) -> Artifact:
    """归档：draft/published → archived（不删除，可恢复）。"""
    return _transition(db, artifact, action="archive", customer_id=customer_id)


def restore_artifact(db: Session, artifact: Artifact, *, customer_id: str) -> Artifact:
    """恢复：archived → draft（唯一回退边）。"""
    return _transition(db, artifact, action="restore", customer_id=customer_id)


# ------------------------------------------------------------- 会话草稿导入


def import_from_draft(
    db: Session, *, customer_id: str, conversation_id: int, draft_id: int
) -> Artifact:
    """把会话草稿固化为 draft 产物（version=1，保留来源会话指针）。

    会话不存在/非本人、草稿不存在或不属于该会话一律 404（不泄露他企）。
    """
    try:
        conversation = get_customer_conversation(
            db, conversation_id=conversation_id, customer_id=customer_id
        )
    except ConversationNotFound as exc:
        raise ArtifactNotFound(str(exc)) from exc
    draft = db.get(AIDraftArtifact, draft_id)
    if draft is None or draft.conversation_id != conversation.id:
        raise ArtifactNotFound(
            f"conversation {conversation_id} 无草稿 {draft_id}"
        )
    error = validate_spec(draft.spec)
    if error is not None:  # pragma: no cover - 存量草稿均过工具侧校验，防御位
        raise InvalidArtifactSpec(f"草稿 {draft_id} 的 spec 不合法：{error}")
    kind = draft.kind
    title = str(draft.spec.get("title", "")).strip()[:200] or f"{kind} 产物"
    artifact = Artifact(
        customer_id=customer_id,
        kind=kind,
        title=title,
        status=ArtifactStatus.draft.value,
        version=1,
        origin_conversation_id=conversation.id,
        status_history=[
            {
                "status": ArtifactStatus.draft.value,
                "at": utc_now_iso(),
                "by": operator_label(customer_id),
                "note": f"从会话 {conversation.id} 草稿导入",
            }
        ],
    )
    db.add(artifact)
    db.flush()
    db.add(
        ArtifactVersion(
            artifact_id=artifact.id,
            version=1,
            spec=dict(draft.spec),
            operator=operator_label(customer_id),
        )
    )
    db.commit()
    db.refresh(artifact)
    return artifact


# --------------------------------------------------------------- 空白创建

#: 空白创建的 kind 白名单：dashboard（最小空板）/ form（最小空表单）/
#: alert_rule（规则模板壳，wire-alert-evaluation——alert 此前唯一出生路径
#: 是 AI 草稿转正，而 AI 构建要求 cell，免费档无门）。其余三类（复合指标/
#: 研报/定时）结构强，仍只能由 AI 构建草稿转正产生。
BLANK_CREATE_KINDS: tuple[str, ...] = ("dashboard", "form", "alert_rule")


def _blank_spec(kind: str, title: str) -> dict:
    """空白创建的最小 spec（kind 分派）：dashboard=空面板；form=零字段、
    datasetId=None（构建中间态——可保存不可提交，进构建器再绑定数据集）；
    alert_rule=规则模板壳（占位 dataset_id；出生版本不过规则契约层，首次
    PUT 真实 spec 才校验——评估器对未修占位的 published 规则记 error 事件）。"""
    if kind == FORM_KIND:
        return {"title": title, "spec": {"title": title, "datasetId": None, "fields": []}}
    if kind == ALERT_KIND:
        return {
            "title": title,
            "spec": {
                "query": {"dataset_id": "<数据集id>", "columns": ["<列名>"]},
                "aggregate": {"func": "count"},
                "condition": {"op": "gt", "value": 0},
                "intervalMinutes": 30,
            },
        }
    return {"title": title, "spec": {"title": title, "panels": []}}


def create_blank_artifact(
    db: Session, *, customer_id: str, kind: str, title: str
) -> Artifact:
    """空白创建（wire-dashboard-blank-create；form 扩展 wire-form-builder）：
    console 直接创建 draft 产物。

    产物此前唯一出生路径是会话草稿转正（import_from_draft），而草稿只能由
    AI 构建产生、AI 构建要求 cell——免费档（无 cell）造不出任何看板/表单。
    本函数补第二条出生路径：按 kind 构造最小空 spec（dashboard=空面板、
    form=零字段未绑数据集），走与 from-draft 完全相同的建档手法（version=1
    版本行 + operator 审计 + 初始状态留痕 + title 投影），仅来源会话指针
    为 None。

    约束：kind 白名单 BLANK_CREATE_KINDS（dashboard/form）；title strip
    后须非空——违者 InvalidArtifactSpec（路由层 422），且零半写（拒收不
    落任何产物/版本行）。
    """
    if kind not in BLANK_CREATE_KINDS:
        raise InvalidArtifactSpec(
            "空白创建仅支持 dashboard、form、alert_rule（其他 kind 由 AI 构建产生）"
        )
    if not title.strip():
        raise InvalidArtifactSpec("title 必须是非空字符串")
    title = title.strip()
    spec = _blank_spec(kind, title)
    # kind 分派校验（内造最小 spec 恒过——防御位，保证出生版本永远合法）
    error = validate_kind_spec(kind, spec)
    if error is not None:  # pragma: no cover - 内造 spec 恒过校验
        raise InvalidArtifactSpec(error)
    artifact = Artifact(
        customer_id=customer_id,
        kind=kind,
        # title 投影同 update_spec 口径（strip + 截 200）
        title=title[:200],
        status=ArtifactStatus.draft.value,
        version=1,
        # 直接创建无来源会话（区别于 from-draft 保留会话指针）
        origin_conversation_id=None,
        status_history=[
            {
                "status": ArtifactStatus.draft.value,
                "at": utc_now_iso(),
                "by": operator_label(customer_id),
                "note": "空白创建（console 直接新建）",
            }
        ],
    )
    db.add(artifact)
    db.flush()
    db.add(
        ArtifactVersion(
            artifact_id=artifact.id,
            version=1,
            spec=spec,
            operator=operator_label(customer_id),
        )
    )
    db.commit()
    db.refresh(artifact)
    return artifact
