# ontology-console-surface-quality Specification（delta）

## Purpose

柏讯本体控制台的呈现质量治理：一份 Operate surface brief 管辖本体三组件，全量扫拉齐基线，重点治理低容量时刻（空态/ACL 403/动作闸确认面）。边界铁律：零契约变更——`entity-layer` API、ACL 判序、动作闸语义全部不动。

## ADDED Requirements

### Requirement: Operate surface brief 管辖

本体控制台 SHALL 以 `.impeccable/surfaces/wire-ontology-console.md`（Mode=Operate）为呈现质量权威工件：Direction contract SHALL 承接 `console-shell` 既有设计 token 与排版（不另起炉灶），Facts 节 SHALL 声明呈现层边界（API、ACL 判序、动作闸语义不动）与可声明事实口径。组件打磨与后续呈现层改动 SHALL 以该 brief 为验收依据。

#### Scenario: brief 先行

- **WHEN** 任一本体组件开始本轮打磨
- **THEN** brief 已存在且该组件在管辖清单内（EntitiesPage、EntityObjectBrowser、OntologyVersionSection、内嵌 DomainActionsPanel）

#### Scenario: 边界声明可执行

- **WHEN** 打磨 diff 触碰 API 调用、ACL 判定或动作闸风险语义
- **THEN** 该 diff 出局（Facts 边界驳回），改动不越界

### Requirement: 全量扫覆盖与状态基线

本体三组件 + 内嵌 DomainActionsPanel SHALL 逐组件通过统一清单：loading/empty/error 三态齐全且可复用；空态如实（0 实体 = 真空态 + 舰队提案引导，不摆拍示例实体）；错误与 ACL 403 文案报因可读（free-tier 闸、受限端点、`404→403→ACL` 判序的对外呈现语义不变但文案须可理解）；视觉 token 与 `console-shell` 一致；窄屏不破版；加载骨架不闪跳。

#### Scenario: 组件验收逐个可计数

- **WHEN** 全量扫完成出验收报告
- **THEN** 报告按组件列出清单各项通过/修复状态，计数完整

#### Scenario: 空态即引导

- **WHEN** 实体库为 0 实体（当前内容面现状）
- **THEN** EntitiesPage 呈现真空态与「本体建设舰队提案」引导路径，不显示假实体示例

#### Scenario: ACL 拒绝可读

- **WHEN** 用户在受限端点数据集上触发物化/连接被 ACL 403 拦下
- **THEN** 呈现层给出可读的拒绝原因与下一步（不暴露判序细节，不显示裸 403）

### Requirement: 动作闸确认面清晰

实体声明（`entity-declare`）、关系声明（`entity-relation-declare`）、物化连接的动作闸入口 SHALL 在呈现层明示风险等级与「提案待确认」状态语义（对齐柏讯域动作契约的 propose/pending 对偶义务）；一键物化 SHALL 在执行前展示连接键与衍生数据集后果摘要。

#### Scenario: 提案状态不误导

- **WHEN** 舰队提案经 DomainActionsPanel 提交后处于 pending
- **THEN** 呈现状态为「待人工确认」，不显示为已生效

#### Scenario: 物化前后果可见

- **WHEN** 用户点击物化连接
- **THEN** 确认前可见连接键、junction 展开后果与衍生数据集缺省命名（实现口径：`{左实体名}×{右实体名} 连接`，重名冲突追加序号 `_2`/`_3`；成功名以 API 回传为准）摘要

### Requirement: 有界验证纪律与零契约变更

打磨 SHALL 遵循有界流程：每组件一次批量检视（桌面+移动截图，落 `.impeccable/review/`）→ 一次批量修复 → 至多一轮确认。本轮 SHALL NOT 改变 `entity-layer` API 契约、ACL 判定逻辑、动作闸风险分类或版本化接口；呈现层 diff SHALL 可通过「行为无关」复核。

#### Scenario: 行为无关复核

- **WHEN** 全量扫 diff 汇总复核
- **THEN** 无 API/ACL/动作闸语义变更；触碰即回退
