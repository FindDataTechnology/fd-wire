"""控制台身份校验：Logto ID token 本地校验（JWKS/iss/aud/exp/iat）+ sub→Customer。

照抄 lex 样板（fd_lex_api/console_api/auth.py）但**关掉组织门禁**（design D2）：
wire 的自助注册要求用户免人工获得授权，Logto 组/org 自动化（M2M /api/v2）
不可用；授权面走 wgk- key 组快照本就不经 Logto 组，org claim 门禁对本系统
无增量安全收益。

- 身份取自**本地校验过的 ID token claims**（sub/roles/email），不依赖
  Logto userinfo 往返；校验失败一律 401（不向 IdP 发额外网络调用——
  仅 JWKS 按 PyJWT 内置 key 缓存周期性拉取）。
- 未配置 FD_WIRE_LOGTO_ISSUER / FD_WIRE_LOGTO_CLIENT_ID：受保护端点 503
  并给出精确缺项（绝不假登录放行），config 端点如实返回 configured=false。
- sub → Customer 解析：owner 走 ``billing_customers.logto_sub`` 唯一映射
  （wire-self-serve-launch 1.1），成员走 ``customer_members.logto_sub``
  回退（wire-team-spaces ``resolve_member_role``）；两者均缺失 → 401
  （首登走 POST /api/console/session 自动开户/邀请兑换，见 onboarding.py
  与 team.py）。
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..admin.db import get_db as get_platform_db
from ..billing.models import Customer
from .models import CustomerMember

ALGORITHMS = ["ES384", "RS256", "ES256"]

#: 登录配置运行时下发的 scopes（契约：/api/console/auth/config）
CONSOLE_SCOPES = ["openid", "profile", "email", "roles", "offline_access"]

#: viewer 被拒的变更类方法（wire-team-spaces 角色门禁：viewer 只读）
VIEWER_DENIED_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

#: 密钥物面端点前缀（owner-only；wire-team-spaces）：客户凭据的明文/铸造/
#: 吊销面——data-plane keys（wdk- 明文铸造/吊销/指纹列表）+ 连接器配对
#: 令牌（fwp_ 一次性明文，换发 fwc_ 长命连接器凭据）。边界匹配含子路径
#: （/api/v1/data-plane-keys/{key_id}）。
KEY_SURFACE_PREFIXES = (
    "/api/v1/data-plane-keys",
    "/api/v1/connectors/pairing-tokens",
)


@dataclass(frozen=True)
class ConsoleIdentity:
    """已校验的控制台身份（身份键 = Logto sub）。"""

    sub: str
    email: str | None = None
    roles: list[str] = field(default_factory=list)
    claims: dict[str, Any] = field(default_factory=dict)

    def has_role(self, role: str) -> bool:
        return role in self.roles


def logto_issuer() -> str:
    """FD_WIRE_LOGTO_ISSUER（如 https://auth.finddatatech.cloud；issuer claim 取其 /oidc）。"""
    return os.getenv("FD_WIRE_LOGTO_ISSUER", "").strip().rstrip("/")


def logto_client_id() -> str:
    return os.getenv("FD_WIRE_LOGTO_CLIENT_ID", "").strip()


def auth_config() -> dict[str, Any]:
    """/api/console/auth/config 的响应体（未配置时如实 configured=false）。"""
    issuer = logto_issuer()
    client_id = logto_client_id()
    if not issuer or not client_id:
        return {"configured": False}
    return {
        "configured": True,
        "issuer": issuer,
        "client_id": client_id,
        "scopes": list(CONSOLE_SCOPES),
        "organization_required": False,
    }


@lru_cache(maxsize=8)
def _jwks_client(jwks_url: str):
    """JWKS 客户端缓存（PyJWT 内置 key 缓存；URL 作键）。"""
    from jwt import PyJWKClient

    return PyJWKClient(jwks_url, cache_keys=True, lifespan=3600)


def _claim_list(claims: dict[str, Any], name: str) -> list[str]:
    value = claims.get(name)
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value]
    return []


