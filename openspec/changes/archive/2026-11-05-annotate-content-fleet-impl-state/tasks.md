# 任务：wire-content-fleet 悬空 Requirement 实现态注记

## 1. 实查定集

- [x] 1.1 在 api/ web/ 及全仓代码 grep 逐条核验 7 条 Requirement 落点，定标注集：R1/R2/R5/R7 无入口标注；R3/R4/R6 有落点（artifacts/service.py:90、materialization/runner.py:3-17、schedules/service.py:9-11）跳过

## 2. MODIFIED delta

- [x] 2.1 `specs/wire-content-fleet/spec.md` 写 4 条 MODIFIED Requirements（整块复制原文含全部 Scenario，正文末尾追加注记行）

## 3. 验证与归档

- [x] 3.1 `openspec validate annotate-content-fleet-impl-state --strict` 通过
- [x] 3.2 勾结 tasks，`openspec archive --yes` 归档，git 仅加 openspec 路径并以指定 message 提交推送
