## MODIFIED Requirements

### Requirement: 本体变更事件流

系统 SHALL 为每一次本体变更（实体或关系的创建/更新/删除）追加一条不可变事件，落 `ontology_events`：字段 SHALL 含客户的顺序号、customer_id、op（create|update|delete）、target_kind（entity|relationship）、target_id、target_key（语义键，见下）、变更前全量（before，创建时为 null）、变更后全量（after，删除时为 null）、actor、via（action_gate|console|rollback）、舰队血缘（source_ref，经动作闸执行时原样带入；控制台路径为 null）、来源动作实例 id（经闸时）。`target_key` SHALL 在写入时按**当时的**名字推导：实体为实体名（客户内唯一，`uq_entities_customer_name`），关系为 `{from_entity_name}->{kind}:{to_entity_name}`（存储方向；声明方向留在 `declared_kind`）。推导不出时 SHALL 留 null，MUST NOT 写入一个事后反解不出来的字符串。换底前的历史行 `target_key` SHALL 保持 null 且 MUST NOT 回填——事后反解只能得到今天的名字，写进历史行会让台账撒谎；读侧由适配器从 `target_id` 反解。事件写入 SHALL 与本体写入在同一数据库事务内——事件写入失败 SHALL 使整个变更失败（不产生"本体变了但没有事件"的窗口）。写面 SHALL 收敛到实体 service 单点：控制台 CRUD、动作闸执行器、回滚执行器三条路径 MUST 走同一收口。事件表 SHALL 只允许追加，系统 MUST NOT 提供修改或删除事件的接口。任一已声明实体/关系的变更 MUST NOT 逃逸事件流（绕过 service 的直改不在本要求保障范围，由运维纪律与完整性自检负责）。

#### Scenario: 控制台改实体留事件

- **WHEN** 客户在控制台把实体「订单」的显示列从 order_id 改为 order_no
- **THEN** 落一条 op=update、via=console 的事件，before 含旧显示列、after 含新显示列，其余字段完整

#### Scenario: 删除留事件

- **WHEN** 客户删除一条关系
- **THEN** 落一条 op=delete、target_kind=relationship 的事件，after 为 null、before 为该关系的全量字段

#### Scenario: 经闸声明带血缘

- **WHEN** 舰队岗位提议的实体声明经 owner 确认执行成功
- **THEN** 对应事件 via=action_gate，source_ref 与 source_instance_id 与动作实例一致

#### Scenario: 事件写失败整体失败

- **WHEN** 本体写入过程中事件插入失败（如事件表不可写）
- **THEN** 整个事务回滚，本体保持变更前状态，接口如实返回错误

#### Scenario: 无改事件接口

- **WHEN** 检查本体版本相关端点集合
- **THEN** 不存在任何修改或删除已有事件的端点（只读与追加）

#### Scenario: 语义键写当时的名字

- **WHEN** 客户新建实体「订单」，随后把实体改名为「订单主表」
- **THEN** 创建事件的 target_key 为「订单」且保持不变，改名事件的 target_key 为「订单主表」；两条事件共存，各说各的当时

#### Scenario: 级联删除也拿得到语义键

- **WHEN** 客户删除实体「订单」，其名下有一条到「客户」的关系
- **THEN** 关系删除事件的 target_key 为「订单->n:1:客户」，实体删除事件的 target_key 为「订单」

#### Scenario: 历史行不回填

- **WHEN** 查询换底前写入的事件
- **THEN** 其 target_key 为 null，且适配器能从 target_id 反解出同一个对象（反解结果不写回库）

### Requirement: 本体版本快照与发布

