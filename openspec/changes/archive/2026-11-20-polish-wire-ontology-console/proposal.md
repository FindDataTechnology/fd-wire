# Proposal: polish-wire-ontology-console

## Why

柏讯本体控制台（fd-wire web console：`EntitiesPage` 1420 行、`EntityObjectBrowser` 277 行、`OntologyVersionSection` 1076 行）平台面厚实，但从未按 impeccable 立过操作面规矩；且本体内容面当前 0 实体——空态、ACL 403 文案、动作闸确认面这些「低容量时刻」恰恰是用户最先撞上的界面。用户拍板「全量一次扫」：立 Operate surface brief 并对本体三组件全量打磨。同场战役：介绍站（finddata 根 change `add-bench-chain-website`）会把外部访客引向本模块。

## What Changes

- 立操作面 surface brief：`.impeccable/surfaces/wire-ontology-console.md`（Mode=Operate；Direction contract 承接 console 既有 shell/设计 token；Facts 禁编造清单）。
- 全量扫本体三组件 + 内嵌 `DomainActionsPanel`：逐组件 critique + audit 清单并打磨。
- 低容量时刻一等公民：空态（0 实体 = 真空态如实呈现 + 舰队提案引导）、ACL 403 文案（free-tier 闸与受限端点报因可读）、动作闸提案流（entity-declare / entity-relation-declare / 物化连接）风险等级与确认面清晰。
- 视觉一致性：与 `console-shell` 既有 token/排版对齐，不另起炉灶；响应式不破版。
- 有界验证纪律：每组件一次批量检视（桌面+移动）→ 一次批量修 → 至多一轮确认。
- **零契约变更**：`entity-layer` API、ACL 判序（404→403→ACL）、动作闸语义、版本化接口全部不动——打磨只在呈现层（组件/文案/样式）。

## Capabilities

### New Capabilities

- `ontology-console-surface-quality`: 本体控制台呈现质量治理——surface brief 管辖、三组件全量扫覆盖与验收、低容量时刻基线、有界验证纪律、零契约变更边界。

### Modified Capabilities

<!-- 无：entity-layer / console-shell / wire-domain-actions 等既有 spec 保持权威 -->

## Impact

- `web/src/console/EntitiesPage.tsx`、`EntityObjectBrowser.tsx`、`OntologyVersionSection.tsx`（呈现层打磨）。
- 相关样式/token 文件随组件微调。
- 不动 `api/fd_wire_api/entities/` 路由与 ACL 逻辑；不动 `console-shell`、`entity-layer` 契约。
- 验收产物：`.impeccable/surfaces/wire-ontology-console.md`、`.impeccable/review/` 截图、`reports/<date>-ontology-console-sweep.md`。
