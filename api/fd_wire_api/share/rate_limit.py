"""公开表单提交的令牌级滑动窗限流器（wire-form-builder design D3）。

公开提交面防滥用的 v0 手段（验证码/邮件确认明示非目标）：每把分享令牌
一个独立滑动窗（``N 次 / 小时``），进程内实现——

- **键 = 令牌 mac 段**（token 第三段）：不存完整 token（明文 version/exp
  不进键，也不在限流器里留可重放的令牌材料）；mac 随每次生成都不同，
  重新生成的链接自然是新桶（额度不继承——按 design「一条链接一个额度」）；
- **滑动窗**：``collections.deque`` 存命中时间戳 + ``threading.Lock``
  全程持锁（deque popleft/append 与 len 判定在同一临界区内，线程安全）；
- **阈值惰性读 env**：逐请求 ``os.getenv``（照 share secret 范式——测试
  可逐用例注入、配置变更无需重启即生效）；``FD_WIRE_SHARE_SUBMIT_RATE_
  PER_HOUR`` 缺省 60，未配置/非整数/非正数一律回退 60（防御位，不整端点炸）；
- **超限不落库**：``allow`` 返回 False 时调用方（路由层）在任何写路径
  之前直接 429；被拒请求**不记入窗位**（不消耗额度，只等窗滑动）；
- ``Retry-After`` = 窗首命中滑出窗口的秒数（至少 1——头值不出现 0）。

单副本进程内限流 = v0 明示边界（现产单副本 api；多副本时换共享存储，
届时另立 change）。长期不再访问的键的空窗位留在内存中（每令牌一条
deque，量级 = 曾活跃的令牌数）——v0 接受，不做过期清扫。
"""

from __future__ import annotations

import os
import threading
import time
from collections import deque

#: 缺省限流阈值：每令牌每小时 60 次
DEFAULT_RATE_PER_HOUR = 60

#: 滑动窗宽度（秒）——「N 次 / 小时」口径的窗口本身
WINDOW_SECONDS = 3600.0


def rate_per_hour() -> int:
    """限流阈值：逐请求惰性读 ``FD_WIRE_SHARE_SUBMIT_RATE_PER_HOUR``。

    未配置/空白 → 缺省 60；非整数或非正数 → 同样回退 60（非法配置不放大
    也不归零限流——fail-closed 到缺省值）。
    """
    raw = os.getenv("FD_WIRE_SHARE_SUBMIT_RATE_PER_HOUR", "").strip()
    if not raw:
        return DEFAULT_RATE_PER_HOUR
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_RATE_PER_HOUR
    return value if value > 0 else DEFAULT_RATE_PER_HOUR


def mac_segment(token: str) -> str:
    """取令牌 mac 段（第三段）作限流键。

    调用点在令牌验签**之后**（验签已保证三段格式），此处非三段即
    ValueError——防御位（绝不回退存完整 token）。
    """
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("令牌非三段格式（version.exp.mac）——无法取 mac 段")
    return parts[2]


class SlidingWindowLimiter:
    """进程内滑动窗限流器：键 → deque[命中时间戳]，全程持锁。"""

    def __init__(self, window_seconds: float = WINDOW_SECONDS) -> None:
        self._window = float(window_seconds)
        self._lock = threading.Lock()
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str, *, now: float | None = None) -> tuple[bool, int]:
        """尝试占一个窗位；返回 ``(是否放行, retry_after_seconds)``。

        放行即记录命中时间戳；超限**不记录**（被拒请求不消耗窗位）。
        ``retry_after_seconds`` = 窗首命中滑出窗口的剩余秒数向上取整到
        至少 1（``Retry-After`` 响应头不出现 0/负值）。
        """
        current = time.time() if now is None else float(now)
        limit = rate_per_hour()
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            cutoff = current - self._window
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) >= limit:
                retry_after = int(hits[0] + self._window - current) or 1
                return False, max(retry_after, 1)
            hits.append(current)
            return True, 0

    def clear(self) -> None:
        """清空全部窗位（测试复位入口）。"""
        with self._lock:
            self._hits.clear()


#: 进程内单例（现产单副本 api——多副本边界见模块 docstring）
limiter = SlidingWindowLimiter()


def allow(key: str, *, now: float | None = None) -> tuple[bool, int]:
    """单例捷径（路由层入口）。"""
    return limiter.allow(key, now=now)


def reset() -> None:
    """测试复位：清空限流窗（用例间隔离，不跨用例累计额度）。"""
    limiter.clear()