系统 SHALL 支持为本体打版本快照，落 `ontology_snapshots`：每客户版本号 SHALL 从 1 单调递增；每条快照 SHALL 含全量 manifest（entities[] + relationships[] 的当前态）、digest（规范 JSON 的 sha256）、trigger（daily|manual）、label（手动版可带）、创建人、时间。manifest 的规范形态（条目键集、排序键、类型归一）与 digest 配方 SHALL 由共享内核持有（形状 1 = id 寻址），本仓 MUST NOT 再有一份自己的实现——两套实现一旦对"同一内容"判定不一致，跨面比对就失去意义。快照摘要与导出物 SHALL 带 `manifest_schema_version`（当前为 1），它与 `schema_version`（导出文档自身版本）分属两个轴，MUST NOT 混用。日快照 SHALL 在每日 03:30 UTC 由后台循环自动创建，当日无变更（无新事件）时 SHALL 静默跳过并不落快照；同 digest 的快照 SHALL NOT 重复创建。owner SHALL 可随时手动打发布版并附 label（同日已有日版仍照打）。快照 SHALL 不改变本体当前态（纯读后落档）。无本体的客户 SHALL NOT 产生快照。

#### Scenario: 日快照静默跳过

- **WHEN** 某客户近 24 小时无本体变更，日快照任务到点
- **THEN** 不创建快照、不增版本号，记一条跳过日志

#### Scenario: 手动发布版

- **WHEN** owner 打发布版并填 label「冒烟本体定稿」
- **THEN** 落一条 trigger=manual 的快照，版本号 +1，label 原样保存，响应返回版本号与 digest

#### Scenario: 同 digest 不重复

- **WHEN** 手动打发布版时当前态与最近快照 digest 相同
- **THEN** 不新增快照，响应如实说明「与 vN 内容一致」，版本号不变

#### Scenario: 首版即基线

- **WHEN** 系统性启用版本机制后首次打快照（日或手动），客户此前已有存量本体
- **THEN** 该快照版本号为 1，manifest 为该时刻当前态；系统 MUST NOT 虚构启用前的历史事件

#### Scenario: 无本体不出快照

- **WHEN** 客户没有任何实体与关系
- **THEN** 日任务不为该客户落快照

#### Scenario: 换底不改已发布 digest

- **WHEN** 对换底前落库的任一快照按 manifest 重算 digest
- **THEN** 重算值与库中 digest 逐字节相等（等价测试钉住六组样本；生产逐行核对由只读脚本 `scripts/check_ontology_digests.py` 执行，空库时报「无样本，未验证」而不是通过）

### Requirement: 本体版本导出

系统 SHALL 提供本体导出口 `GET /api/v1/ontology/export`：支持 `version=<n>` 导出指定版本快照的 manifest、缺省导出当前态（`current`）；支持 `format=json|yaml`（缺省 json）；支持 `provenance=true` 时为每条实体/关系附最近一次变更的舰队血缘出处。导出文档 SHALL 含 `schema_version`、`manifest_schema_version`、`exported_at`、`customer_id`、`version`（或 "current"）、`digest`、`entities[]`、`relationships[]`。新增的 `manifest_schema_version` SHALL 只增不改既有键位：不认识它的老消费者按未知键忽略即照旧解析。导出 SHALL 沿 console 身份与客户域隔离（他企与不存在的版本一律 404）。导出 MUST NOT 触发任何本体写入或快照创建。

#### Scenario: 导出当前态

- **WHEN** 客户导出当前本体为 YAML
- **THEN** 下载内容为规范 YAML，含 schema_version、manifest_schema_version 与 digest，实体/关系逐条完整

#### Scenario: 导出历史版本

- **WHEN** 客户导出 version=2
- **THEN** 内容为 v2 快照的 manifest 原样（digest 与快照记录一致）

#### Scenario: 带出处导出

- **WHEN** 客户以 provenance=true 导出
- **THEN** 每条实体/关系附 source_ref（无经闸血缘的条目该键缺席，不写空串）

#### Scenario: 隔离与真实空态

- **WHEN** 请求他企版本、不存在版本，或本企业尚无任何本体
- **THEN** 前两者 404 不泄露；后者 200 返回空 manifest（entities/relationships 空数组）

#### Scenario: 老消费者照旧解析

- **WHEN** 只认识 `schema_version` 的消费者读到新导出文档
- **THEN** 它忽略 `manifest_schema_version` 仍能解析 entities/relationships，且 digest 校验照旧通过
