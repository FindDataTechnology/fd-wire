"""产物生命周期业务逻辑：版本化保存、状态机迁移、会话草稿导入。"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai.models import AIDraftArtifact
from ..ai.service import ConversationNotFound, get_customer_conversation
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
    db: Session, artifact: Artifact, *, spec: object, customer_id: str
) -> Artifact:
    """spec 更新：最小校验 → 追加新版本行（append-only）并递增计数。

    archived 拒改（先恢复）；title 随 spec.title 投影同步。
    """
    if artifact.status == ArtifactStatus.archived.value:
        raise ArtifactLocked(
            f"产物 {artifact.id} 已归档（archived），不可编辑——请先恢复（restore）为草稿再修改。"
        )
    error = validate_spec(spec)
    if error is not None:
        raise InvalidArtifactSpec(error)
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


# ----------------------------------------------------------------- 空白建板

#: 空白创建的 kind 白名单：v0 仅 dashboard——其余四类（复合指标/研报/告警/
#: 定时）结构强，仍只能由 AI 构建草稿转正产生，不给「空壳」出生路径。
BLANK_CREATE_KINDS: tuple[str, ...] = ("dashboard",)


def create_blank_artifact(
    db: Session, *, customer_id: str, kind: str, title: str
) -> Artifact:
    """空白建板（wire-dashboard-blank-create）：console 直接创建 draft 产物。

    产物此前唯一出生路径是会话草稿转正（import_from_draft），而草稿只能由
    AI 构建产生、AI 构建要求 cell——免费档（无 cell）造不出任何看板。本
    函数补第二条出生路径：构造最小空板 spec，走与 from-draft 完全相同的
    建档手法（version=1 版本行 + operator 审计 + 初始状态留痕 + title
    投影），仅来源会话指针为 None。

    约束：kind 白名单 v0 仅 dashboard（BLANK_CREATE_KINDS）；title strip
    后须非空——违者 InvalidArtifactSpec（路由层 422），且零半写（拒收不
    落任何产物/版本行）。
    """
    if kind not in BLANK_CREATE_KINDS:
        raise InvalidArtifactSpec("空白创建仅支持 dashboard（其他 kind 由 AI 构建产生）")
    if not title.strip():
        raise InvalidArtifactSpec("title 必须是非空字符串")
    title = title.strip()
    spec = {"title": title, "spec": {"title": title, "panels": []}}
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
