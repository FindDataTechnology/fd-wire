# Design: polish-wire-ontology-console

## Context

本体控制台是 fd-wire web console（React + TS）内的三个大组件：`EntitiesPage.tsx`（1420 行：实体卡/创建表单/关系管理/一键物化/SVG 迷你图/内嵌 DomainActionsPanel）、`EntityObjectBrowser.tsx`（277 行：对象/行/关系浏览）、`OntologyVersionSection.tsx`（1076 行：版本/diff/回滚/完整性）。内容面现状 0 实体——空态与低容量时刻是用户（和介绍站访客）最先撞上的界面。

## Goals / Non-Goals

- Goals：brief 立面；三组件全量过清单；低容量时刻（空态/403 文案/动作闸确认）一等公民；验收可计数。
- Non-Goals：不重构成组件库；不动 API/ACL/动作闸语义；不做本体内容面建设（那是 `add-ontology-template-and-workspaces` 之后的运营线）；不碰 console 其他页（本轮只管辖本体面）。

## Decisions

### D1. 打磨单位 = 组件，四件并发分片
EntitiesPage 体量大（1420 行），内嵌 DomainActionsPanel 随主组件一个分片；EntityObjectBrowser、OntologyVersionSection 各一分片——三个子代理可并发（AGENTS.md 并行偏好）。

### D2. 空态组件化，一次写三处复用
0 实体空态做成可复用组件：真空态插画级留白 + 两条引导（舰队提案流程说明 / 手动创建入口）。EntitiesPage、ObjectBrowser、VersionSection 的各自空数据态复用同一底座。

### D3. 403 文案分层
ACL 拒绝呈现按原因分型：free-tier 闸（403 tier gate）、受限端点数据集 NEED_WRITE、对象读路径拒绝。文案模板落 brief，呈现层只做映射显示，不重判 ACL——判序仍由 API 层权威。

### D4. 动作闸呈现对齐柏讯域动作契约
DomainActionsPanel 的提案状态语义（propose 即时 pending = 对偶义务）在 UI 上明示「待人工确认」；一键物化加后果摘要卡（连接键、junction 展开、衍生数据集缺省命名（实现口径：{左}×{右} 连接，冲突追加序号））。只改呈现映射，不碰 `wire-tool-risk.js` 与 action gate。

### D5. SVG 迷你图与版本 diff 的可读性
迷你图（circular layout）在空图/单实体/多实体三档各有合理呈现；版本 diff 高亮配色纳入 console token，不新造色板。

## Risks / Trade-offs

- EntitiesPage 1420 行单文件并发改易冲突 → 分片以组件为界，EntitiesPage 内部再按区块顺序改，单人分片不拆两人。
- 403 文案分型若映射错型会误导 → 分型只按 API 已返回的错误类别渲染，不自行推断。
- console token 与 brief 若有出入 → 以 console-shell 既有 token 为权威，brief 记录差距不改 shell。

## Migration Plan

纯呈现层 diff，无迁移。验收报告落 `reports/<date>-ontology-console-sweep.md`。

## Open Questions

- 介绍站（finddata 根 `add-bench-chain-website`）是否会外链控制台截图 → 若需要，验收截图可直接复用 `.impeccable/review/` 产物。
