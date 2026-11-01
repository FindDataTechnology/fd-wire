## Context

本体当前态两表（`entities`/`entity_relationships`，EntitiesBase 库）+ 动作闸声明流水（`domain_action_instances`，元数据库）。写面三条：控制台 CRUD API、动作闸执行器（内置 entity-declare/entity-relation-declare）、以及运维手工（裸 SQL）。读面四条：控制台实体页（列表+详情+SVG 小图+流水面板）、对象实例浏览三端点、图谱端点（AI 上下文同源）、MCP 对象工具。备份：cheap3 每日 03:30 UTC pg_dump wire_platform，保留 14 天（库级恢复点）。

## Goals / Non-Goals

- Goals：本体有语义版本（v1/v2…）、有全量历史（含 PUT/DELETE）、能导出、能 diff、能回滚；所有新增机制不影响任何存量读面。
- Non-Goals：跨租户聚合读面；图谱探索大页；Git 仓双向同步；版本级权限（谁能看哪个版本）——沿客户域隔离一条线。

## Decisions

### D1 事件与本体同库同事务

`ontology_events` 落 EntitiesBase 库（与本体同库），事件写入与本体写入在同一事务——事件写失败则本体写失败。理由：跨库无法保证一致性，而"事件缺失"正是本 change 要消灭的缺陷形态；快照同理（`ontology_snapshots` 同库）。舰队血缘（source_ref/source_instance_id）在闸执行时从 instance 带入，控制台路径为 null。

备选否决：事件写元数据库（与闸 ledger 同库）——两库双写无分布式事务，失败窗口即产生"本体变了但没事件"。

### D2 闸 ledger 与事件流分工，不合并

动作闸 ledger 记"许可与提案"（谁提的、闸怎么判的、impact 文案），事件流记"变更事实"（before/after）。关联键：`ontology_events.source_instance_id` ← `domain_action_instances.id`。不合并的理由：事件流必须覆盖**不经闸**的写（控制台/回滚），而 ledger 的语义是"经闸才能写"——合并会让闸的语义被稀释，也让事件表被迫承担提案态。

### D3 回滚 = 再写一遍（append-only 不变式）

回滚到 vN 的算法：以当前状态与 vN manifest 求 plan（create/update/delete 三组）→ owner 确认 → 经 service 单点逐条执行，每条落 `via=rollback` 事件。禁止"直接覆盖表到快照态"——那会制造一段无事件的历史空洞，且回滚不可再回滚。plan 预览复用 diff 引擎（同一套比较逻辑，避免两套语义漂移）。

### D4 digest 规范化

digest = sha256(canonical JSON)：实体按 id 排序（缺失 id 时按 (name) 排序），关系按四元组排序，键序固定，日期 ISO8601（秒精度）、浮点按 JSON 序列化默认、null 与缺省不混用。同一 digest 不重复落快照（日任务静默跳过并记日志）。digest 同时作为导出物的完整性校验值。

### D5 日快照与 pg_dump 同刻，零变更跳过

日快照 03:30 UTC（与既有 pg_dump 同刻，运维心智一致）；当日无事件则不出快照（避免一串相同 digest 的噪声）。手动发布版随时可打，日任务遇同日已有手动版仍照出（语义不同：日版=时间线，手动版=发布决策）。

### D6 存量不虚构历史

启用时刻起记事件。存量本体由首个快照（日或手动）归入基线 v1——其 manifest 是"启用时刻的当前态"，不回溯声称"这些变更没发生过"。无本体的客户不出空快照（`version` 从 1 起且必须非空 manifest；空本体客户导出返回空 manifest 但不落快照）。

### D7 导出格式

manifest = `{schema_version, exported_at, customer_id, version | "current", digest, entities[], relationships[], provenance?}`。json 为规范形态；yaml 为同一文档的 YAML 序列化（`yaml.safe_dump`，键序固定）。provenance=true 时每条实体/关系附 `source_ref`（最近一次 create/update 事件的血缘行），默认关闭（导出物默认是数据，不是审计）。导出走 console 身份，跨企业 404。

### D8 权限与保留

版本读面/导出/打发布版/回滚全部沿 console 身份 + 客户域隔离；回滚额外要求 owner 语义（沿用控制台管理员判定，与动作闸 confirm 同口径）。保留：手动版永久；日版最近 30 份（env `ONTOLOGY_SNAPSHOT_DAILY_KEEP`，默认 30）；事件永久（本体变更量级小，无清理必要，留作完整审计）。

### D9 事件不是审计日志的替代

`ai_action_audit` 继续记"闸执行结果与耗时"；`ontology_events` 记"本体字段级前后态"。两者互相引用（audit→proposal→instance←event）但不互相替代。

### D10 写面收敛的可验证性

新增内部自检端点/脚本：`GET /api/v1/ontology/integrity`（只读）——重算当前态 digest 与"最近事件折叠结果"比对，不一致即报警（说明有绕过 service 的写）。这是"裸 SQL 逃逸"唯一的落地检测手段，也给运营面一个健康信号。

## Risks / Trade-offs

- **事件双写放大写路径**：每次本体写多一次 INSERT；本体变更量级小（声明级），可忽略。
- **裸 SQL 逃逸**：文档约束 + integrity 端点检测 + pg_dump 兜底；不追求 DB 层强制（触发器方案否决：无版本语义、PG/SQLite 双方言成本高）。
- **快照体积**：单客户本体全量 JSON，百级实体量级 KB~MB；30 份日版保留可控。
- **回滚误操作**：plan 预览 + owner 确认 + 回滚自身可再回滚（不会造成不可逆损伤）。
- **版本号语义歧义**："进一版"=打快照，不是"每次变更"；未发布变更由事件流计数呈现。展示层文案须明确。

## Migration Plan

1. alembic 0049：建 `ontology_events`、`ontology_snapshots`（索引：customer_id+seq、customer_id+version）。
2. 上产即生效：首个日快照（03:30 UTC）为存量本体出基线 v1；无存量回填、无数据迁移。
3. 回滚：删两表 + revert 代码；存量读面零依赖（版本机制纯增列）。

## Open Questions

- 跨租户运营面总览（G5）与图谱探索大页属后续 change，本 change 不占位。
- Git 仓导出（B 路线后半）若后续要做，以本 change 的 manifest 为唯一格式真源。
