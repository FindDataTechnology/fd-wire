"""能力快照自查（``fd_wire_api.ai.llm.model_verdict``）的测试。

锁五件事：
  1. 任何失败都必须 checked=False（→ 调用行为不变），不许抛
  2. serving / permitted_only / 都看不到 —— 三种诊断必须可区分
  3. 大小写与形状（dict 或裸字符串）都要吃
  4. key 与 token 绝不出现在返回结构里
  5. base URL 两种形状（带 /v1 与不带）都能拼出同一目标路径，不会 /v1/v1

外部 HTTP 全部打本进程内的 ``http.server`` 桩，绝不打真网。
"""

from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from fd_wire_api.ai import llm
from fd_wire_api.ai.db import reset_ai_runtime

SCHEMA = "ciyuan.capabilities/v1"
TEST_KEY = "sk-test-should-never-leak"


class _Stub(BaseHTTPRequestHandler):
    """最小能力快照桩：由类属性 payload / status 控制响应。

    ``seen_paths`` 记录收到的请求路径，供 base-URL 拼接形状断言。
    """

    payload: dict | None = None
    status: int = 200
    seen_paths: list[str] = []

    def do_GET(self) -> None:  # noqa: N802
        type(self).seen_paths.append(self.path)
        if not self.path.endswith("/ciyuan/capabilities"):
            self.send_response(404)
            self.end_headers()
            return
        body = json.dumps(self.payload if self.payload is not None else {}).encode()
        self.send_response(self.status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args) -> None:  # 静音
        return


@contextmanager
def _serve(base_url_template: str):
    """起一个本地桩网关，把 ``{port}`` 填进 base URL；推出后关停。"""
    _Stub.payload = None
    _Stub.status = 200
    _Stub.seen_paths = []
    server = HTTPServer(("127.0.0.1", 0), _Stub)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    try:
        yield base_url_template.format(port=port)
    finally:
        server.shutdown()
        thread.join(timeout=5)


@pytest.fixture()
def gateway(monkeypatch):
    """桩网关 + 指向它的 settings（base 带 ``/v1``，与生产 token 网关同形）。

    ``_Stub`` 的类属性必须每个用例复位——否则前一个用例设的 404/503 会漏给
    下一个，表现为「单独跑绿、连跑红」的假失败。
    """
    with _serve("http://127.0.0.1:{port}") as base:
        monkeypatch.setenv("TOKEN_GATEWAY_URL", base)
        monkeypatch.setenv("TOKEN_GATEWAY_KEY", TEST_KEY)
        monkeypatch.delenv("TOKEN_GATEWAY_MODEL", raising=False)
        reset_ai_runtime()
        try:
            yield _Stub
        finally:
            reset_ai_runtime()


def _snapshot(serving=(), permitted_only=()):
    return {
        "schema": SCHEMA,
        "generated_at": "2026-11-10T15:00:00Z",
        "basis": "schedulable_account_config",
        "probed": False,
        "models": {
            "serving": [{"id": m, "kind": "unknown"} for m in serving],
            "permitted_only": [
                {"id": m, "kind": "unknown", "basis": "allowlist"} for m in permitted_only
            ],
            "counts": {"serving": len(serving), "permitted_only": len(permitted_only)},
        },
        "lanes": {},
        "media": {},
        "limits": {},
    }


# ── 1. 三种诊断可区分 ─────────────────────────────────────

def test_default_model_in_serving(gateway, monkeypatch):
    gateway.payload = _snapshot(serving=["glm-4.7", "deepseek-v4.1-flash"])
    monkeypatch.setenv("TOKEN_GATEWAY_MODEL", "glm-4.7")

    v = llm.model_verdict()

    assert v["checked"] is True
    assert v["in_serving"] is True
    assert v["in_permitted_only"] is False
    assert v["serving_count"] == 2
    assert "可正常服务" in v["note"]


def test_default_model_only_permitted(gateway, monkeypatch):
    # 白名单放行、但没有可调度账号能服务 —— 真实调用会失败的那种
    gateway.payload = _snapshot(serving=["other-model"], permitted_only=["glm-4.7"])
    monkeypatch.setenv("TOKEN_GATEWAY_MODEL", "glm-4.7")

    v = llm.model_verdict()

    assert v["checked"] is True
    assert v["in_serving"] is False
    assert v["in_permitted_only"] is True
    assert "permitted_only" in v["note"]


def test_default_model_unknown_to_key(gateway, monkeypatch):
    # id 形状漂移的典型症状：服务端换了名字，这边还写着旧名
    gateway.payload = _snapshot(serving=["deepseek-v4.1-flash"])
    monkeypatch.setenv("TOKEN_GATEWAY_MODEL", "glm-4.7")

    v = llm.model_verdict()

    assert v["checked"] is True
    assert v["in_serving"] is False
    assert v["in_permitted_only"] is False
    assert "看不到它" in v["note"]
    assert v["suggestions"] == ["deepseek-v4.1-flash"]


def test_uses_configured_default_model_when_not_passed(gateway):
    """不传 model 时判定 settings 的默认模型（本仓 glm-4.7，与参考实现的
    gpt-5.4-mini 不同）。"""
    gateway.payload = _snapshot(serving=["glm-4.7"])

    v = llm.model_verdict()

    assert v["checked"] is True
    assert v["model"] == "glm-4.7"
    assert v["in_serving"] is True