def _decode_id_token(token: str) -> dict[str, Any]:
    """校验 Logto ID token：签名（JWKS）+ issuer + audience + exp/iat。"""
    issuer = logto_issuer()
    client_id = logto_client_id()
    if not issuer or not client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "console login not configured: set FD_WIRE_LOGTO_ISSUER and "
                "FD_WIRE_LOGTO_CLIENT_ID (see deploy/README.md, Logto wire SPA app)"
            ),
        )
    try:
        import jwt as pyjwt

        signing_key = _jwks_client(f"{issuer}/oidc/jwks").get_signing_key_from_jwt(token)
        return pyjwt.decode(
            token,
            signing_key.key,
            algorithms=ALGORITHMS,
            issuer=f"{issuer}/oidc",
            audience=client_id,
            options={"verify_exp": True, "verify_iat": True, "verify_aud": True},
        )
    except HTTPException:
        raise
    except Exception as exc:  # 各类 JWT 失败统一 401，细节只回显异常类型
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"invalid console token: {type(exc).__name__}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def bearer_token(request: Request) -> str:
    """提取 Bearer ID token；缺失/形态不对一律 401。"""
    authorization = request.headers.get("authorization") or ""
    scheme, _, token = authorization.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少 Bearer ID token（控制台鉴权）",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token


def verify_id_token(token: str) -> ConsoleIdentity:
    """校验并解析 ID token → ConsoleIdentity（无组织门禁，design D2）。"""
    claims = _decode_id_token(token)
    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="console token carries no usable sub claim",
            headers={"WWW-Authenticate": "Bearer"},
        )
    email = claims.get("email")
    return ConsoleIdentity(
        sub=sub.strip(),
        email=str(email) if isinstance(email, str) and email.strip() else None,
        roles=_claim_list(claims, "roles"),
        claims=claims,
    )


def resolve_customer(db: Session, sub: str) -> Customer | None:
    """sub → Customer（logto_sub 唯一映射；映射缺失返回 None）。"""
    return db.execute(
        select(Customer).where(Customer.logto_sub == sub)
    ).scalar_one_or_none()


def resolve_member_role(db: Session, sub: str) -> tuple[Customer, str] | None:
    """sub → (Customer, role)（wire-team-spaces；owner 优先→成员回退）。

    - owner：``billing_customers.logto_sub`` 命中 → role='owner'（创建者
      本人，不落成员表）；
    - 成员：``customer_members.logto_sub`` 命中（全局唯一，一人一队）→
      role=成员行 role（editor|viewer）；
    - 均未命中 → None（含成员行指向的客户行被清理的腐化态——按无归属
      处理，401 面不变）。

    成员 sub 与任何 ``Customer.logto_sub`` 的互斥由本函数的 owner 优先
    解析天然覆盖：兑换入口先查本函数，命中即「已有归属」拒。
    """
    customer = resolve_customer(db, sub)
    if customer is not None:
        return customer, "owner"
    member = db.execute(
        select(CustomerMember).where(CustomerMember.logto_sub == sub)
    ).scalar_one_or_none()
    if member is not None:
        customer = db.get(Customer, member.customer_id)
        if customer is not None:
            return customer, member.role
    return None


def _hits_key_surface(path: str) -> bool:
    """路径是否命中密钥物面前缀（含子路径，边界对齐段）。"""
    return any(
        path == prefix or path.startswith(prefix + "/") for prefix in KEY_SURFACE_PREFIXES
    )


