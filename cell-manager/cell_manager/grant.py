"""CellGrant：cell 授权束编排（add-customer-onboarding-automation 1.5/1.6）。

授权束三件套（CONTEXT.md「cell 授权」/ ADR 0005）同铸同收：

- 入口条目可见性（发现面）：group-restricted + 本客户合成组
- 专属 scope 文档（调用面）：server_access 精确名匹配自己 cell
- 客户 key 组快照：``["wire-customers", "wire-cust-<cid>"]``（铸 key 时固化）

流程（CLI 一条命令；design.md D2/D6）::

    grant <cid>       upsert scope + 重注册条目（带可见性，幂等覆写）
                      + 预检映射写入（CELL_PREFLIGHT_MAP_PATH 未配则跳过留痕）
    mint-key <cid>    §2.1 JWT-claims 通道铸客户 key（明文仅一次返回；
                      key_id 记入 cells.json 簿记供退租吊销）
    deprovision       吊销已记录 key（先行）→ 删 scope → 注销条目
                      → 生命周期 deprovision（保留期）；幂等可重跑
    purge             （既有流程）+ 删 scope（幂等兜底）

cancel-deprovision 恢复的是容器与卷；授权面不自动重铸——恢复后重跑
``grant``（+ 需要时 mint-key），审计可追。

预检映射写入（1.5）：registry caller-map admin API 属切片二（任务 3.1）；
未配置路径时 grant 明确跳过并在审计留痕（切片一验收走 registry 侧
env 覆盖层，行为不变——不引入直写 Mongo 的过渡凭据面）。
"""

from __future__ import annotations

from typing import Any

from cell_manager.audit import AuditLog
from cell_manager.config import CellManagerConfig, CustomerIdentity, validate_customer_id
from cell_manager.errors import CellManagerError, ConfigError
from cell_manager.keys import PatchKeyChannel, load_secret_key
from cell_manager.registry.base import RegistryClient, ScopeDoc, ServerEntry
from cell_manager.state import StateStore

#: cells.json 簿记里记录已铸 key 的字段（list[str]；只存 key_id，永不存明文）
KEY_IDS_FIELD = "customer_key_ids"