# ── 2. 一切失败都 checked=False ────────────────────────────

def test_no_key_skips_entirely(monkeypatch):
    monkeypatch.delenv("TOKEN_GATEWAY_KEY", raising=False)
    reset_ai_runtime()
    try:
        v = llm.model_verdict()
    finally:
        reset_ai_runtime()
    assert v["checked"] is False
    assert v["in_serving"] is None
    assert "调用行为不受影响" in v["note"]


def test_endpoint_missing_404(gateway):
    gateway.payload = None
    gateway.status = 404
    v = llm.model_verdict()
    assert v["checked"] is False
    assert v["in_serving"] is None


def test_endpoint_503(gateway):
    gateway.payload = {"error": {"type": "lane_upstream_unavailable"}}
    gateway.status = 503
    v = llm.model_verdict()
    assert v["checked"] is False


def test_schema_mismatch_rejected(gateway):
    gateway.payload = _snapshot(serving=["m"])
    gateway.payload["schema"] = "other/v9"
    v = llm.model_verdict()
    assert v["checked"] is False, "schema 不符不许当成 v1 用"


def test_malformed_models_rejected(gateway):
    gateway.payload = {"schema": SCHEMA, "models": {"serving": "nope"}}
    v = llm.model_verdict()
    assert v["checked"] is False


def test_unreachable_gateway(monkeypatch):
    monkeypatch.setenv("TOKEN_GATEWAY_KEY", "sk-x")
    monkeypatch.setenv("TOKEN_GATEWAY_URL", "http://127.0.0.1:1")  # 必然拒绝
    reset_ai_runtime()
    try:
        v = llm.model_verdict(timeout=0.5)
    finally:
        reset_ai_runtime()
    assert v["checked"] is False


# ── 3. 形状与大小写 ───────────────────────────────────────

def test_accepts_bare_string_ids_and_case_insensitive(gateway, monkeypatch):
    gateway.payload = {
        "schema": SCHEMA,
        "models": {"serving": ["GLM-4.7"], "permitted_only": []},
    }
    monkeypatch.setenv("TOKEN_GATEWAY_MODEL", "glm-4.7")
    v = llm.model_verdict()
    assert v["checked"] is True
    assert v["in_serving"] is True


# ── 4. 不泄露 ─────────────────────────────────────────────

def test_key_never_appears_in_verdict(gateway):
    gateway.payload = _snapshot(serving=["m"])
    v = llm.model_verdict()
    blob = json.dumps(v, ensure_ascii=False)
    assert TEST_KEY not in blob
    assert "Bearer" not in blob


# ── 5. base URL 两种形状 ─────────────────────────────────

@pytest.mark.parametrize(
    "base",
    [
        "https://token.finddatatech.cloud",
        "https://token.finddatatech.cloud/",
        "https://token.finddatatech.cloud/v1",
        "https://token.finddatatech.cloud/v1/",
    ],
)
def test_capabilities_url_join_both_shapes(base):
    """不带 /v1 的 base 补 /v1，带 /v1 的不重复补。"""
    assert (
        llm.capabilities_url(base)
        == "https://token.finddatatech.cloud/v1/ciyuan/capabilities"
    )


def test_request_works_with_v1_suffixed_base(monkeypatch):
    """base 已带 /v1（参考实现的形状）→ 请求 /v1/ciyuan/capabilities。"""
    _Stub.payload = None
    with _serve("http://127.0.0.1:{port}/v1") as base:
        monkeypatch.setenv("TOKEN_GATEWAY_URL", base)
        monkeypatch.setenv("TOKEN_GATEWAY_KEY", TEST_KEY)
        reset_ai_runtime()
        try:
            _Stub.payload = _snapshot(serving=["glm-4.7"])
            v = llm.model_verdict("glm-4.7")
        finally:
            reset_ai_runtime()
    assert v["checked"] is True
    assert _Stub.seen_paths == ["/v1/ciyuan/capabilities"]


def test_request_works_with_bare_base(monkeypatch):
    """base 不带 /v1（本仓 settings 默认）→ 同样请求 /v1/ciyuan/capabilities。"""
    _Stub.payload = None
    with _serve("http://127.0.0.1:{port}") as base:
        monkeypatch.setenv("TOKEN_GATEWAY_URL", base)
        monkeypatch.setenv("TOKEN_GATEWAY_KEY", TEST_KEY)
        reset_ai_runtime()
        try:
            _Stub.payload = _snapshot(serving=["glm-4.7"])
            v = llm.model_verdict("glm-4.7")
        finally:
            reset_ai_runtime()
    assert v["checked"] is True
    assert _Stub.seen_paths == ["/v1/ciyuan/capabilities"]


# ── 6. CLI 入口 ──────────────────────────────────────────

def test_cli_requires_flag(capsys):
    assert llm.main([]) == 2
    assert "--check-model" in capsys.readouterr().err


def test_cli_prints_json(gateway, monkeypatch, capsys):
    gateway.payload = _snapshot(serving=["glm-4.7"])
    monkeypatch.setenv("TOKEN_GATEWAY_MODEL", "glm-4.7")
    reset_ai_runtime()

    assert llm.main(["--check-model"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["checked"] is True
    assert out["in_serving"] is True
