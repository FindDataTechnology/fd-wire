"""CLI：``python -m cell_manager <action> <customer_id>``。

输出一律 JSON（stdout）——便于脚本化与后台集成；成功 exit 0、
失败 exit 1 且 stdout 为 ``{"ok": false, "error": {"type", "message"}}``。

用法示例（本机无 docker 的全生命周期演示）::

    export CELL_DRIVER=fake CELL_REGISTRY_MODE=fake
    export CELL_MANAGER_HOME=/tmp/cell-demo
    python -m cell_manager provision acme
    python -m cell_manager status acme
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Sequence

from cell_manager import __version__
from cell_manager.errors import CellManagerError

ACTIONS = (
    "provision",
    "pause",
    "resume",
    "deprovision",
    "cancel-deprovision",
    "status",
    "purge-expired",
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cell_manager",
        description="柏讯企业 cell 生命周期管理（容器 + 独立 SQLite WAL 卷 + registry 条目）",
    )
    parser.add_argument("--version", action="version", version=f"cell_manager {__version__}")
    parser.add_argument("action", choices=ACTIONS, help="生命周期操作")
    parser.add_argument("customer_id", nargs="?", help="企业客户标识（purge-expired 可省略）")
    return parser


def _dispatch(args: argparse.Namespace) -> dict[str, Any]:
    # 延迟 import：argparse 错误（--help/--version）不需要构造管理面
    from cell_manager import default_manager

    manager = default_manager()
    action = args.action
    if action == "purge-expired":
        purged = manager.purge_expired()
        return {
            "ok": True,
            "action": action,
            "purged": [cell.to_dict() for cell in purged],
        }
    if not args.customer_id:
        raise SystemExit(f"error: action {action!r} requires a customer_id")
    customer_id = args.customer_id
    if action == "provision":
        result: Any = manager.provision(customer_id)
    elif action == "pause":
        result = manager.pause(customer_id)
    elif action == "resume":
        result = manager.resume(customer_id)
    elif action == "deprovision":
        result = manager.deprovision(customer_id)
    elif action == "cancel-deprovision":
        result = manager.cancel_deprovision(customer_id)
    else:
        result = manager.status(customer_id)
    payload = result.to_dict()
    payload["ok"] = True
    payload["action"] = action
    return payload


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        payload = _dispatch(args)
    except CellManagerError as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "action": args.action,
                    "error": {"type": type(exc).__name__, "message": str(exc)},
                },
                ensure_ascii=False,
            )
        )
        return 1
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
