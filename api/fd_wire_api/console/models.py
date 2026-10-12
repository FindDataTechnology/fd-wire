"""控制台域 ORM 模型（首登开户簿记）。

``console_onboardings``：Logto sub → 开户 ceremony 的断点簿记（幂等可重试、
不留半开户态的状态机载体）。状态机（wire-self-serve-launch 4.3）：

    pending --铸 key 成功--> minted --映射落库--> done

- ``pending``：ceremony 已受理，key 尚未铸出（ensure_customer / registry
  授权束任一步失败停在此态；重试从断点续作，幂等步骤不重复产生副作用）。
- ``minted``：wgk- key 已铸成（key_id 落簿，明文不落库）但登录映射尚未
  写入；重试**不再重复铸 key**，直接续作映射落步。
- ``done``：``billing_customers.logto_sub`` 映射已生效（终态；之后以客户
  映射为第一查询口径，本行留作审计）。

明文 key 纪律与 cell-manager 一致：簿记/审计只落 key_id，明文仅在铸出
当次响应中一次性交付。

团队空间三表（wire-team-spaces，alembic 0027）：``customer_members`` /
``customer_invites`` / ``team_events``。身份模型：owner =
``billing_customers.logto_sub`` 本人（不落成员表），成员表只存被邀成员
（role ∈ editor|viewer）；一个 logto_sub 至多属于一个客户（全局唯一，
一人一队），且应用层校验不得与任何 ``Customer.logto_sub`` 冲突（DB 跨表
约束管不到，兑换入口 resolve_member_role 已覆盖该面）。``team_events``
append-only：只 INSERT，审计不可改写。

个人偏好（wire-personal-preferences，alembic 0029）：``member_preferences``
每 sub 一行——语言/落地页/置顶看板三类个人 UI 指针（详见类 docstring）。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from ..billing.models import utcnow


class ConsoleBase(DeclarativeBase):
    """控制台域声明基类（console_* 表；与平台库同库）。"""


class ConsoleOnboarding(ConsoleBase):
    """首登开户 ceremony 的断点簿记（每 Logto sub 一行）。

    ``customer_id`` 指向 ``billing_customers.id``：ORM 层刻意不声明
    ForeignKey（跨 Base 的 metadata 解析不到对方表，create_all 兜底会炸）；
    DB 级 FK 由 alembic 0015 落（生产），索引在此保留以支撑联查。
    """

    __tablename__ = "console_onboardings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    logto_sub: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    customer_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    key_id: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


class CustomerMember(ConsoleBase):
    """团队成员（被邀成员；owner = Customer.logto_sub 本人，不落本表）。

    ``customer_id`` 指向 ``billing_customers.id``：与 ConsoleOnboarding 同款
    纪律——ORM 层不声明跨 Base ForeignKey（metadata 解析不到对方表），
    DB 级 FK 由 alembic 0027 落（生产）。``logto_sub`` 全局唯一（一人至多
    一队）；role 只 editor|viewer（应用层校验，owner 语义在解析层合成）。
    """

    __tablename__ = "customer_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    customer_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    logto_sub: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    invited_by_sub: Mapped[str | None] = mapped_column(String(64), nullable=True)


class CustomerInvite(ConsoleBase):
    """一次性邀请码（``wsi-`` + 24 hex；24h 过期；兑换即置 used）。

    ``role`` 是被邀者入队角色（editor|viewer）；``created_by_sub`` 是生成者
    （owner）。明文码只在生成响应出现一次（兑换后不复用）。
    """

    __tablename__ = "customer_invites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    customer_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_by_sub: Mapped[str | None] = mapped_column(String(64), nullable=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_sub: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class TeamEvent(ConsoleBase):
    """团队审计事件（append-only：只 INSERT，不可改写）。

    action ∈ member.joined | member.removed | invite.created | invite.revoked；
    target 是对象键（成员 sub / 邀请码）；detail 是 JSON 附注（角色等）。
    """

    __tablename__ = "team_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    customer_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    actor_sub: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    target: Mapped[str] = mapped_column(String(128), nullable=False)
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class MemberPreference(ConsoleBase):
    """个人偏好（wire-personal-preferences：每 Logto sub 一行）。

    偏好是 **per-sub 个人 UI 指针**，不是客户业务数据：语言/落地页/置顶
    看板跨端同步用，owner 与团队成员通用，不经溯源账本、不进 team_events。
    键面冻结三类：

    - ``ui_locale``：zh|en|null（应用层校验，DB 不设 CHECK——值域演进免迁移）；
    - ``landing_tab``：控制台九页签 chat|artifacts|datasets|entities|packs|
      demands|usage|keys|team|null（同上应用层校验）；
    - ``pinned_dashboard_id``：置顶看板产物 id。**裸整型、不建外键**——
      产物表 ``artifacts`` 挂 AiBase（ai 库），与 ConsoleBase 分库，跨 Base
      ForeignKey 声明解析不到对方 metadata（同 CustomerMember 对
      billing_customers 的纪律，但这里连生产 FK 都不落：产物可归档/删除，
      死链由 GET 读时自愈清列兜底，DB 约束反而会把归档变成写失败）。
      有效性（存在/kind=dashboard/同客户/未归档）由应用层在写入与读取
      两侧校验（console/preferences.py）。

    ``updated_at`` 每次写刷新（服务层显式赋值，不依赖 onupdate 的净变更
    检测——同值重写也要推进）。
    """

    __tablename__ = "member_preferences"

    sub: Mapped[str] = mapped_column(String(64), primary_key=True)
    ui_locale: Mapped[str | None] = mapped_column(String(16), nullable=True)
    landing_tab: Mapped[str | None] = mapped_column(String(16), nullable=True)
    pinned_dashboard_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
