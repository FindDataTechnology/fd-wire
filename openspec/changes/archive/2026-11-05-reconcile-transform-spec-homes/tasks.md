# 任务：归置转换域两本账

## 1. spec 归置

- [x] 1.1 新能力 `transform-pipeline-view`：三条 Requirement 原文迁入 + Purpose 回填（引擎真源指 R 根）
- [x] 1.2 旧 `transform-pipeline` 三条 REMOVED（改名退役）
- [x] 1.3 `wire-artifact-build-mcp` 五条 REMOVED（冗余账退役，真源=R 根 wire-build-mcp）

## 2. 验证与归档

- [x] 2.1 `openspec validate reconcile-transform-spec-homes --strict` 过
- [x] 2.2 archive 合入；确认旧能力目录处置干净（无空壳残留）
- [x] 2.3 代码零改动复核（`git diff --stat` 仅 openspec/）
