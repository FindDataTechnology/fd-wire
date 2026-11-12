# Tasks — adopt-ontology-kernel-envelope

## 1. 摘要与归一交给内核

- [x] 1.1 `api/pyproject.toml` 增 `fd-ontology-kernel==0.1.0`（vendored wheel + `[tool.uv.sources]`），`api/vendor/` 带 wheel；验证：空 venv 里 `pip install --no-index --find-links api/vendor fd-ontology-kernel==0.1.0` 成功
- [x] 1.2 `entities/versioning.py` 的 `canonical_json` / `manifest_digest` / `canonical_manifest` / `normalize_entity` / `normalize_relationship` 改为委托内核（`SHAPE_ID_ADDRESSED`）；验证：换底前后六组 golden digest 逐字节相同（`tests/test_ontology_versioning.py::test_digest_matches_the_golden_values_from_before_the_kernel_swap`）

## 2. 事件信封补语义键

- [x] 2.1 迁移 `0054_ontology_event_target_key`（nullable、幂等、零回填）+ 模型列；验证：临时库里 `alembic upgrade head` 后 `target_key` 在位，`alembic downgrade 0053_cell_provision` exit 0 且该列消失（`0055` 的 `kernel_attrs` 同样可回退）
- [x] 2.2 `record_event` 就地推导 `target_key`（实体=名；关系=`{from}->{kind}:{to}`），拿不到名字时留空；删实体的级联顺序改为「先写关系事件、再删实体行」；验证：三条测试（语义键与 `target_id` 反解一致 / 改名不改历史 / 级联删也有键）

## 3. 形状版本进对外产物

- [x] 3.1 导出文档、`snapshot_summary`、`OntologyVersionOut` 增 `manifest_schema_version`；验证：导出与 `/api/v1/ontology/versions` 两条出口断言该键在位，其余键位不变

## 4. 端口与闸门

- [x] 4.1 `entities/kernel_ports.py` 实现五个端口（`entities`/`entity_relationships`、`ontology_events`、`ontology_snapshots`、固定枚举、`domain_action_instances` 只读投影）+ 迁移 `0055` 的 `kernel_attrs`；验证：`pytest -k "entity or ontology"` 全绿
- [x] 4.2 适配方 `fd_wire_api/conformance_adapter.py`（内存 SQLite 沙箱 + 真实端口，能力声明 `proposals=projection`、`distribution=absent`）与 `api/ontology-adapter.json` + `api/scripts/ontology_gate.py`；验证：`PASS: 11 check(s), 5 skipped`（exit 0），5 条 SKIP 各带具名依据
- [x] 4.3 CI 作业 `ontology-gate`（workflow_dispatch）+ 工作区 pre-commit 闸门；验证：注入「虚报可写提案」后 exit 1，还原后 exit 0
