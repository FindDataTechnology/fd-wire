"""团队空间（wire-team-spaces 任务 3）：邀请兑换 + owner-only 团队管理四端点。

身份模型：owner = ``billing_customers.logto_sub`` 本人（不落成员表），
``customer_members`` 只存被邀成员（editor|viewer）。一人一队（sub 全局
唯一）。

- ``redeem_invite``：POST /api/console/session 携码兑换入口（服务函数，
  routes.py 调用）。同一事务面：建 membership + 码置 used +
  team_events('member.joined')。不建新客户/不动 sub2api/不铸 key（成员
  共享邀请方套餐与配额）。
- ``GET  /api/console/team``：成员名单（含隐含 owner 行）+ 待用邀请列表
  （已用/过期码不回——操作面非审计面，历史在 team_events）。
- ``POST /api/console/team/invites``：生成一次性邀请码（``wsi-``+24hex，
  24h 过期，绑定角色 editor|viewer；明文码只在本次响应出现）。
- ``DELETE /api/console/team/invites/{id}``：作废邀请（404 如实）。
- ``DELETE /api/console/team/members/{sub}``：撤销成员（owner 行 409
  「owner 不可被撤销」；不存在 404；**成员自撤允许**——成员只能删自己，
  删他人 403）。

每次成员/邀请变更 append-only 留痕（team_events，只 INSERT）。
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..admin.db import get_db as get_console_db
from ..billing.models import Customer, utcnow
from . import auth as console_auth
from .models import CustomerInvite, CustomerMember, TeamEvent

router = APIRouter(tags=["console-team"])

#: 邀请码形状（契约冻结）：``wsi-`` + secrets 24 hex（token_hex(12)）
INVITE_CODE_PREFIX = "wsi-"
#: 邀请码有效期（契约冻结：24 小时）
INVITE_TTL = timedelta(hours=24)


class InviteRedeemError(Exception):
    """邀请兑换拒绝（原因进 502 failed body；路由层转译）。"""


def _aware(dt: datetime) -> datetime:
    """sqlite 往返丢 tzinfo 的 naive UTC → aware UTC（PG 读回本就 aware）。"""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _record_event(
    db: Session, *, customer_id: int, actor_sub: str, action: str, target: str, detail: dict | None = None
) -> None:
    """append-only 留痕（只 INSERT，调用方随事务面提交）。"""
    db.add(
        TeamEvent(
            customer_id=customer_id,
            actor_sub=actor_sub,
            action=action,
            target=target,
            detail=detail,
        )
    )


def redeem_invite(db: Session, *, sub: str, code: str) -> Customer:
    """兑换邀请码：sub 加入邀请方客户为成员（role=码的 role）。

    拒绝面（InviteRedeemError → 502 failed 带原因，诚实拒）：
    - sub 已有归属（owner 或任一队成员——一人一队）；
    - 码不存在 / 已被使用 / 已过期；邀请方客户行缺失（腐化态如实报）。
    """
    resolved = console_auth.resolve_member_role(db, sub)
    if resolved is not None:
        raise InviteRedeemError("该身份已有客户归属，邀请码仅限新身份")
    invite = db.execute(
        select(CustomerInvite).where(CustomerInvite.code == code)
    ).scalar_one_or_none()
    if invite is None:
        raise InviteRedeemError("邀请码不存在")
    if invite.used_by_sub is not None or invite.used_at is not None:
        raise InviteRedeemError("邀请码已被使用")
    if _aware(invite.expires_at) <= utcnow():
        raise InviteRedeemError("邀请码已过期")
    customer = db.get(Customer, invite.customer_id)
    if customer is None:
        raise InviteRedeemError("邀请方客户不存在")
    # 应用层互斥校验（customer_members.logto_sub 不得等于任何
    # Customer.logto_sub）：resolve_member_role 的 owner 优先解析已在头顶
    # 拦住 owner sub，此处成员面由其全局唯一约束兜底。
    db.add(
        CustomerMember(
            customer_id=customer.id,
            logto_sub=sub,
            role=invite.role,
            invited_by_sub=invite.created_by_sub,
        )
    )
    invite.used_by_sub = sub
    invite.used_at = utcnow()
    _record_event(
        db,
        customer_id=customer.id,
        actor_sub=sub,
        action="member.joined",
        target=sub,
        detail={"role": invite.role, "invite_code": code},
    )
    db.commit()
    return customer


# ------------------------------------------------------------------ 端点


class TeamMeOut(BaseModel):
    sub: str
    role: str


class TeamMemberOut(BaseModel):
    logto_sub: str
    role: str
    created_at: datetime
    invited_by_sub: str | None = None


class TeamInviteOut(BaseModel):
    id: int
    code: str
    role: str
    expires_at: datetime
    created_at: datetime


class TeamOut(BaseModel):
    me: TeamMeOut
    members: list[TeamMemberOut]
    invites: list[TeamInviteOut]


class InviteCreateIn(BaseModel):
    role: str = Field(pattern="^(editor|viewer)$")


class DeletedOut(BaseModel):
    deleted: bool = True


@router.get("/api/console/team", response_model=TeamOut)
def get_team(
    owner: tuple[Customer, str] = Depends(console_auth.require_console_owner),
    db: Session = Depends(get_console_db),
) -> TeamOut:
    """成员名单（含隐含 owner 行）+ 待用邀请列表（owner-only）。"""
    customer, caller_sub = owner
    member_rows = (
        db.execute(
            select(CustomerMember)
            .where(CustomerMember.customer_id == customer.id)
            .order_by(CustomerMember.created_at, CustomerMember.id)
        )
        .scalars()
        .all()
    )
    members = [
        # 隐含 owner 行：logto_sub=Customer.logto_sub（owner 不落成员表）
        TeamMemberOut(
            logto_sub=customer.logto_sub or "",
            role="owner",
            created_at=customer.created_at,
        )
    ]
    members.extend(
        TeamMemberOut(
            logto_sub=m.logto_sub,
            role=m.role,
            created_at=m.created_at,
            invited_by_sub=m.invited_by_sub,
        )
        for m in member_rows
    )
    invite_rows = (
        db.execute(
            select(CustomerInvite)
            .where(
                CustomerInvite.customer_id == customer.id,
                CustomerInvite.used_by_sub.is_(None),
                CustomerInvite.expires_at > utcnow(),
            )
            .order_by(CustomerInvite.id)
        )
        .scalars()
        .all()
    )
    return TeamOut(
        me=TeamMeOut(sub=caller_sub, role="owner"),
        members=members,
        invites=[
            TeamInviteOut(
                id=i.id,
                code=i.code,
                role=i.role,
                expires_at=_aware(i.expires_at),
                created_at=_aware(i.created_at),
            )
            for i in invite_rows
        ],
    )


@router.post(
    "/api/console/team/invites",
    response_model=TeamInviteOut,
    status_code=status.HTTP_201_CREATED,
)
def create_invite(
    payload: InviteCreateIn,
    owner: tuple[Customer, str] = Depends(console_auth.require_console_owner),
    db: Session = Depends(get_console_db),
) -> TeamInviteOut:
    """生成一次性邀请码（明文码只在本次响应出现；24h 过期）。"""
    customer, caller_sub = owner
    code = INVITE_CODE_PREFIX + secrets.token_hex(12)
    invite = CustomerInvite(
        customer_id=customer.id,
        code=code,
        role=payload.role,
        expires_at=utcnow() + INVITE_TTL,
        created_by_sub=caller_sub,
    )
    db.add(invite)
    _record_event(
        db,
        customer_id=customer.id,
        actor_sub=caller_sub,
        action="invite.created",
        target=code,
        detail={"role": payload.role},
    )
    db.commit()
    return TeamInviteOut(
        id=invite.id,
        code=invite.code,
        role=invite.role,
        expires_at=_aware(invite.expires_at),
        created_at=_aware(invite.created_at),
    )


@router.delete("/api/console/team/invites/{invite_id}", response_model=DeletedOut)
def revoke_invite(
    invite_id: int,
    owner: tuple[Customer, str] = Depends(console_auth.require_console_owner),
    db: Session = Depends(get_console_db),
) -> DeletedOut:
    """作废邀请（不存在 404；客户维度隔离——他企 id 一律 404 不泄露）。"""
    customer, caller_sub = owner
    invite = db.execute(
        select(CustomerInvite).where(
            CustomerInvite.id == invite_id,
            CustomerInvite.customer_id == customer.id,
        )
    ).scalar_one_or_none()
    if invite is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="邀请不存在")
    code = invite.code
    db.delete(invite)
    _record_event(
        db,
        customer_id=customer.id,
        actor_sub=caller_sub,
        action="invite.revoked",
        target=code,
    )
    db.commit()
    return DeletedOut()


@router.delete("/api/console/team/members/{sub}", response_model=DeletedOut)
def remove_member(
    sub: str,
    request: Request,
    db: Session = Depends(get_console_db),
) -> DeletedOut:
    """撤销成员（owner-only；例外：成员自撤允许——只能删自己）。

    - 撤 owner 行 → 409「owner 不可被撤销」（owner 是客户创建者语义，
      不可经成员面移除）；
    - 不存在 → 404；被撤者下次请求即 401（解析不到归属，天然成立）；
    - 成员删他人 → 403（团队管理仅 owner）。
    """
    identity = console_auth.verify_id_token(console_auth.bearer_token(request))
    resolved = console_auth.resolve_member_role(db, identity.sub)
    if resolved is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录身份尚未映射到客户（请先完成首次登录开户）",
            headers={"WWW-Authenticate": "Bearer"},
        )
    customer, role = resolved
    if role != "owner" and sub != identity.sub:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="团队成员权限不足（团队管理仅 owner）",
        )
    if sub == customer.logto_sub:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="owner 不可被撤销",
        )
    member = db.execute(
        select(CustomerMember).where(
            CustomerMember.customer_id == customer.id,
            CustomerMember.logto_sub == sub,
        )
    ).scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="成员不存在")
    db.delete(member)
    _record_event(
        db,
        customer_id=customer.id,
        actor_sub=identity.sub,
        action="member.removed",
        target=sub,
        detail={"self": sub == identity.sub},
    )
    db.commit()
    return DeletedOut()
