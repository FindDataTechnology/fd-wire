"""LlmClient 生产实现：token 网关的 OpenAI 兼容 chat/completions 面。

env 契约：``TOKEN_GATEWAY_URL`` / ``TOKEN_GATEWAY_KEY`` /
``TOKEN_GATEWAY_MODEL``。httpx 客户端可注入（测试全 mock，不打真网）。
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from .protocols import LlmAssistantMessage, ToolCall
from .settings import get_settings


class LlmGatewayError(RuntimeError):
    """token 网关不可达 / 非 2xx / 响应不合契约（循环侧如实反馈）。"""


class TokenGatewayLlmClient:
    """LlmClient 生产实现：``POST {TOKEN_GATEWAY_URL}/v1/chat/completions``。"""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        http_client: httpx.Client | None = None,
        timeout: float = 60.0,
    ) -> None:
        s = get_settings()
        self._base = (base_url or s.token_gateway_url).rstrip("/")
        self._api_key = api_key if api_key is not None else s.token_gateway_key
        self._model = model or s.token_gateway_model
        self._owns_http = http_client is None
        self._http = http_client or httpx.Client(timeout=timeout)

    def close(self) -> None:
        if self._owns_http:
            self._http.close()

    def complete(
        self, messages: list[dict], tools: list[dict]
    ) -> LlmAssistantMessage:
        """一次补全：messages + tools（OpenAI 形态）→ 归一化 assistant 消息。"""
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "tools": tools,
        }
        headers = {"Authorization": f"Bearer {self._api_key}"} if self._api_key else {}
        try:
            resp = self._http.post(
                f"{self._base}/v1/chat/completions", json=payload, headers=headers
            )
        except httpx.HTTPError as exc:
            raise LlmGatewayError(f"token 网关不可达: {exc}") from exc
        if resp.status_code >= 400:
            raise LlmGatewayError(
                f"token 网关返回 {resp.status_code}: {resp.text[:200]}"
            )
        try:
            body = resp.json()
            message = body["choices"][0]["message"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise LlmGatewayError("token 网关响应不合 OpenAI 契约") from exc

        tool_calls: list[ToolCall] = []
        for raw in message.get("tool_calls") or []:
            try:
                fn = raw["function"]
                arguments = json.loads(fn.get("arguments") or "{}")
            except (KeyError, TypeError, ValueError) as exc:
                raise LlmGatewayError("tool_calls 形态不合契约") from exc
            if not isinstance(arguments, dict):
                raise LlmGatewayError("tool_calls arguments 必须是 JSON 对象")
            tool_calls.append(
                ToolCall(id=str(raw.get("id") or ""), name=str(fn["name"]), arguments=arguments)
            )
        content = message.get("content")
        return LlmAssistantMessage(
            content=str(content) if content is not None else None,
            tool_calls=tuple(tool_calls),
        )


# ── 能力快照自查（词元 GET /v1/ciyuan/capabilities）────────────────────────
#
# 只读、只回答一个问题：「我配置的默认模型，此刻在这把 key 的 serving 里吗？」
#
# 为什么需要：/v1/models 列的是「认得」的 id，不等于「能服务」；而
# TOKEN_GATEWAY_MODEL 是配置里写死的。词元侧 model id 会双向漂移（带前缀 ↔
# 裸名），漂移发生时真实调用拿 404/400，但代码里看不出任何异常。这个自查把
# 那种静默失败变成一句可读的诊断，交给部署时或排障时手动跑
# （``python -m fd_wire_api.ai.llm --check-model``）。
#
# 纪律：本组函数**绝不改变**调用行为，也绝不抛——快照不可用就返回
# checked=False，调用方照旧用 TOKEN_GATEWAY_MODEL。
CAPABILITIES_PATH = "/ciyuan/capabilities"
CAPABILITIES_SCHEMA = "ciyuan.capabilities/v1"
CAPABILITIES_TIMEOUT = 3.0


def capabilities_url(base_url: str) -> str:
    """能力快照的完整 URL。

    本仓 ``TOKEN_GATEWAY_URL`` 默认**不带** ``/v1``（``complete()`` 自己拼
    ``/v1/chat/completions``），而参考实现那边 base 自带 ``/v1``。两种形状
    都要吃：已带 ``/v1`` 就只补 ``/ciyuan/capabilities``，否则补
    ``/v1/ciyuan/capabilities``。
    """
    base = (base_url or "").strip().rstrip("/")
    if base.endswith("/v1"):
        return f"{base}{CAPABILITIES_PATH}"
    return f"{base}/v1{CAPABILITIES_PATH}"


def capabilities(*, timeout: float = CAPABILITIES_TIMEOUT) -> dict[str, Any] | None:
    """读一次 key-scoped 能力快照。任何失败（无 key / 网络 / 非 200 /
    schema 不符 / 形状不符）都返回 None，绝不抛、绝不记 key。"""
    s = get_settings()
    key = (s.token_gateway_key or "").strip()
    if not key:
        return None
    try:
        resp = httpx.get(
            capabilities_url(s.token_gateway_url),
            headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
            timeout=timeout,
        )
        if resp.status_code != 200:
            return None
        doc = resp.json()
        if not isinstance(doc, dict) or doc.get("schema") != CAPABILITIES_SCHEMA:
            return None
        models = doc.get("models")
        if not isinstance(models, dict):
            return None
        if not isinstance(models.get("serving"), list):
            return None
        if not isinstance(models.get("permitted_only"), list):
            return None
        return doc
    except Exception:  # noqa: BLE001 —— 自查绝不影响主路径
        return None


def _ids(entries: list[Any]) -> set[str]:
    out: set[str] = set()
    for item in entries:
        mid = item.get("id") if isinstance(item, dict) else item
        if isinstance(mid, str) and mid.strip():
            out.add(mid.strip().lower())
    return out


def model_verdict(
    model: str | None = None, *, timeout: float = CAPABILITIES_TIMEOUT
) -> dict[str, Any]:
    """判断配置的默认模型此刻是否可服务。只读，不改变任何调用行为。

    返回：
      checked            是否真的问到了词元（False ⇒ 其余判断不可用）
      model              被判定的 id
      in_serving         在 serving 里（True/False/None=未知）
      in_permitted_only  在 permitted_only 里（「白名单有、账号没有」的典型症状）
      serving_count      serving 条目数（量级参考）
      suggestions        serving 里前几个 id（排障时看形状差异）
      note               一句话结论
    """
    target = (model or get_settings().token_gateway_model).strip()
    doc = capabilities(timeout=timeout)
    if doc is None:
        return {
            "checked": False,
            "model": target,
            "in_serving": None,
            "in_permitted_only": None,
            "serving_count": None,
            "suggestions": [],
            "note": "能力快照不可用（未配 key / 端点缺失 / 超时 / 形状不符）"
            "——调用行为不受影响，仍用配置的默认模型",
        }

    models = doc["models"]
    serving = _ids(models["serving"])
    permitted = _ids(models.get("permitted_only") or [])
    lowered = target.lower()

    in_serving = lowered in serving
    in_permitted = lowered in permitted
    suggestions = sorted(serving)[:5]

    if in_serving:
        note = "默认模型在 serving 里，可正常服务"
    elif in_permitted:
        note = (
            "默认模型只在 permitted_only 里：白名单放行了，但当前没有可调度账号能服务它"
            "——真实调用会失败，应改配置或补账号"
        )
    else:
        note = (
            "默认模型既不在 serving 也不在 permitted_only：这把 key 当前看不到它"
            "（多半是 id 形状漂移或权益变更）"
        )

    return {
        "checked": True,
        "model": target,
        "in_serving": in_serving,
        "in_permitted_only": in_permitted,
        "serving_count": len(serving),
        "suggestions": suggestions,
        "note": note,
    }


def main(argv: list[str] | None = None) -> int:
    """运维自查入口：``python -m fd_wire_api.ai.llm --check-model``。"""
    import sys

    args = list(sys.argv[1:] if argv is None else argv)
    if "--check-model" not in args:
        print("用法: python -m fd_wire_api.ai.llm --check-model", file=sys.stderr)
        return 2
    print(json.dumps(model_verdict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
