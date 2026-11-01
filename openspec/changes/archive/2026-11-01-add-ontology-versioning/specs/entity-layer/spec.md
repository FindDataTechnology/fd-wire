## ADDED Requirements

### Requirement: 本体变更事件流

系统 SHALL 为每一次本体变更（实体或关系的创建/更新/删除）追加一条不可变事件，落 `ontology_events`：字段 SHALL 含客户的顺序号、customer_id、op（create|update|delete）、target_kind（entity|relationship）、target_id、变更前全量（before，创建时为 null）、变更后全量（after，删除时为 null）、actor、via（action_gate|console|rollback）、舰队血缘（source_ref，经动作闸执行时原样带入；控制台路径为 null）、来源动作实例 id（经闸时）。事件写入 SHALL 与本体写入在同一数据库事务内——事件写入失败 SHALL 使整个变更失败（不产生"本体变了但没有事件"的窗口）。写面 SHALL 收敛到实体 service 单点：控制台 CRUD、动作闸执行器、回滚执行器三条路径 MUST 走同一收口。事件表 SHALL 只允许追加，系统 MUST NOT 提供修改或删除事件的接口。任一已声明实体/关系的变更 MUST NOT 逃逸事件流（绕过 service 的直改不在本要求保障范围，由运维纪律与完整性自检负责）。

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

### Requirement: 本体版本快照与发布

系统 SHALL 支持为本体打版本快照，落 `ontology_snapshots`：每客户版本号 SHALL 从 1 单调递增；每条快照 SHALL 含全量 manifest（entities[] + relationships[] 的当前态）、digest（规范 JSON 的 sha256）、trigger（daily|manual）、label（手动版可带）、创建人、时间。日快照 SHALL 在每日 03:30 UTC 由后台循环自动创建，当日无变更（无新事件）时 SHALL 静默跳过并不落快照；同 digest 的快照 SHALL NOT 重复创建。owner SHALL 可随时手动打发布版并附 label（同日已有日版仍照打）。快照 SHALL 不改变本体当前态（纯读后落档）。无本体的客户 SHALL NOT 产生快照。

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

### Requirement: 本体版本导出

系统 SHALL 提供本体导出口 `GET /api/v1/ontology/export`：支持 `version=<n>` 导出指定版本快照的 manifest、缺省导出当前态（`current`）；支持 `format=json|yaml`（缺省 json）；支持 `provenance=true` 时为每条实体/关系附最近一次变更的舰队血缘出处。导出文档 SHALL 含 `schema_version`、`exported_at`、`customer_id`、`version`（或 "current"）、`digest`、`entities[]`、`relationships[]`。导出 SHALL 沿 console 身份与客户域隔离（他企与不存在的版本一律 404）。导出 MUST NOT 触发任何本体写入或快照创建。

#### Scenario: 导出当前态

- **WHEN** 客户导出当前本体为 YAML
- **THEN** 下载内容为规范 YAML，含 schema_version 与 digest，实体/关系逐条完整

#### Scenario: 导出历史版本

- **WHEN** 客户导出 version=2
- **THEN** 内容为 v2 快照的 manifest 原样（digest 与快照记录一致）

#### Scenario: 带出处导出

- **WHEN** 客户以 provenance=true 导出
- **THEN** 每条实体/关系附 source_ref（无经闸血缘的条目该键缺席，不写空串）

#### Scenario: 隔离与真实空态

- **WHEN** 请求他企版本、不存在版本，或本企业尚无任何本体
- **THEN** 前两者 404 不泄露；后者 200 返回空 manifest（entities/relationships 空数组）

### Requirement: 本体版本对比与回滚

系统 SHALL 提供本体 diff：①「当前 vs 最近快照」（即未发布变更）与②「任意两版本对比」，输出 SHALL 为实体/关系的逐条增（+1）/删（-1）/改（字段级 before→after）三组，改动条目 SHALL 可携带出处（source_ref）。系统 SHALL 提供回滚：对指定版本生成 plan（创建/更新/删除三组动作），plan SHALL 在执行前可预览；执行 SHALL 仅限 owner 确认后触发，且 MUST 经与常规写同一的 service 收口逐条执行，每条落 `via=rollback` 事件。回滚 MUST NOT 以直接覆盖表的方式实现（历史不得出现无事件的空洞），回滚本身 SHALL 可被再次回滚。回滚执行前 SHALL 重新校验（业务名唯一、主键列 ⊆ 列快照、目标列 ∈ 目标实体主键集合等既有校验器），任一失败 SHALL 如实报错并停止（已执行部分留事件，可再回滚）。跨企业访问 SHALL 404。

#### Scenario: 未发布变更可见

- **WHEN** 最近快照后发生过 2 条变更（+1 实体、1 条关系改动）
- **THEN** diff（当前 vs 最近快照）如实列出两组改动，并给出未发布变更计数 2

#### Scenario: 版本对比

- **WHEN** 客户对比 v2 与 v3
- **THEN** 返回逐条 +/-/改，字段级给出 before→after

#### Scenario: 回滚 plan 与执行

- **WHEN** owner 对 v2 生成回滚 plan 并确认执行
- **THEN** plan 预览先展示将创建/更新/删除的条目；执行后每条变更落 via=rollback 事件，当前态与 v2 manifest 等价（新快照 digest 与 v2 一致）

#### Scenario: 回滚校验失败如实停

- **WHEN** 回滚 plan 中某条更新因列快照漂移不可执行
- **THEN** 执行在该条如实报错并停止，已执行部分留事件，客户端可再次回滚修正

#### Scenario: 回滚再回滚

- **WHEN** 回滚执行后 owner 对回滚前版本再发起回滚
- **THEN** 允许执行（append-only 不变式下历史完整，回滚方向可逆）

### Requirement: 本体版本读面与控制台展示

console 身份 SHALL 提供版本读面：版本列表（版本号、digest、trigger、label、时间、规模计数）、未发布变更计数、diff 结果、完整性自检（当前态折叠 digest 与最近事件一致性）。控制台实体页 SHALL 展示版本区：版本时间线、未发布变更数、diff 入口、导出入口、打发布版入口、回滚入口（owner 可见）。任何新增读面 SHALL 沿客户域隔离且 MUST NOT 改变既有对象面/图谱/AI 上下文读面的响应形状。

#### Scenario: 版本时间线

- **WHEN** 客户打开控制台实体页
- **THEN** 版本区按时间倒序列出版本（含 digest 前 8 位与实体/关系计数），并展示未发布变更数

#### Scenario: 完整性自检发现逃逸写

- **WHEN** 本体曾被人以裸 SQL 直改（绕过 service，无事件）
- **THEN** 完整性自检报告当前态与事件折叠结果不一致，并指出差异条目

#### Scenario: 存量读面零变化

- **WHEN** 版本机制上产后调用实体列表/对象三端点/图谱端点
- **THEN** 响应形状与此前逐字节一致（新能力不渗入旧响应）
