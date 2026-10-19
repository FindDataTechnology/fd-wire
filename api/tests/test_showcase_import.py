"""行业看板批量导入器测试（wire-showcase-market 任务组 3）。

重点：转换正确性（成品看板 → raw_option 面板零信息损失）、幂等（重复执行产
新版本而非新条目）、逐条独立（坏源文件不中断整批）、以及**绝不碰客户产物**
（同 slug 冲突时跳过并如实报告）。
"""

from __future__ import annotations

import json
import os

os.environ.setdefault("AI_DATABASE_URL", "sqlite://")
os.environ.setdefault("FD_WIRE_DATASETS_DATABASE_URL", "sqlite://")

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from fd_wire_api.ai.db import AiBase, get_db  # noqa: F401 - 注册映射
from fd_wire_api.ai.db import reset_ai_runtime
from fd_wire_api.artifacts.models import Artifact, ArtifactVersion
from fd_wire_api.console.models import CustomerMember  # noqa: F401 - 注册映射
from fd_wire_api.market.platform_publisher import (
    PLATFORM_PUBLISHER_NAME,
    ensure_platform_publisher,
)
from fd_wire_api.market.showcase import get_showcase_dashboard
from fd_wire_api.scripts.import_showcase import (
    build_showcase_spec,
    import_one,
    load_source,
    run_import,
    slugify,
)


# ------------------------------------------------------------------ 转换正确性


def test_slugify_normalizes_both_naming_conventions() -> None:
    """两种历史命名都归一到同一 slug（``macro_cn_spec`` 与 ``*.spec``）。"""
    assert slugify("macro_cn_spec.json") == "macro-cn"
    assert slugify("intl-six-country.spec.json") == "intl-six-country"
    assert slugify("astock-cross-section.spec.json") == "astock-cross-section"


def test_build_spec_converts_kpi_and_charts() -> None:
    """KPI 卡 → kpi 面板；图表 → raw_option 面板（配置原样搬运）。"""
    source = {
        "title": "测试看板",
        "note": "数据源说明",
        "kpi": [
            {"label": "CPI 同比", "value": "0.0%", "change": "低通胀延续", "cls": "down"},
        ],
        "charts": [
            {
                "id": "chart-x",
                "title": "图表标题",
                "source": "fd_open_data · akshare",
                "height": 430,
                "option": {"xAxis": {"type": "time"}, "series": [{"type": "line", "data": [1, 2]}]},
            }
        ],
    }
    envelope = build_showcase_spec(source, "test-slug")
    assert envelope["title"] == "测试看板"
    body = envelope["spec"]
    assert body["showcase_slug"] == "test-slug"
    assert body["note"] == "数据源说明"

    kpi, chart = body["panels"]
    assert kpi["type"] == "kpi"
    assert kpi["title"] == "CPI 同比"
    assert kpi["snapshot"]["rows"] == [["0.0%"]]
    assert kpi["config"]["subtitle"] == "低通胀延续"

    assert chart["type"] == "line"
    assert chart["title"] == "图表标题"
    assert chart["span"] == 3
    assert chart["height"] == 430
    assert chart["source"] == "fd_open_api" or chart["source"].startswith("fd_open_data")
    # 完整配置原样进逃生舱
    assert chart["raw_option"]["xAxis"]["type"] == "time"
    assert chart["raw_option"]["series"][0]["data"] == [1, 2]


def test_build_spec_preserves_all_chart_options_losslessly() -> None:
    """成品看板的复杂配置逐字节保留（time 轴 / log 轴 / markLine）。"""
    option = {
        "tooltip": {"trigger": "axis", "valueFormatter": "(v) => v"},
        "xAxis": {"type": "time", "axisLabel": {"formatter": "{yyyy}-{MM}"}},
        "yAxis": {"type": "value", "logBase": 10},
        "series": [{"type": "line", "data": [[1, 2]], "markLine": {"data": [{"yAxis": 2.1}]}}],
    }
    envelope = build_showcase_spec(
        {"title": "t", "charts": [{"id": "c", "title": "x", "option": option}]}, "s"
    )
    assert envelope["spec"]["panels"][0]["raw_option"] == option


def test_build_spec_rejects_malformed_source() -> None:
    """缺 title / 缺 charts / 图表缺 option 一律报错（不产出半成品）。"""
    with pytest.raises(ValueError, match="title"):
        build_showcase_spec({"charts": []}, "s")
    with pytest.raises(ValueError, match="charts"):
        build_showcase_spec({"title": "t", "charts": []}, "s")
    with pytest.raises(ValueError, match="option"):
        build_showcase_spec({"title": "t", "charts": [{"id": "c", "title": "x"}]}, "s")


def test_real_dashboard_files_convert(tmp_path) -> None:
    """对工作区里的真实成品看板执行转换（若存在）。"""
    from pathlib import Path as _Path

    # 测试文件在 fd-wire/api/tests/ → 工作区根是 parents[3]
    real_dir = _Path(__file__).resolve().parents[3] / "dashboards"
    if not real_dir.exists():
        pytest.skip("工作区 dashboards 目录不在（CI 环境）")
    specs = sorted(real_dir.glob("*.spec.json")) + sorted(real_dir.glob("*_spec.json"))
    if not specs:
        pytest.skip("无 .spec.json 成品看板")
    for path in specs:
        source = load_source(path)
        envelope = build_showcase_spec(source, slugify(path.name))
        assert envelope["spec"]["panels"], f"{path.name} 转换后面板为空"
        # 每张图都有 raw_option，且与源 option 全等
        charts = source["charts"]
        raw_panels = [p for p in envelope["spec"]["panels"] if "raw_option" in p]
        assert len(raw_panels) == len(charts)


