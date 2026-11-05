# 柏讯模块体检（optimize-wire-module-audit）

## Why

五线按模块优化的试点选在柏讯 Wire（用户 2026-11-05 拍板）。柏讯的能力规格分散在两本账——finddata 根 `openspec/specs/` 的 23 条 `wire-*`（跨仓契约/平台面）与 fd-wire 自有根的 45 条（产品功能面）——共约 68 个模块从未做过一次系统的健康对账：哪些 spec 与代码已漂移、哪些模块无测试/无主人、两本账重叠的 8 对（如 `wire-transform-pipelines` ↔ `transform-pipeline`）谁真源、部署态与仓 HEAD 是否一致，全部没有底册。三项目标：体检还债、收敛整合、性能与成本；试点先在这条线把体检方法校准，产出可直接排期的 backlog，再扇形铺开到其余各线。

## What Changes

- **模块总账**：68 条 spec（两根）逐条登记——spec 归属根、代码位置、死活状态、跨根重叠对标记；落 `ledger.md`。
- **逐模块体检**：按 6 个模块簇并行体检，每簇产健康卡，五项检查：① spec↔代码双向对齐 ② 测试存在性与通过 ③ 部署态 vs 仓 HEAD ④ 运行信号（错/慢/贵，来自既有探针配方与日志面）⑤ spec 陈旧度；落 `findings/`。
- **评分 backlog**：P0/P1/P2 分级的问题清单 + 8 对重叠模块的真源裁决建议；落 `backlog.md`。修复本身**不在本 change 内实施**——每项按裁决另立 change。
- 非目标：不改任何产品代码、不改既有 specs/ 下任何需求、不做性能修复；本 change 全程只读调查（产出物为 change 目录内文档）。

## Capabilities

### New Capabilities

（无——纯调查/盘点，`skip_specs: true`）

### Modified Capabilities

（无）

## Impact

- **代码**：零改动（read-only 审计）。
- **产出物**：`openspec/changes/optimize-wire-module-audit/` 下 `ledger.md`、`findings/`（6 份健康卡）、`backlog.md`。
- **下游**：backlog 条目将孵化后续修复 change（还债/收敛/性能三类）；体检方法（五项检查+簇拆分+并行子代理）将作为其余各线试点的模板。
- **风险**：体检触碰生产探针仅限既有只读配方（registry 可见性、工具面实探）；不执行任何写操作。
