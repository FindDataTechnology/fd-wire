#!/usr/bin/env python3
"""只读核对：库里每一份本体快照的 ``digest`` 是否等于按 manifest 重算的值。

**为什么需要它**：``ontology_snapshots.digest`` 是导出物完整性校验值，消费方按
它判断「这份 manifest 与发布时一致」。换底把 digest 交给内核算
（establish-ontology-kernel 6.2），换完必须对**库里已有的每一行**重算一遍——
本地开发库通常是 0 行，那就等于没验证过；只有对着真有数据的库跑，才知道
换底有没有在历史版本上悄悄改了 digest。

**只读**：只 SELECT，不建表、不写行、不碰 alembic。

用法::

    DATABASE_URL=postgresql+psycopg://... python scripts/check_ontology_digests.py
    python scripts/check_ontology_digests.py --database sqlite:///./fd_wire_entities.db
    python scripts/check_ontology_digests.py --limit 50

退出码：``0`` 全部相等（或库里没有快照——会明确说「没有样本，本次未验证」），
``1`` 有不相等的行，``2`` 跑不起来（连不上库/表不存在/参数错）。

输出形态：每条不一致一行 ``<customer> · v<version> · 事实 · 修法：...``，最后一行
汇总。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session


def classify(manifest, stored: str, recomputed: str) -> str:
    """``ok`` / ``legacy`` / ``mismatch``——三态，别把前两种混成一种。

    ``legacy``：这行的 digest 是**补键规则之前**铸造的。0050 给实体/关系加了
    ``tier``/``sensitivity``，归一器从此按「缺键 → null」补齐（design D5），于是
    对 0050 之前的快照，「先归一再哈希」必然复现不出当年那个值。判据是**原始
    payload 直接哈希**是否等于库中值：等于就说明当年正是按原始 payload 铸的。

    这类行在换底前后**都**对不上（旧 ``normalize_entity`` 同样补这两个键），所以
    它既不是回归、也改代码救不了；更**不能**改库里的 digest——消费方已按它校验过
    导出物。只能单独报出来，由人决定处置（见 ``--allow-legacy``）。

    ``mismatch``：原始 payload 也对不上。这才是真问题：配方被改过，或这一行被改写过。
    """
    if recomputed == stored:
        return "ok"
    raw = hashlib.sha256(
        json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        .encode("utf-8")
    ).hexdigest()
    return "legacy" if raw == stored else "mismatch"


def _engine(database: str | None):
    from fd_wire_api.config import normalize_database_url

    url = database or os.getenv("FD_WIRE_DATABASE_URL") or os.getenv(
        "FD_WIRE_ENTITIES_DATABASE_URL"
    )
    if not url:
        print(
            "快照核对 · 参数 · 没有数据库连接串 · "
            "修法：传 --database 或设 DATABASE_URL / FD_WIRE_DATABASE_URL",
            file=sys.stderr,
        )
        raise SystemExit(2)
    return create_engine(normalize_database_url(url), future=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="check_ontology_digests",
        description="Recompute every ontology snapshot digest and compare with the stored value.",
    )
    parser.add_argument("--database", default=None,
                        help="database URL (default: DATABASE_URL / FD_WIRE_DATABASE_URL)")
    parser.add_argument("--limit", type=int, default=0,
                        help="stop after N rows (0 = all)")
    parser.add_argument(
        "--allow-legacy",
        action="store_true",
        help="把「补键规则之前铸造的 digest」记为已知遗留、不因此判失败（仍逐行打印）",
    )
    args = parser.parse_args(argv)

    engine = _engine(args.database)
    try:
        # 先导 app：datasets 包在 import 期有循环引用（entities → datasets → ai →
        # materialization → datasets.ingest），单独导 fd_wire_api.entities 会炸在
        # 「partially initialized module」上。测试套件同样是先导 app 才成立。
        import fd_wire_api.app  # noqa: F401  仅为打平导入顺序
        from fd_wire_api.entities import versioning
        from fd_wire_api.entities.models import OntologySnapshot
    except Exception as exc:  # noqa: BLE001 - 环境问题必须说清楚，别抛栈给运维
        print(
            f"快照核对 · 导入 · {type(exc).__name__}: {exc} · "
            f"修法：在 api/ 目录下用本仓 venv 运行（缺依赖或包路径不对）",
            file=sys.stderr,
        )
        return 2

    checked = 0
    mismatches: list[tuple[str, int, str, str]] = []
    legacy: list[tuple[str, int, str, str]] = []
    try:
        with Session(engine) as session:
            stmt = select(OntologySnapshot).order_by(
                OntologySnapshot.customer_id, OntologySnapshot.version
            )
            if args.limit:
                stmt = stmt.limit(args.limit)
            for snapshot in session.scalars(stmt).all():
                manifest = snapshot.manifest_json or {}
                recomputed = versioning.manifest_digest(manifest)
                checked += 1
                verdict = classify(manifest, snapshot.digest, recomputed)
                row = (snapshot.customer_id, snapshot.version, snapshot.digest, recomputed)
                if verdict == "legacy":
                    legacy.append(row)
                elif verdict == "mismatch":
                    mismatches.append(row)
    except Exception as exc:  # noqa: BLE001
        print(
            f"快照核对 · 连接/查询 · {type(exc).__name__}: {exc} · "
            f"修法：确认库可达且已跑过 alembic（ontology_snapshots 表存在）",
            file=sys.stderr,
        )
        return 2

    for customer, version, stored, recomputed in legacy:
        print(
            f"{customer} · v{version} · LEGACY · 库中 digest={stored} 重算={recomputed} · "
            f"该行 digest 由「缺键补 null」规则之前的版本铸造（原始 payload 哈希才等于库中值）"
        )

    for customer, version, stored, recomputed in mismatches:
        print(
            f"{customer} · v{version} · 库中 digest={stored} 重算={recomputed} · "
            f"修法：先确认换底是否改了归一/序列化配方（golden 测试应拦下）；"
            f"**不要**改库里的 digest，那会作废消费方已校验过的导出物"
        )

    if mismatches:
        print(f"\nFAILED: {len(mismatches)}/{checked} 份快照 digest 不一致"
              + (f"（另有 {len(legacy)} 份遗留行）" if legacy else ""))
        return 1

    if legacy and not args.allow_legacy:
        # 遗留行不是「验过」——不传 --allow-legacy 就仍然算没通过，别让沉默变成通过。
        print(
            f"\nLEGACY: {len(legacy)}/{checked} 份快照的 digest 由补键规则之前铸造，当前规则下不可复现；"
            f"确认后加 --allow-legacy 才算通过"
        )
        return 1

    if legacy:
        print(f"（其中 {len(legacy)} 份为已知遗留，已由 --allow-legacy 放行）")

    if checked == 0:
        # 「没有样本」不等于「验证通过」——这两种结果必须长得不一样。
        print("NO SAMPLES: ontology_snapshots 里没有行，本次未验证任何历史 digest")
        return 0

    print(f"PASS: {checked} 份快照 digest 全部与重算值相等")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