class CellGrant:
    """授权束编排面（依赖全注入：registry/config/audit/state/key 通道可替换）。"""

    def __init__(
        self,
        *,
        registry: RegistryClient,
        config: CellManagerConfig,
        audit_log: AuditLog | None = None,
        state_store: StateStore | None = None,
        key_channel: PatchKeyChannel | None = None,
    ) -> None:
        self._registry = registry
        self._config = config
        self._audit = audit_log or AuditLog(config.audit_log)
        self._state = state_store or StateStore(config.state_file)
        self._key_channel = key_channel

    # ---- 输入 ----

    def _identity(self, customer_id: str) -> CustomerIdentity:
        validate_customer_id(customer_id)
        identity = self._config.customer_identity_map.get(customer_id)
        if identity is None:
            raise ConfigError(
                f"no identity for customer {customer_id!r} in CELL_CUSTOMER_IDENTITY_MAP; "
                "add {username, sub2api_user_id} before grant/mint-key"
            )
        return identity

    def _key_channel_or_fail(self) -> PatchKeyChannel:
        if self._key_channel is not None:
            return self._key_channel
        if not self._config.registry_secret_key_file:
            raise ConfigError(
                "CELL_REGISTRY_SECRET_KEY_FILE not configured; "
                "customer-key minting unavailable (manual channel only)"
            )
        secret = load_secret_key(self._config.registry_secret_key_file)
        self._key_channel = PatchKeyChannel(self._config.registry_url, secret)
        return self._key_channel

    # ---- 授权束 ----

    def grant(self, customer_id: str) -> dict[str, Any]:
        """铸造授权束的 registry 半边（scope + 条目可见性 + 预检映射）；幂等。"""

        def _do() -> dict[str, Any]:
            identity = self._identity(customer_id)
            scope = ScopeDoc(
                scope_name=self._config.scope_name(customer_id),
                server=self._config.registry_path(customer_id),
                group=self._config.cell_group(customer_id),
            )
            self._registry.upsert_scope(scope)
            # 重注册带可见性（幂等覆写；provision 已带同款字段——此处兜存量条目，
            # 如 drillcust001）。target 同 config 派生，无漂移。
            self._registry.register(
                ServerEntry(
                    path=self._config.registry_path(customer_id),
                    target_url=self._config.target_url(customer_id),
                    display_name=f"柏讯 cell · {customer_id}",
                    visibility="group-restricted",
                    allowed_groups=(self._config.cell_group(customer_id),),
                )
            )
            detail: dict[str, Any] = {
                "scope": scope.scope_name,
                "group": scope.group,
                "visibility": "group-restricted",
            }
            detail["preflight_map"] = self._write_preflight_map(customer_id, identity)
            return detail

        return self._run("grant", customer_id, _do)

    def mint_customer_key(self, customer_id: str, *, name: str | None = None) -> dict[str, Any]:
        """铸客户 key；返回 ``{"key_id", "key"}``（key=明文，仅出现在返回值——
        **审计/簿记/日志只落 key_id**，明文由调用方立即一次性交付 0600/客户）。"""

        plaintext_box: dict[str, str] = {}

        def _do() -> dict[str, Any]:
            identity = self._identity(customer_id)
            channel = self._key_channel_or_fail()
            minted = channel.mint(
                sub=identity.username,
                groups=self._config.customer_key_groups(customer_id),
                name=name or f"{customer_id}-customer-track",
            )
            self._record_key_id(customer_id, minted["key_id"])
            plaintext_box["key"] = minted["key"]
            return {"key_id": minted["key_id"]}  # 审计 detail 到此为止，绝不含明文

        detail = self._run("mint-key", customer_id, _do)
        detail["key"] = plaintext_box["key"]
        return detail

    def revoke_customer_key(self, customer_id: str, key_id: str) -> dict[str, Any]:
        """吊销一把客户 key（owner 通道；404/409 均算幂等成功）。"""

        def _do() -> dict[str, Any]:
            identity = self._identity(customer_id)
            channel = self._key_channel_or_fail()
            outcome = channel.revoke(
                sub=identity.username,
                groups=self._config.customer_key_groups(customer_id),
                key_id=key_id,
            )
            self._forget_key_id(customer_id, key_id)
            return {"key_id": key_id, "outcome": outcome}

        return self._run("revoke-key", customer_id, _do)

    def revoke_all_customer_keys(self, customer_id: str) -> dict[str, Any]:
        """吊销簿记里该客户全部 key（退租第一步；无记录则显式 no-op）。"""

        def _do() -> dict[str, Any]:
            record = self._state.get(customer_id)
            key_ids = list((record or {}).get(KEY_IDS_FIELD) or [])
            results: list[dict[str, str]] = []
            for key_id in key_ids:
                results.append(
                    self.revoke_customer_key(customer_id, key_id)  # type: ignore[arg-type]
                )
            return {"revoked": results, "had_keys": len(key_ids)}

        return self._run("revoke-keys", customer_id, _do)

    def teardown_registry_face(self, customer_id: str) -> dict[str, Any]:
        """回收授权束的 registry 半边：删 scope → 注销条目（宽幂等）。"""

        def _do() -> dict[str, Any]:
            validate_customer_id(customer_id)
            scope_deleted = self._registry.delete_scope(self._config.scope_name(customer_id))
            unregistered = self._registry.unregister(self._config.registry_path(customer_id))
            return {"scope_deleted": scope_deleted, "registry_unregistered": unregistered}

        return self._run("teardown", customer_id, _do)

    # ---- 内部 ----

    def _write_preflight_map(
        self, customer_id: str, identity: CustomerIdentity
    ) -> dict[str, Any]:
        """预检映射写入（切片二 API 落地前可显式跳过，审计留痕不静默）。"""
        path = self._config.preflight_map_path
        if not path:
            return {
                "status": "skipped",
                "reason": "CELL_PREFLIGHT_MAP_PATH not configured (slice-2 registry API pending)",
            }
        # 切片二任务 3.1 交付后的正式通道（registry admin API，admin wgk- 鉴权
        # 由 self._registry 携带）。fake client 没有 PUT；http client 到时补方法。
        raise ConfigError(
            "preflight map write path configured but not yet implemented "
            "(slice-2 task 3.1); unset CELL_PREFLIGHT_MAP_PATH for now"
        )

    def _record_key_id(self, customer_id: str, key_id: str) -> None:
        record = self._state.get(customer_id)
        if record is None:
            # cell 未 provision 也允许先铸 key（开户顺序自由）；key_id 暂不落簿记，
            # 退租时按 CLI 传入或审计回查。返回不做静默丢失：审计已有 key_id。
            return
        ids = list(record.get(KEY_IDS_FIELD) or [])
        if key_id not in ids:
            ids.append(key_id)
        record[KEY_IDS_FIELD] = ids
        self._state.put(record)

    def _forget_key_id(self, customer_id: str, key_id: str) -> None:
        record = self._state.get(customer_id)
        if record is None:
            return
        ids = [k for k in (record.get(KEY_IDS_FIELD) or []) if k != key_id]
        record[KEY_IDS_FIELD] = ids
        self._state.put(record)

    def _run(self, action: str, customer_id: str, fn) -> dict[str, Any]:
        """执行并落审计（同 CellManager._run 纪律：ok/error 均留痕）。"""
        try:
            detail = fn()
        except CellManagerError as exc:
            self._audit.append(
                action=action,
                customer_id=str(customer_id),
                result="error",
                detail={"type": type(exc).__name__, "message": str(exc)},
            )
            raise
        self._audit.append(
            action=action, customer_id=str(customer_id), result="ok", detail=detail or None
        )
        return detail


