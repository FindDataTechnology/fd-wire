"""sub2api admin 客户端：客户代建 / 读取 / 幂等余额调整 / 余额探针。

对外部服务只走显式 HTTP 契约（README「借用契约」纪律）：
- base 可被 SUB2API_BASE 覆盖（config.settings.sub2api_base 同名映射）
- admin key 读 SUB2API_ADMIN_KEY
- 写操作一律带 Idempotency-Key 头，由服务端幂等兜底

端点契约（v1 约定，若 sub2api 实际面不同在此一处调整）：
- POST   {base}/admin/api/users                             # createUser
- GET    {base}/admin/api/users/{user_id}                   # readUser
- POST   {base}/admin/api/users/{user_id}/balance-adjustments  # adjustBalance
线上金额与余额一律用整数微元（*_micro 字段），读取侧对「balance=元」的
兼容形态也接受。所有外部 HTTP 依赖在测试中经 httpx.MockTransport mock。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from ..config import settings
from .money import MICRO_PER_YUAN


class Sub2ApiError(Exception):
    """sub2api 返回非 2xx 或响应不合契约。"""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class Sub2ApiUnavailable(Sub2ApiError):
    """计费面不可达（网络/5xx）——预检 fail-closed 语义由此表达。"""


@dataclass(frozen=True)
class Sub2User:
    id: str
    name: str
    balance_micro: int


@dataclass(frozen=True)
class ProbeResult:
    """余额探针结果：不可达时 sufficient 恒为 False（fail-closed）。"""

    user_id: str
    reachable: bool
    balance_micro: int | None = None
    min_balance_micro: int = 0
    error: str | None = None

    @property
    def sufficient(self) -> bool:
        if not self.reachable or self.balance_micro is None:
            return False
        return self.balance_micro >= self.min_balance_micro


def _balance_to_micro(raw: Any) -> int:
    """余额 → 微元：优先 *_micro 整数；兼容元单位的 int/float/str。"""
    if raw is None:
        raise Sub2ApiError("sub2api 响应缺余额字段")
    if isinstance(raw, bool):
        raise Sub2ApiError(f"余额字段类型非法: {raw!r}")
    if isinstance(raw, int):
        return raw
    try:
        return int((Decimal(str(raw)) * MICRO_PER_YUAN).to_integral_value())
    except (InvalidOperation, ValueError) as exc:
        raise Sub2ApiError(f"余额字段解析失败: {raw!r}") from exc


def parse_user(payload: dict[str, Any]) -> Sub2User:
    """容错解析用户对象：接受平铺或 {"user": {...}} 包裹。"""
    body = payload.get("user", payload) if isinstance(payload, dict) else None
    if not isinstance(body, dict) or "id" not in body:
        raise Sub2ApiError(f"sub2api 用户响应不合契约: {payload!r}")
    raw_balance = body.get("balance_micro", body.get("balance", 0))
    return Sub2User(
        id=str(body["id"]),
        name=str(body.get("name", "")),
        balance_micro=_balance_to_micro(raw_balance),
    )


class Sub2ApiClient:
    """sub2api 计费面 admin 客户端（线程不共享实例；用完 close 或 with）。"""

    def __init__(
        self,
        base_url: str | None = None,
        admin_key: str | None = None,
        *,
        http_client: httpx.Client | None = None,
        timeout: float = 10.0,
    ) -> None:
        self._base = (base_url or os.environ.get("SUB2API_BASE") or settings.sub2api_base).rstrip("/")
        self._admin_key = admin_key if admin_key is not None else os.environ.get("SUB2API_ADMIN_KEY", "")
        self._owns_http = http_client is None
        self._http = http_client or httpx.Client(timeout=timeout)

    # -- 基础设施 ---------------------------------------------------------

    def _headers(self, idempotency_key: str | None = None) -> dict[str, str]:
        headers = {"Authorization": f"Bearer {self._admin_key}"}
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    def _request(self, method: str, url: str, *, json_body: dict | None = None,
                 idempotency_key: str | None = None) -> dict[str, Any]:
        try:
            resp = self._http.request(
                method, url, json=json_body, headers=self._headers(idempotency_key)
            )
        except httpx.HTTPError as exc:
            raise Sub2ApiUnavailable(f"sub2api 不可达: {exc}") from exc
        if resp.status_code >= 500:
            raise Sub2ApiUnavailable(f"sub2api 5xx: {resp.status_code}", resp.status_code)
        if resp.status_code >= 400:
            raise Sub2ApiError(f"sub2api {resp.status_code}: {resp.text[:200]}", resp.status_code)
        try:
            return resp.json()
        except ValueError as exc:
            raise Sub2ApiError(f"sub2api 响应非 JSON: {resp.text[:200]!r}") from exc

    def close(self) -> None:
        if self._owns_http:
            self._http.close()

    def __enter__(self) -> "Sub2ApiClient":
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    # -- 三个方法 + 余额探针 ----------------------------------------------

    def create_user(self, *, name: str, idempotency_key: str, plan_code: str | None = None) -> Sub2User:
        """createUser：带 Idempotency-Key，重试不重复建户。"""
        if not idempotency_key:
            raise ValueError("create_user 必须显式传 idempotency_key")
        payload = self._request(
            "POST",
            f"{self._base}/admin/api/users",
            json_body={"name": name, "plan": plan_code},
            idempotency_key=idempotency_key,
        )
        return parse_user(payload)

    def read_user(self, user_id: str) -> Sub2User:
        """readUser：余额快照（对账消费）。"""
        payload = self._request("GET", f"{self._base}/admin/api/users/{user_id}")
        return parse_user(payload)

    def adjust_balance(self, *, user_id: str, amount_micro: int,
                       idempotency_key: str) -> Sub2User:
        """adjustBalance：amount_micro 带符号（负=扣减）；Idempotency-Key 幂等。"""
        if not idempotency_key:
            raise ValueError("adjust_balance 必须显式传 idempotency_key")
        payload = self._request(
            "POST",
            f"{self._base}/admin/api/users/{user_id}/balance-adjustments",
            json_body={"amount_micro": amount_micro},
            idempotency_key=idempotency_key,
        )
        return parse_user(payload)

    def probe(self, user_id: str, *, min_balance_micro: int = 0) -> ProbeResult:
        """余额探针：不可达/报错→reachable=False 且 sufficient=False（fail-closed）。"""
        try:
            user = self.read_user(user_id)
        except Sub2ApiError as exc:
            return ProbeResult(
                user_id=user_id,
                reachable=False,
                min_balance_micro=min_balance_micro,
                error=str(exc),
            )
        return ProbeResult(
            user_id=user_id,
            reachable=True,
            balance_micro=user.balance_micro,
            min_balance_micro=min_balance_micro,
        )
