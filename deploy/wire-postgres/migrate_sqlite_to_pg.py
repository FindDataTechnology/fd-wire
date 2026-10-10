#!/usr/bin/env python3
"""SQLite → PostgreSQL 生产数据搬运（wire-dedicated-postgres cutover 工具）。

按白名单逐表复制（列名对齐、类型感知），逐表输出 src/dst 计数，任一不齐即非零退出
——「对账不过即止，不切 env」（deploy/wire-postgres/README.md 生产迁移手册）。

用法：
  python3 migrate_sqlite_to_pg.py --sqlite /path/fd_wire_platform.db \
      --pg "postgresql+psycopg://wire:***@100.64.0.12:5433/wire_platform" \
      --tables billing_customers,billing_plans,...

类型映射（读 PG information_schema 反推）：
  boolean      ← sqlite int 0/1 → False/True
  jsonb/json   ← sqlite TEXT → json.loads（空串跳过为 NULL）
  timestamp/*  ← 原样字符串（PG 赋值语境接受 'YYYY-MM-DD HH:MM:SS[.ffffff]'）
  其余         ← 原样传递
"""
import argparse
import json
import sqlite3
import sys

import psycopg


def pg_column_types(conn: psycopg.Connection, table: str) -> dict[str, str]:
    rows = conn.execute(
        "SELECT column_name, data_type FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name=%s",
        (table,),
    ).fetchall()
    if not rows:
        raise SystemExit(f"PG 目标表不存在: {table}")
    return {name: dtype for name, dtype in rows}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sqlite", required=True)
    ap.add_argument("--pg", required=True)
    ap.add_argument("--tables", required=True, help="逗号分隔白名单")
    args = ap.parse_args()

    lite = sqlite3.connect(args.sqlite)
    lite.row_factory = sqlite3.Row
    # 接受 SQLAlchemy 形态 URL（postgresql+psycopg://…），psycopg 原生只认 postgresql://
    dsn = args.pg.replace("postgresql+psycopg://", "postgresql://", 1)
    pg = psycopg.connect(dsn)
    failures: list[str] = []

    with pg.transaction():
        for table in [t.strip() for t in args.tables.split(",") if t.strip()]:
            cols = [r[1] for r in lite.execute(f"PRAGMA table_info({table})")]
            if not cols:
                raise SystemExit(f"SQLite 源表不存在: {table}")
            pg_types = pg_column_types(pg, table)
            missing = [c for c in cols if c not in pg_types]
            if missing:
                raise SystemExit(f"{table}: PG 缺列 {missing}")
            rows = [dict(r) for r in lite.execute(f"SELECT * FROM {table}")]
            src = len(rows)
            col_list = ",".join(f'"{c}"' for c in cols)
            # json/jsonb 列用显式 ::jsonb 转型（psycopg AUTO 占位符不吃 dict）
            ph = ",".join(
                f"%s::jsonb" if pg_types[c] in ("json", "jsonb") else "%s"
                for c in cols
            )
            for row in rows:
                vals = []
                for c in cols:
                    v = row[c]
                    dt = pg_types[c]
                    if dt == "boolean" and isinstance(v, int):
                        v = bool(v)
                    elif dt in ("json", "jsonb"):
                        v = v if isinstance(v, str) else json.dumps(v)
                        if v == "":
                            v = None
                    vals.append(v)
                pg.execute(f'INSERT INTO "{table}" ({col_list}) VALUES ({ph})', vals)
            dst = pg.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
            ok = "OK " if src == dst else "FAIL"
            if src != dst:
                failures.append(table)
            print(f"{ok} {table}: sqlite={src} pg={dst}")

    if failures:
        print(f"MISMATCH: {failures}", file=sys.stderr)
        return 1
    print("ALL TABLES RECONCILED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
