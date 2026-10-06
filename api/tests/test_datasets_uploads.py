"""上传（CSV/Excel）解析、类型推断与建档 ingest（任务 2.5）。

覆盖：
- CSV 预览：列名 + 保守类型推断（INTEGER/REAL/TEXT）+ 行数与样例行；
- Excel（openpyxl 造 .xlsx）走同一通道；
- 50 万行上限（此处以设置注入小上限验证）与存储配额 → fail-closed 拒收；
- 不支持扩展名/重名表头/保留前缀/空文件 → 400；
- 建档：分块（2000 行）ingest 引擎、值按声明类型转换、consumed_at 置位、
  同一 upload 二次消费 409；dataset_key 生成与冲突后缀；
- 跨企业 upload/connector 一律 404；缺客户头 401。
"""

from __future__ import annotations

import io
import json
import os

os.environ.setdefault("FD_WIRE_DATASETS_DATABASE_URL", "sqlite://")

import pytest
from openpyxl import Workbook
from sqlalchemy import select

from fd_wire_api.datasets.db import get_session
from fd_wire_api.datasets.ingest import TOOL_INGEST_BEGIN, TOOL_INGEST_CHUNK, TOOL_INGEST_COMMIT
from fd_wire_api.datasets.models import Dataset, Upload
from fd_wire_api.datasets.uploads import infer_type
from test_datasets_common import (
    CUSTOMER_A,
    CUSTOMER_B,
    connector_headers,
    create_connector_dataset,
    create_upload_dataset,
    datasets_env,  # noqa: F401 - pytest fixture
    pair_connector,
    patch_dataset_settings,
    upload_csv,
)

CSV_SAMPLE = (
    "id,amount,name,note\n"
    "1,10.5,alpha,hello\n"
    "2,20.75,beta,\n"
    "3,30,gamma,world\n"
)


def _csv_rows_arg(env) -> list[dict]:
    return env.fake.calls_for(TOOL_INGEST_CHUNK)[0]["rows"]


# ------------------------------------------------------------------ 配置


def test_settings_read_contract_env_names(monkeypatch) -> None:
    """契约 §3.1 的 FD_WIRE_* 环境变量名必须被设置模型读取（别名字段）。"""
    from fd_wire_api.datasets.settings import DatasetsSettings

    monkeypatch.setenv("FD_WIRE_DATASETS_DATABASE_URL", "sqlite:///custom.db")
    monkeypatch.setenv("FD_WIRE_DATASETS_UPLOAD_DIR", "/tmp/u")
    monkeypatch.setenv("FD_WIRE_DATASET_STORAGE_LIMIT_BYTES", "123")
    monkeypatch.setenv("FD_WIRE_DATASET_MAX_ROWS", "7")
    monkeypatch.setenv("FD_WIRE_DATASET_MIN_SYNC_MINUTES", "3")
    monkeypatch.setenv("FD_WIRE_DATASET_CONNECTOR_POLL_SECONDS", "11")
    settings = DatasetsSettings()
    assert settings.datasets_database_url == "sqlite:///custom.db"
    assert settings.datasets_upload_dir == "/tmp/u"
    assert settings.dataset_storage_limit_bytes == 123
    assert settings.dataset_max_rows == 7
    assert settings.dataset_min_sync_minutes == 3
    assert settings.dataset_connector_poll_seconds == 11
    assert settings.heartbeat_offline_seconds == 33


# ------------------------------------------------------------------ 类型推断


def test_infer_type_is_conservative() -> None:
    assert infer_type(["1", "2", "-3", ""]) == "INTEGER"
    assert infer_type(["1", "2.5", ""]) == "REAL"
    assert infer_type(["1", "x"]) == "TEXT"
    assert infer_type(["", ""]) == "TEXT"
    assert infer_type(["0012"]) == "INTEGER"
    assert infer_type(["1,000"]) == "TEXT"


# ------------------------------------------------------------------ 预览


def test_upload_csv_preview_columns_types_and_samples(datasets_env) -> None:
    resp = upload_csv(datasets_env, CSV_SAMPLE)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["within_limit"] is True
    assert body["row_count"] == 3
    assert body["columns"] == [
        {"name": "id", "type": "INTEGER"},
        {"name": "amount", "type": "REAL"},
        {"name": "name", "type": "TEXT"},
        {"name": "note", "type": "TEXT"},
    ]
    assert body["sample_rows"][0] == {
        "id": 1,
        "amount": 10.5,
        "name": "alpha",
        "note": "hello",
    }
    assert body["sample_rows"][1]["note"] is None
    session = get_session()
    try:
        record = session.get(Upload, body["upload_id"])
        assert record is not None and record.consumed_at is None
        assert os.path.exists(record.stored_path)
    finally:
        session.close()


