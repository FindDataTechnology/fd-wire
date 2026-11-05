## ADDED Requirements

### Requirement: 知识档位一等字段

实体与关系 SHALL 支持可选一等公民字段 `tier` 与 `sensitivity`，供知识升格链路（知验台 gold 回写）落档与下游消费：

- `tier` 取值词表为 `raw`/`bronze`/`silver`/`gold` 或 null（null=未入升格流水线），词表与 bench-platform 互斥四层对齐；
- `sensitivity` 取值词表为 `public`/`internal`/`confidential` 或 null；
- 两字段在实体 PUT 请求体中为增量可选字段（不带新键的既有请求行为逐字不变）；在关系更新面可写；在 EntityOut、RelationshipOut、GraphNodeOut、GraphEdgeOut 出参中恒出现（值为 null 时显式 null，与本体版本 manifest「null 与缺省不混用」口径一致）；
- 词表外值 SHALL 被拒绝（422 指明非法值与合法词表），存量数据不受影响；
- 存量迁移 SHALL 幂等回填：`column_notes` 中 `_bench` 元数据袋内已回写的 tier/sensitivity 标记解析升为一等字段；袋本身保留不删（连接器旧格式读法兼容）；
- 本体版本 canonical manifest SHALL 纳入两字段（每已知键恒出现），快照 digest 随之确定。

#### Scenario: 实体 PUT 带合法档位字段
- **WHEN** console 客户对实体发起 PUT 且请求体携带 `tier: "gold"`、`sensitivity: "confidential"`
- **THEN** 字段落库，出参回显同值，本体事件流记录该更新

#### Scenario: 词表外值被拒
- **WHEN** 任一写入路径携带 `tier: "diamond"` 或 `sensitivity: "secret"`
- **THEN** 返回 422 并指明非法值与合法词表，实体/关系存量不变

#### Scenario: v0 请求零行为变化
- **WHEN** 客户端发送不带 `tier`/`sensitivity` 键的实体 PUT 或关系声明请求
- **THEN** 行为与既有契约逐字一致，两字段出参为显式 null

#### Scenario: 存量袋标记幂等回填
- **WHEN** 迁移运行于含 `column_notes["_bench"]` 袋标记（`tier=gold; sensitivity=internal`）的存量实体
- **THEN** 一等字段就位同值；迁移重跑零新增变更；袋内容原样保留

#### Scenario: 版本快照纳入档位字段
- **WHEN** 对带 tier/sensitivity 的本体做版本快照与导出
- **THEN** canonical manifest 中两键恒出现，digest 为其内容的确定函数；回滚执行恢复两字段

### Requirement: 关系更新面

系统 SHALL 提供关系更新端点 `PUT /api/v1/entities/{id}/relationships/{rid}`：

- 可写白名单为 `label`、`tier`、`sensitivity`；
- 结构性字段（`from_entity_id`/`from_column`/`to_entity_id`/`to_column`/`kind`/`declared_kind`/junction 三键）SHALL 不可变——请求携带这些键或值变更 SHALL 被拒绝（422 指明改结构须删除+重声明）；
- 更新 SHALL 走与声明/删除同一条 console 鉴权与客户隔离路径，并写入本体变更事件流（update 事件）。

#### Scenario: 更新关系 label 与档位
- **WHEN** console 客户对其关系发起 PUT，携带 `label: "归属于"` 与合法 tier/sensitivity
- **THEN** 更新生效、出参回显，事件流出现该关系的 update 记录

#### Scenario: 结构字段变更被拒
- **WHEN** 请求体携带 `kind: "m:n"` 或任何两端/列/junction 键变更
- **THEN** 返回 422 并指明结构性字段不可变，关系原样

#### Scenario: 关系不存在或跨客户
- **WHEN** rid 不存在、不属于路径实体、或实体不属于请求客户
- **THEN** 返回 404（不泄露其他客户资源存在性）

### Requirement: 实体读面机器通道

系统 SHALL 提供实体图谱与列表的机器只读镜像端点（`/api/v1/internal/entities/graph` 与 `/api/v1/internal/entities`）供内部可信服务（知验台连接器）持续同步：

- 鉴权 SHALL 沿用内部令牌先例（`X-Internal-Token`，与 demands 内部端点同一 secret 来源），无机器写端点——写面只走 console 身份；
- 令牌 SHALL 绑定客户 scope（部署配置白名单）：请求显式携带客户键，scope 外客户 SHALL 返回 404 如实拒绝（不泄露存在性）；
- 响应形状 SHALL 与 console 图谱/列表端点一致（含 tier/sensitivity 出参），保证连接器切换通道时载荷零改写。

#### Scenario: 白名单内客户全量读取
- **WHEN** 机器请求携带有效 `X-Internal-Token` 且客户键在 scope 白名单内
- **THEN** 返回该客户的图谱与实体列表，字段形状与 console 面一致（含 tier/sensitivity）

#### Scenario: 令牌缺失或错误
- **WHEN** 请求无 `X-Internal-Token` 头或令牌值不符
- **THEN** 返回 401；服务端缺配置时 503 并报精确缺项（与既有内部端点口径一致）

#### Scenario: scope 外客户 404
- **WHEN** 机器请求携带白名单外客户键
- **THEN** 返回 404，不泄露该客户是否存在及其资源形状

#### Scenario: 机器面无写端点
- **WHEN** 对机器镜像面尝试任何写方法（POST/PUT/DELETE）
- **THEN** 无对应路由（404/405），实体写面仅 console 身份可达