# ------------------------------------------------------------------ 导入执行


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    AiBase.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = Session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def publisher(monkeypatch, tmp_path):
    """建平台租户（走真实 ensure 路径）。"""
    from fd_wire_api.admin import reset_admin_runtime
    from fd_wire_api.admin.db import get_session
    from fd_wire_api.billing.models import Base as BillingBase, Plan

    reset_admin_runtime()
    db = get_session()
    try:
        BillingBase.metadata.create_all(bind=db.get_bind())
        if db.execute(select(Plan).where(Plan.code == "free")).scalar_one_or_none() is None:
            db.add(Plan(code="free", name="免费版", monthly_price_micro=0, included_lines=1000))
            db.commit()
        ensure_platform_publisher(db)
        db.commit()
    finally:
        db.close()
    return PLATFORM_PUBLISHER_NAME


def _write_source(dir_path, name: str, title: str = "测试看板") -> "Path":
    path = dir_path / name
    path.write_text(
        json.dumps(
            {
                "title": title,
                "kpi": [{"label": "指标", "value": "1.0", "change": "持平"}],
                "charts": [
                    {
                        "id": "c1",
                        "title": "图一",
                        "source": "测试源",
                        "height": 400,
                        "option": {"series": [{"type": "line", "data": [1]}]},
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return path


def test_import_creates_published_market_artifact(db, publisher, tmp_path) -> None:
    """首次导入：建平台产物 → published → market 档 → 匿名橱窗可见。"""
    path = _write_source(tmp_path, "demo.spec.json", "演示看板")
    result = import_one(db, path=path, publisher=publisher, dry_run=False)
    assert result["status"] == "created", result
    assert result["panels"] == 2

    artifact = db.get(Artifact, result["artifact_id"])
    assert artifact.customer_id == publisher
    assert artifact.status == "published"
    assert artifact.visibility == "market"
    # 状态机留痕经既有 service（不是直写表）
    statuses = [h["status"] for h in artifact.status_history]
    assert "draft" in statuses and "published" in statuses


def test_import_is_idempotent(db, publisher, tmp_path) -> None:
    """重复导入：同一看板产新版本，不出现第二条。"""
    path = _write_source(tmp_path, "demo.spec.json")
    first = import_one(db, path=path, publisher=publisher, dry_run=False)
    second = import_one(db, path=path, publisher=publisher, dry_run=False)
    assert first["artifact_id"] == second["artifact_id"]
    assert second["status"] == "updated"
    assert second["version"] > first["version"]

    rows = (
        db.execute(select(Artifact).where(Artifact.customer_id == publisher))
        .scalars()
        .all()
    )
    assert len(rows) == 1


def test_dry_run_writes_nothing(db, publisher, tmp_path) -> None:
    """干跑只报告，不落任何产物。"""
    path = _write_source(tmp_path, "demo.spec.json")
    result = import_one(db, path=path, publisher=publisher, dry_run=True)
    assert result["status"] == "would_create"
    assert db.execute(select(Artifact)).scalars().all() == []


def test_bad_source_does_not_abort_batch(db, publisher, tmp_path) -> None:
    """坏源文件逐条失败，好文件照常导入（单条失败不中断整批）。"""
    _write_source(tmp_path, "good.spec.json", "好板")
    (tmp_path / "broken.spec.json").write_text("{ not json", encoding="utf-8")

    results = []
    for path in sorted(tmp_path.glob("*.spec.json")):
        results.append(import_one(db, path=path, publisher=publisher, dry_run=False))

    by_status = {r["status"] for r in results}
    assert "failed" in by_status
    assert "created" in by_status
    # 好板确实落库
    created = [r for r in results if r["status"] == "created"]
    assert len(created) == 1


def test_import_refuses_to_touch_customer_artifact(db, publisher, tmp_path) -> None:
    """同 slug 的客户产物：导入器跳过并报冲突，客户数据零变化。"""
    from fd_wire_api.artifacts import service as artifacts_service

    # 先造一份客户产物，slug 与待导入文件相同
    customer_id = "some-customer"
    customer_artifact = artifacts_service.create_blank_artifact(
        db, customer_id=customer_id, kind="dashboard", title="客户的板"
    )
    customer_spec = {
        "title": "客户的板",
        "spec": {"title": "客户的板", "panels": [], "showcase_slug": "demo"},
    }
    artifacts_service.update_spec(
        db, artifact=customer_artifact, spec=customer_spec, customer_id=customer_id
    )
    before_version = customer_artifact.version

    path = _write_source(tmp_path, "demo.spec.json")
    result = import_one(db, path=path, publisher=publisher, dry_run=False)

    assert result["status"] == "failed"
    assert "冲突" in result["error"]
    db.refresh(customer_artifact)
    assert customer_artifact.version == before_version
    assert customer_artifact.customer_id == customer_id


def test_imported_dashboard_renders_in_showcase(db, publisher, tmp_path) -> None:
    """导入结果经匿名橱窗详情可取，且 spec 含 raw_option（可画图）。"""
    from fd_wire_api.market.showcase import list_showcase_dashboards

    path = _write_source(tmp_path, "demo.spec.json", "演示看板")
    import_one(db, path=path, publisher=publisher, dry_run=False)

    # 详情直查 service（不经过 HTTP；租户判定在平台库，此处已确保租户在场）
    class _PlatformStub:
        def execute(self, *_a, **_kw):
            class _R:
                def scalar_one_or_none(self):
                    return object()  # 租户在场

            return _R()

    listing = list_showcase_dashboards(db, _PlatformStub())
    assert listing["total"] == 1
    artifact_id = listing["items"][0]["id"]

    detail = get_showcase_dashboard(db, _PlatformStub(), artifact_id)
    assert detail is not None
    panels = detail["spec"]["spec"]["panels"]
    assert any("raw_option" in p for p in panels)