def test_upload_excel_preview_and_create(datasets_env) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["city", "pop"])
    sheet.append(["Beijing", 21540000])
    sheet.append(["Shanghai", 24870000])
    buf = io.BytesIO()
    workbook.save(buf)
    resp = datasets_env.client.post(
        "/api/v1/datasets/uploads",
        headers=CUSTOMER_A,
        files={
            "file": (
                "cities.xlsx",
                buf.getvalue(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["row_count"] == 2
    assert body["columns"] == [
        {"name": "city", "type": "TEXT"},
        {"name": "pop", "type": "INTEGER"},
    ]
    created = create_upload_dataset(datasets_env, body["upload_id"], name="Cities")
    assert created.status_code == 201, created.text
    assert datasets_env.fake.tools == [
        TOOL_INGEST_BEGIN,
        TOOL_INGEST_CHUNK,
        TOOL_INGEST_COMMIT,
    ]
    assert _csv_rows_arg(datasets_env)[0] == {"city": "Beijing", "pop": 21540000}


def test_upload_row_limit_rejected_400(datasets_env, monkeypatch) -> None:
    patch_dataset_settings(monkeypatch, dataset_max_rows=1)
    resp = upload_csv(datasets_env, CSV_SAMPLE)
    assert resp.status_code == 400
    assert resp.json()["detail"].startswith("quota:")
    session = get_session()
    try:
        assert session.query(Upload).count() == 0
    finally:
        session.close()


def test_upload_storage_quota_rejected_429(datasets_env, monkeypatch) -> None:
    patch_dataset_settings(monkeypatch, dataset_storage_limit_bytes=8)
    resp = upload_csv(datasets_env, CSV_SAMPLE)
    assert resp.status_code == 429
    assert resp.json()["detail"].startswith("quota:")


@pytest.mark.parametrize(
    "name,content,detail",
    [
        ("data.xls", "id\n1\n", "不支持的文件类型"),
        ("data.json", '{"a":1}', "不支持的文件类型"),
        ("data.csv", "id,id\n1,2\n", "重名列"),
        ("data.csv", "__secret,id\n1,2\n", "保留前缀"),
        ("data.csv", "", "上传文件为空"),
    ],
)
def test_upload_bad_inputs_400(datasets_env, name: str, content: str, detail: str) -> None:
    resp = upload_csv(datasets_env, content, filename=name)
    assert resp.status_code == 400, resp.text
    assert detail in resp.json()["detail"]


# ------------------------------------------------------------------ 建档


def test_create_from_csv_upload_ingests_engine_and_consumes(datasets_env) -> None:
    upload = upload_csv(datasets_env, CSV_SAMPLE).json()
    created = create_upload_dataset(
        datasets_env, upload["upload_id"], name="Sales 2026"
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["key"] == "sales_2026"
    assert body["source_kind"] == "upload"
    assert body["sync_status"] == "ok"
    assert body["row_count"] == 3
    assert body["columns"][0] == {"name": "id", "type": "INTEGER"}

    fake = datasets_env.fake
    assert fake.tools == [TOOL_INGEST_BEGIN, TOOL_INGEST_CHUNK, TOOL_INGEST_COMMIT]
    begin = fake.calls_for(TOOL_INGEST_BEGIN)[0]
    assert begin["dataset_key"] == "sales_2026"
    assert begin["pk_columns"] == []
    assert begin["row_count"] == 3
    assert begin["actor"] == "customer:cust-001"
    # 值按声明类型转换后进引擎
    assert _csv_rows_arg(datasets_env)[1] == {
        "id": 2,
        "amount": 20.75,
        "name": "beta",
        "note": None,
    }

    session = get_session()
    try:
        record = session.get(Upload, upload["upload_id"])
        assert record.consumed_at is not None
    finally:
        session.close()
    # 同一 upload 二次消费 → 409
    again = create_upload_dataset(datasets_env, upload["upload_id"])
    assert again.status_code == 409


def test_create_from_upload_chunks_at_2000(datasets_env) -> None:
    lines = ["id,value"] + [f"{i},{i * 2}" for i in range(1, 2002)]
    upload = upload_csv(datasets_env, "\n".join(lines) + "\n").json()
    assert upload["row_count"] == 2001
    created = create_upload_dataset(datasets_env, upload["upload_id"], name="Big")
    assert created.status_code == 201, created.text
    chunks = datasets_env.fake.calls_for(TOOL_INGEST_CHUNK)
    assert [len(c["rows"]) for c in chunks] == [2000, 1]
    assert [c["start_index"] for c in chunks] == [0, 2000]
    assert created.json()["row_count"] == 2001


def test_dataset_key_conflict_gets_suffix(datasets_env) -> None:
    first = upload_csv(datasets_env, "id\n1\n")
    second = upload_csv(datasets_env, "id\n2\n")
    a = create_upload_dataset(datasets_env, first.json()["upload_id"], name="Q1 Sales")
    b = create_upload_dataset(datasets_env, second.json()["upload_id"], name="Q1 Sales")
    assert a.json()["key"] == "q1_sales"
    assert b.json()["key"] == "q1_sales_2"


def test_upload_kind_requires_upload_id_and_ownership(datasets_env) -> None:
    assert (
        datasets_env.client.post(
            "/api/v1/datasets",
            headers=CUSTOMER_A,
            json={"name": "x", "source": {"kind": "upload"}},
        ).status_code
        == 400
    )
    upload = upload_csv(datasets_env, "id\n1\n", customer="cust-001").json()
    # 他企消费该 upload → 404
    resp = create_upload_dataset(
        datasets_env, upload["upload_id"], name="steal", customer="cust-002"
    )
    assert resp.status_code == 404
    # 不存在的 upload → 404
    assert (
        create_upload_dataset(datasets_env, "no-such-upload", name="ghost").status_code
        == 404
    )


def test_connector_dataset_creation_scoped_and_requires_source_fields(datasets_env) -> None:
    paired = pair_connector(datasets_env, customer="cust-002", name="b-conn")
    cross = datasets_env.client.post(
        "/api/v1/datasets",
        headers=CUSTOMER_A,
        json={
            "name": "cross",
            "source": {
                "kind": "connector",
                "connector_id": paired["connector_id"],
                "source_name": "src",
                "source_ref": "public.t",
            },
        },
    )
    assert cross.status_code == 404
    # 缺 source_ref（源内表/文件名）→ 400
    missing_ref = datasets_env.client.post(
        "/api/v1/datasets",
        headers=CUSTOMER_B,
        json={
            "name": "no-ref",
            "source": {
                "kind": "connector",
                "connector_id": paired["connector_id"],
                "source_name": "src",
            },
        },
    )
    assert missing_ref.status_code == 400
    # 缺 source_name（连接器本地源名）→ 400
    missing_name = datasets_env.client.post(
        "/api/v1/datasets",
        headers=CUSTOMER_B,
        json={
            "name": "no-name",
            "source": {
                "kind": "connector",
                "connector_id": paired["connector_id"],
                "source_ref": "public.t",
            },
        },
    )
    assert missing_name.status_code == 400


def test_missing_customer_header_401(datasets_env) -> None:
    assert datasets_env.client.get("/api/v1/datasets").status_code == 401
    assert (
        datasets_env.client.post(
            "/api/v1/datasets/uploads",
            files={"file": ("d.csv", b"id\n1\n", "text/csv")},
        ).status_code
        == 401
    )


def test_dataset_list_is_customer_scoped(datasets_env) -> None:
    upload = upload_csv(datasets_env, "id\n1\n").json()
    create_upload_dataset(datasets_env, upload["upload_id"], name="Mine")
    assert [d["key"] for d in datasets_env.client.get("/api/v1/datasets", headers=CUSTOMER_A).json()] == [
        "mine"
    ]
    assert datasets_env.client.get("/api/v1/datasets", headers=CUSTOMER_B).json() == []
    listed = datasets_env.client.get("/api/v1/datasets", headers=CUSTOMER_A).json()
    assert listed[0]["source_ref"] == "data.csv"
    # 列表卡片字段齐全（控制台列表页消费）
    assert {
        "id",
        "key",
        "name",
        "source_kind",
        "row_count",
        "size_bytes",
        "sync_status",
        "updated_at",
    } <= set(listed[0].keys())
    assert json.dumps(listed[0])  # JSON-safe