def decommission(
    manager: "CellManager",  # noqa: F821 —— 循环导入避免：仅类型引用
    grant_face: CellGrant,
    customer_id: str,
) -> dict[str, Any]:
    """退租编排（design.md D6，任务 1.6）：吊销 key → 删 scope → 注销条目
    → 生命周期 deprovision（容器停、卷进保留期）。幂等可重跑：retention 态
    重复执行 = 再清一遍授权面（宽幂等）+ 返回现状；无宽限语义。

    key 吊销是 best-effort 前置（无记录/通道未配置 → 显式 warning 留痕，
    不阻断数据面回收——授权面此刻已由 scope 删除+条目注销关死）。
    """
    from cell_manager.errors import UnknownCellError
    from cell_manager.manager import ACTIVE, PAUSED

    status = manager.status(customer_id)
    if status.state not in (ACTIVE, PAUSED):
        if status.state == "not_found":
            raise UnknownCellError(
                f"no cell for customer {customer_id!r} (never provisioned or already purged)"
            )
        # retention 态重跑：授权面再清一遍（宽幂等），生命周期不动
        teardown = grant_face.teardown_registry_face(customer_id)
        return {
            "ok": True,
            "customer_id": customer_id,
            "state": status.state,
            "idempotent_rerun": True,
            "teardown": teardown,
            "warnings": [],
        }

    warnings: list[str] = []
    revoked: dict[str, Any] | None = None
    try:
        revoked = grant_face.revoke_all_customer_keys(customer_id)
        if not revoked.get("had_keys"):
            warnings.append("no recorded customer keys to revoke")
    except CellManagerError as exc:
        warnings.append(f"key revocation skipped: {exc}")

    teardown = grant_face.teardown_registry_face(customer_id)
    final = manager.deprovision(customer_id)
    # 合并生命周期状态字段（state/days_remaining/... 既有 CLI 契约）+ 编排细节
    payload = final.to_dict()
    payload.update(
        {
            "ok": True,
            "idempotent_rerun": False,
            "keys": revoked,
            "teardown": teardown,
            "warnings": warnings,
        }
    )
    return payload
