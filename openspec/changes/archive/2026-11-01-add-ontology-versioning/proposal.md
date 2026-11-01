## Why

本体（实体+关系）是客户域最核心的语义资产，但今天只有一个"当前态"：`entities`/`entity_relationships` 两表原地覆写——PUT 改主键列/注记无痕、DELETE 连流水都不留；没有版本号、没有快照、没有导出、没有回滚。唯一的历史是动作闸的声明流水（`domain_action_instances`），它只覆盖"经闸的建"，控制台直改与删除完全逃逸。结果是：客户拿不走自己的本体，也没法回答"这版和上版差了什么"、更没法回到过去。库级 pg_dump（每日、14 天）能救灾难，但给不了语义版本。

## What Changes

- **本体事件流（append-only）**：新增 `ontology_events`——每条变更一条事件（op=create/update/delete、target_kind=entity/relationship、target_id、before/after 全量 JSONB、actor、via=action_gate|console|rollback、舰队血缘 source_ref、source_instance_id）。写面收敛到 `entities/service.py` 单点事务内双写：控制台 CRUD、动作闸执行器、回滚执行器全部走同一收口。
- **版本快照 + 发布**：新增 `ontology_snapshots`——每客户单调版本号 + digest（规范 JSON sha256）+ 全量 manifest JSONB + trigger(daily|manual) + label + 创建人。日快照（每日 03:30 UTC，零变更静默跳过）；owner 可手动"打发布版"并附 label。同 digest 不重复落快照。
- **版本导出**：`GET /api/v1/ontology/export`——json/yaml、指定版本或当前、可选含出处（source_ref）。本体资产可被客户拿走、可被别的系统消费。
- **版本对比**：diff 引擎 + 读面——"当前 vs 最近快照"（未发布变更）与"任意两版对比"，实体/关系逐条 +1/-1/字段级改动，改动条目携带出处。
- **回滚**：对任一快照出 plan 预览（该建/该改/该删），owner 确认后经写面执行——每步落 `via=rollback` 事件，历史只增不减，回滚本身可再回滚。
- **控制台实体页版本区**：版本时间线、未发布变更计数、diff 视图入口、导出下载、打发布版按钮。
- **写面纪律（约定级）**：任何绕过 `entities/service.py` 的直改（裸 SQL）不进事件流——文档明写，仅限事故运维，恢复靠库级备份。

非目标：跨租户本体聚合（运营面全平台总览）、图谱探索大页、Git 仓导出/回灌同步（v2 再议）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `entity-layer`: 新增四条需求——本体变更事件流 / 版本快照与发布 / 版本导出 / 版本对比与回滚（存量读面零变化）。

## Impact

- **迁移**：一条 alembic（0049）新增两表 + 索引；无存量改写。存量本体在首个快照（日或手动）时归为基线 v1；事件流从本 change 上产时刻起记（**不虚构历史**）。
- **服务**：`entities/service.py` 单点收口（事件写入与本体写入同事务，事件写失败则整个事务失败）；新增 `entities/versioning.py`（digest/快照/diff/回滚 plan）；`entities/routes.py` 增版本读面与导出/快照/回滚端点；`app.py` lifespan 增日快照循环（沿 `start_materialization_scheduler` 既有模式，env 可关）。
- **前端**：`console/EntitiesPage.tsx` 加版本区 + `console/api.ts` 五个新客户端函数 + i18n 双语 + 测试；假后端（testing.ts）同步形状。
- **测试**：service 单点事件写入（含 PUT/DELETE/闸执行/回滚四条路径）、digest 稳定性（键序/日期/浮点）、快照版本单调与跳过、diff 语义、回滚 plan 与再回滚、导出两格式、跨企业隔离。
- **运维**：日快照与 pg_dump 同刻（03:30 UTC），心智一致；快照保留=全部手动版 + 最近 30 份日版（env 可配），事件永久（量小）。
- 无破坏性变更：对象面/图谱/AI 上下文/MCP 工具面全部零变化。
