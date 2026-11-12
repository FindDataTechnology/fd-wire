# adopt-ontology-kernel-envelope

## Why

本体的机制（规范 JSON 与 digest、事件信封、写边界归名、封闭词表、只增不减的发布）
在三个面上各写了一遍：知验台（`src/bench`）、本仓（`entities/`）、协议库（YAML 词表）。
两套 digest 一旦在"同一内容"上判定不一致，跨面比对就失去意义；事件只有自增 id 时，
台账出了本库就无法说清"这是在说哪个实体"。

工作区已落地共享内核 `fd-ontology-kernel`（纯标准库、零传递依赖、轮询内 vendored），
知验台与协议库已完成换底。本 change 记录本仓这一侧的实现锚点变更，**不新增表、
不改对外接口、不改已发布的 digest**。

## What Changes

- 规范 JSON / digest 的**定义权**移到内核：`versioning.canonical_json` /
  `manifest_digest` / `canonical_manifest` 与条目归一改为委托内核（形状 1 =
  id 寻址）。换底前后对既有快照的 digest **逐字节一致**（六组 golden 钉住）。
- 事件信封补**语义键** `target_key`（新列 `0054`，nullable、零回填）：实体=实体名
  （客户内唯一），关系=`{from}->{kind}:{to}`（存储方向）。历史行留空，读侧由适配方
  从 `target_id` 反解——写当时的名字才算台账，事后反解只能得到今天的名字。
- 导出文档与版本列表补 `manifest_schema_version`（当前 1），与 `schema_version`
  （导出文档自身版本，当前 2）分属两个轴；老消费者忽略未知键即照旧解析。
- 新增符合性适配器与独立闸门入口（`api/ontology-adapter.json` +
  `api/scripts/ontology_gate.py`），并接入 CI 作业与工作区 pre-commit。

## Impact

- 受影响规格：`entity-layer`（事件流、版本快照与发布、版本导出三个要求）。
- 迁移：`0054_ontology_event_target_key`（加一列 nullable，零回填）、
  `0055_ontology_kernel_attrs`（加两列 nullable，承载内核 Unit 的附加属性如
  `aliases`）。两处都幂等，`alembic heads` 由 0053 前移。
- 回滚：两列均可 downgrade；代码回退后新列闲置，历史 digest 不受影响。
- 不做：不改本仓写入路径（`service.py` 仍是唯一收口）、不新建提案表、
  不改 `SCHEMA_VERSION`（导出文档版本）。
