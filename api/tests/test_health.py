"""冒烟测试：/health 200 与示例路由形状。"""

from fastapi.testclient import TestClient

from fd_wire_api.app import app


def test_health_ok() -> None:
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_readyz_ok_when_db_reachable() -> None:
    """DB 可达（测试用 sqlite）→ /readyz 200。"""
    client = TestClient(app)
    resp = client.get("/readyz")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ready"


def test_readyz_503_when_db_unreachable(monkeypatch) -> None:
    """/readyz 在 DB 不可达时 MUST 503（区别于 /health 恒 200）。

    这是「DB 单点挂掉时探针假绿」的直接回归：/health 不碰 DB 恒 200，
    /readyz 必须反映 DB 可达性。
    """
    from fd_wire_api import admin

    class _Boom:
        def connect(self):
            raise RuntimeError("db down")

    monkeypatch.setattr(admin.db, "get_engine", lambda: _Boom())
    client = TestClient(app)
    resp = client.get("/readyz")
    assert resp.status_code == 503
    assert resp.json()["status"] == "not_ready"
    # /health 仍 200（纯进程存活，不碰 DB）
    assert client.get("/health").status_code == 200


def test_contracts_shape() -> None:
    client = TestClient(app)
    resp = client.get("/api/v1/contracts")
    assert resp.status_code == 200
    contracts = resp.json()["contracts"]
    assert set(contracts) == {
        "business_mcp_url",
        "registry_url",
        "sub2api_base",
        "token_gateway_url",
    }
