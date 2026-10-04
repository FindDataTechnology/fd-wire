"""内部后台鉴权：``X-Admin-Token`` 与 env ``FD_WIRE_ADMIN_TOKEN`` 比对。

fail-closed 纪律（与 metering ingest 令牌同款）：
- env 未配置（缺省/空串）→ 一律 403，绝不无鉴权放行；
- 已配置但请求头缺失/不匹配 → 401（compare_digest 常量时间比对）。
"""

from __future__ import annotations

import os
import secrets

from fastapi import Header, HTTPException, status


def require_admin_token(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> None:
    """全部 /internal/admin/* 端点的鉴权依赖。"""
    expected = os.getenv("FD_WIRE_ADMIN_TOKEN")
    if not expected:
        # 未配置令牌：拒绝一切访问而不是无鉴权放行（fail-closed）
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="admin token not configured (FD_WIRE_ADMIN_TOKEN)",
        )
    if not x_admin_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少 X-Admin-Token（内部后台鉴权头）",
        )
    if not secrets.compare_digest(x_admin_token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的 X-Admin-Token",
        )
