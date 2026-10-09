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
- sub → Customer 解析：``billing_customers.logto_sub`` 唯一映射
  （wire-self-serve-launch 1.1）；映射缺失 → 401（首登走
  POST /api/console/session 自动开户，见 onboarding.py）。
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

ALGORITHMS = ["ES384", "RS256", "ES256"]

#: 登录配置运行时下发的 scopes（契约：/api/console/auth/config）
CONSOLE_SCOPES = ["openid", "profile", "email", "roles", "offline_access"]


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


def require_console_customer(
    request: Request, db: Session = Depends(get_platform_db)
) -> Customer:
    """控制台端点鉴权依赖：有效 Bearer ID token → 映射客户（缺失 401）。

    X-Customer-Id 不再被客户侧端点接受（占位登录退位，wire-self-serve-launch
    4.5）；映射缺失的新 sub 先经 POST /api/console/session 首登开户。
    """
    identity = verify_id_token(bearer_token(request))
    customer = resolve_customer(db, identity.sub)
    if customer is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录身份尚未映射到客户（请先完成首次登录开户）",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return customer


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
    "ConsoleIdentity",
    "auth_config",
    "bearer_token",
    "get_platform_db",
    "logto_client_id",
    "logto_issuer",
    "require_console_customer",
    "require_console_customer_id",
    "resolve_customer",
    "verify_id_token",
]
