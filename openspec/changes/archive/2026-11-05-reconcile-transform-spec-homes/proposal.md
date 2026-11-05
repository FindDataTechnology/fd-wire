# 归置转换域两本账（reconcile-transform-spec-homes）

## Why

体检 P1-3/P1-4：①O6 同名撞车——W 根 `transform-pipeline` 与 R 根 `wire-transform-pipelines` 名字几乎相同但职责不同（R=引擎契约九算子/DAG/租约队列，W=控制台视图三 Requirement），两账 Requirement 零交集非真重复，但同名必误引，且 W 账 Purpose 还是归档占位符；②O7 一物两账——W 根 `wire-artifact-build-mcp` 五条 Requirement 已被 R 根 `wire-build-mcp`「四类产物共用同一写入纪律」整体吸收（草稿优先/零半写/列名事实/来源指针全覆盖），W 实质成冗余窄拷贝。

## What Changes

- **改名+回填**：W 根 `transform-pipeline` 三条 Requirement 原文迁入新能力 `transform-pipeline-view`（视图面），Purpose 回填并注明引擎契约真源在 finddata 根 `wire-transform-pipelines`；旧 `transform-pipeline` 三条 REMOVED（改名退役）。
- **退役冗余账**：W 根 `wire-artifact-build-mcp` 五条 Requirement 全部 REMOVED——行为契约以 finddata 根 `wire-build-mcp` 为唯一真源（R 已覆盖全部语义）。
- 非目标：不动 R 根两本（finddata 根不在本 change 范围）；不改任何代码（spec 纯归置，工具名/端点/行为零变化）。

## Capabilities

### New Capabilities

- `transform-pipeline-view`: 控制台管线视图面——派生图端点、可视化视图、重派生与定时管理入口（原文迁自 transform-pipeline）。

### Modified Capabilities

（无——transform-pipeline 与 wire-artifact-build-mcp 为退役（REMOVED），非修改）

## Impact

- **代码**：零改动。`/api/v1/pipeline/graph`、PipelineView、wire_artifact_*_create 工具行为逐字不变。
- **spec 面**：fd-wire 根能力清单 −1（wire-artifact-build-mcp 退役）+1 改名（transform-pipeline → transform-pipeline-view）；转换域双账引述从此无歧义。
- **下游**：引述「transform-pipeline」的文档/简报此后应写 `transform-pipeline-view`（视图）或 `wire-transform-pipelines`（引擎契约）。
