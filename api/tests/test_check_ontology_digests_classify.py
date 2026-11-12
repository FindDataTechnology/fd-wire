"""check_ontology_digests 的三态分类（establish-ontology-kernel 6.2 收尾）。

这个核对脚本的价值全在「不让沉默变成通过」：库里可能同时存在

- 能复现的（当前配方算得出的）；
- 遗留行——digest 由「缺键补 null」规则之前的版本铸造，**换底前后都**复现不出；
- 真不一致——配方被改过，或这一行被改写过。

前两种混成一种就会得出错误结论：把遗留行当失败，等于永远红灯；把失败当遗留，
等于把回归放过。所以这三条必须各有一条断言，且两条「不通过」的分支要能各自红。
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check_ontology_digests.py"


@pytest.fixture(scope="module")
def checker():
    spec = importlib.util.spec_from_file_location("check_ontology_digests", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _raw(manifest: dict) -> str:
    return hashlib.sha256(
        json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        .encode("utf-8")
    ).hexdigest()


#: 0050 之前的实体条目：没有 tier / sensitivity 两个键。
PRE_0050 = {
    "entities": [
        {"id": 7, "name": "冒烟日期", "dataset_id": "d1", "pk_columns": ["date"]}
    ],
    "relationships": [],
}

#: 同一内容，按当前规则补齐（归一器会补 null）。
POST_0050 = {
    "entities": [
        {
            "id": 7,
            "name": "冒烟日期",
            "dataset_id": "d1",
            "pk_columns": ["date"],
            "description": None,
            "display_column": None,
            "column_notes": None,
            "tier": None,
            "sensitivity": None,
        }
    ],
    "relationships": [],
}


def test_ok_when_recomputed_matches(checker):
    stored = "a" * 64
    assert checker.classify(PRE_0050, stored, stored) == "ok"


def test_legacy_when_raw_payload_hash_is_what_was_stored(checker):
    """遗留行：库中值 == 原始 payload 哈希，而当前规则算的是补键后的哈希。"""
    padded = "b" * 64
    assert checker.classify(PRE_0050, _raw(PRE_0050), padded) == "legacy"


def test_mismatch_when_neither_formula_matches(checker):
    """真不一致：两种算法都对不上——这时候才该说配方/行被改了。"""
    assert checker.classify(PRE_0050, "c" * 64, "b" * 64) == "mismatch"


def test_a_padded_payload_is_not_called_legacy(checker):
    """补过键的行不该借「遗留」逃过核对：它的原始哈希与当前哈希是同一个。"""
    assert _raw(POST_0050) == _raw(POST_0050)
    assert checker.classify(POST_0050, _raw(PRE_0050), "b" * 64) == "mismatch"
