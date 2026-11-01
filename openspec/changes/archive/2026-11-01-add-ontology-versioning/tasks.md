## 1. 数据层（alembic 0049）

- [x] 1.1 迁移 0049：`ontology_events`（id 自增、customer_id、seq 客户内顺序、op、target_kind、target_id、before/after JSON、actor、via、source_ref、source_instance_id、created_at；索引 (customer_id, seq)）
- [x] 1.2 迁移 0049：`ontology_snapshots`（id、customer_id、version、digest、manifest JSON、trigger、label、created_by、created_at；唯一 (customer_id, version)、索引 (customer_id, created_at)）
- [x] 1.3 双方言（SQLite/PG）自测：迁移可升降、索引生效

## 2. 事件流（写面收口）

- [x] 2.1 `entities/versioning.py`：canonical manifest + digest（键序/排序/日期/浮点规范化；同 digest 幂等）
- [x] 2.2 `entities/service.py` 单点收口：create/update/delete 实体与关系各路径在同一事务内追加事件（before/after 全量）
- [x] 2.3 动作闸执行器路径带入 source_ref 与 source_instance_id（内置 entity-declare / entity-relation-declare 两条）
- [x] 2.4 事件写失败使整个事务失败（无"本体变了没事件"窗口）——测试钉住
- [x] 2.5 事件无改删接口（端点集合断言）

## 3. 快照与发布

- [x] 3.1 快照创建服务：版本号单调（同客户 max+1）、manifest、digest、trigger/label/创建人；同 digest 不重复落
- [x] 3.2 日快照后台循环（lifespan 启动，沿 materialization scheduler 模式；`ONTOLOGY_SNAPSHOT_ENABLED`/`ONTOLOGY_SNAPSHOT_HOUR_UTC` 可配，默认 03:30 UTC）：当日无事件跳过；无本体客户跳过
- [x] 3.3 手动打发布版端点（owner 语义，label 校验 ≤80 字）
- [x] 3.4 日版保留清理（最近 30 份，env 可配；手动版永久）
- [x] 3.5 快照不改变当前态（纯读后落档）——测试断言

## 4. diff / 导出 / 回滚

- [x] 4.1 diff 引擎：两 manifest 对比 → 实体/关系逐条 add/remove/change（字段级 before→after）；支持 manifest↔当前态两种输入
- [x] 4.2 `GET /api/v1/ontology/versions`（列表）、`GET /api/v1/ontology/versions/{n}/diff?against=current|{n}`、`GET /api/v1/ontology/export`（version|current、json|yaml、provenance）——跨企业 404
- [x] 4.3 回滚：`POST /api/v1/ontology/versions/{n}/rollback/plan`（预览）+ `POST /api/v1/ontology/versions/{n}/rollback`（owner 确认执行；逐条经 service，落 via=rollback 事件；任一校验失败如实停）
- [x] 4.4 回滚可再回滚（append-only 下方向可逆）——测试
- [x] 4.5 完整性自检 `GET /api/v1/ontology/integrity`：重算当前态 digest 与事件折叠比对，报告逃逸写差异条目

## 5. 控制台（web）

- [x] 5.1 `console/api.ts` 五个客户端函数（版本列表/未发布计数/diff/导出/发布/回滚 plan+执行）
- [x] 5.2 `EntitiesPage` 版本区：时间线（版本号/digest 前 8/trigger/label/规模计数/时间）、未发布变更数、diff 入口、导出按钮、打发布版、回滚（owner）
- [x] 5.3 i18n 双语键齐（zh/en），测试假后端形状同步（testing.ts）
- [x] 5.4 组件测试：时间线渲染、空态、diff 三组、发布/回滚交互错误如实

## 6. 文档与收口

- [x] 6.1 文档：本体版本语义（进版=打快照；未发布变更=事件计数）、写面收敛纪律（禁裸 SQL）、导出格式 schema_version、恢复两条线（语义版本 vs pg_dump）
- [x] 6.2 红线/约定更新：`docs/` 与实体层 README 注明"绕过 service 的直改不进事件流"
- [x] 6.3 全量测试：api 全套 + web 全套 + 迁移双方言；`openspec validate add-ontology-versioning --strict` 绿
- [x] 6.4 出片上产（沿 paas-release 配方：净化快照→镜像→relay→ccr 实证→bump→rollout）
- [x] 6.5 真机验证：drillcust001 上打一版手动发布版 → 改一个实体 → 看未发布变更 1 → diff → 导出 json/yaml → 回滚到发布版 → 再打版 digest 一致；完整性自检 200 一致

## 7. 归档

- [ ] 7.1 `openspec archive add-ontology-versioning`（specs/entity-layer 入库）