def require_console_customer(
    request: Request, db: Session = Depends(get_platform_db)
) -> Customer:
    """控制台端点鉴权依赖：有效 Bearer ID token → 映射客户（缺失 401）。

    X-Customer-Id 不再被客户侧端点接受（占位登录退位，wire-self-serve-launch
    4.5）；映射缺失的新 sub 先经 POST /api/console/session 首登开户。

    wire-team-spaces 门禁升级（既有路由零改动受保护——门禁在统一依赖内，
    角色判定只来自服务端身份解析）：
    - 解析 (customer, role)（owner 优先→成员回退）；未映射/被撤销 401；
    - viewer 调变更类方法（POST/PUT/PATCH/DELETE）→ 403（viewer 只读）；
    - 密钥物面端点（KEY_SURFACE_PREFIXES）非 owner → 403（owner-only）。
    """
    identity = verify_id_token(bearer_token(request))
    resolved = resolve_member_role(db, identity.sub)
    if resolved is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录身份尚未映射到客户（请先完成首次登录开户）",
            headers={"WWW-Authenticate": "Bearer"},
        )
    customer, role = resolved
    if role == "viewer" and request.method in VIEWER_DENIED_METHODS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="团队成员权限不足（viewer 只读）",
        )
    if role != "owner" and _hits_key_surface(request.url.path):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="团队成员权限不足（密钥管理仅 owner）",
        )
    return customer


def require_console_member_identity(
    request: Request, db: Session = Depends(get_platform_db)
) -> tuple[Customer, str]:
    """个人面依赖（wire-personal-preferences）：任意已映射身份（含 viewer）。

    与 require_console_customer 同源解析（verify_id_token →
    resolve_member_role，owner 优先→成员回退），未映射 401 同文案；返回
    (Customer, sub)——偏好按 sub 一人一行，Customer 只用于置顶看板的
    客户归属校验。

    **刻意不做两类门禁**（与 require_console_customer 的差异所在）：
    - 无 viewer 方法级只读门禁：偏好是 per-sub 个人 UI 数据（语言/落地
      页/置顶看板），不是客户业务数据——viewer 改自己的界面习惯不属于
      「变更客户面」，必须可 GET 也可 PUT；
    - 无密钥物面 owner-only 门禁：偏好端点不在 KEY_SURFACE_PREFIXES 面
      上，本就不涉密钥物。
    """
    identity = verify_id_token(bearer_token(request))
    resolved = resolve_member_role(db, identity.sub)
    if resolved is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录身份尚未映射到客户（请先完成首次登录开户）",
            headers={"WWW-Authenticate": "Bearer"},
        )
    customer, _role = resolved
    return customer, identity.sub


def require_console_owner(
    request: Request, db: Session = Depends(get_platform_db)
) -> tuple[Customer, str]:
    """团队管理面依赖（wire-team-spaces）：owner-only。

    返回 (Customer, caller_sub)；未归属 401（语义同 require_console_customer），
    editor/viewer 403（团队管理仅 owner）。
    """
    identity = verify_id_token(bearer_token(request))
    resolved = resolve_member_role(db, identity.sub)
    if resolved is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录身份尚未映射到客户（请先完成首次登录开户）",
            headers={"WWW-Authenticate": "Bearer"},
        )
    customer, role = resolved
    if role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="团队成员权限不足（团队管理仅 owner）",
        )
    return customer, identity.sub


def require_console_customer_id(
    request: Request, db: Session = Depends(get_platform_db)
) -> str:
    """同上，返回客户面命名空间键（datasets/demands/provenance/ai 四路由
    身份键）。

    键取 ``billing_customers.name``：v1 客户面数据（datasets/demands/溯源
    账本）与 cell 命名（fd-wire-cell-<id>）都以该字符串为键，存量口径不变；
    身份解析仍只认 ``logto_sub`` 唯一映射（名字只是命名空间，不参与鉴权）。
    """
    return str(require_console_customer(request, db).name)


__all__ = [
    "ALGORITHMS",
    "CONSOLE_SCOPES",
    "KEY_SURFACE_PREFIXES",
    "VIEWER_DENIED_METHODS",
    "ConsoleIdentity",
    "auth_config",
    "bearer_token",
    "get_platform_db",
    "logto_client_id",
    "logto_issuer",
    "require_console_customer",
    "require_console_customer_id",
    "require_console_member_identity",
    "require_console_owner",
    "resolve_customer",
    "resolve_member_role",
    "verify_id_token",
]
