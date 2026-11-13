"""内部端点鉴权（``X-Internal-Token``）——叶子模块，供跨子系统共用。

**为什么单独一个文件。** ``cell_provision/routes.py`` 原先
``from ..demands.routes import _require_internal``，而这会踩导入环：

    demands.routes → console.auth → console.db → admin.routes
      → cell_provision.routes → demands.routes（尚未定义到 _require_internal）

后果不是"某个入口慢"而是**整个模块无法导入**：干净检出的 gitee/main 上
``pytest tests/test_wanxing_client.py`` 单独收集就 ImportError（2026-11-13
实测）。叶子模块只依赖 stdlib 与 fastapi，任何入口顺序都能解析，环消失。

还有几处同款闸（datasets / bench_pull / billing / catalog / materialization）
各自持有一份拷贝，它们不在这个环上，也可能比对别的 env（xingyan 就用
``XINGYAN_INTERNAL_TOKEN``），故本次不动——口径一致仍靠各自的测试，不靠注释。
"""

from __future__ import annotations

import os
import secrets

from fastapi import Header, HTTPException, status

#: 未配 ``FD_WIRE_INTERNAL_TOKEN`` 时的开发缺省（生产由部署面注入，见 deploy/k8s）。
DEFAULT_INTERNAL_TOKEN = "wire-internal-dev"


def require_internal(
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> None:
    """与 ``FD_WIRE_INTERNAL_TOKEN`` 常量时间比对；缺失/空白一律 401。"""
    expected = os.getenv("FD_WIRE_INTERNAL_TOKEN", DEFAULT_INTERNAL_TOKEN)
    if not x_internal_token or not secrets.compare_digest(x_internal_token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="内部端点需要有效的 X-Internal-Token",
        )
