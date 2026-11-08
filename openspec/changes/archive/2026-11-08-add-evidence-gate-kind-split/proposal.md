# 证据发布门按产物 kind 分流（add-evidence-gate-kind-split）

## Why

`EVIDENCE_GATE_MODE=enforce` 会拦「无 evidence 块的金额/比例断言」，而 evidence 只能指向
fd-info 的 info-stream 文档（`get_item(stable_id)` → 正文按 span 逐字比对）。

2026-11-08 花卉线上产时撞上这条门：三块行业看板的面板里有「1.27 亿美元」「0.27 元/枝」
这类真实读数，被拒发布（`InvalidArtifactSpec: 缺证据的强断言（6 处）`）。问题不在于
「有没有证据」，而在于**证据的种类**——纯数据观测类看板的可追溯性在另一套体系里：
每张图都带 `data_plane` 的 `source/concept/entity` locator，与 info-stream 是两条等价的
溯源路径。要求这类板出 info-stream 证据，等于要求它证明一个自己不依赖的来源。

用户 2026-11-08 裁决：**按产物 kind 分流**——叙述/结论类产物保持 enforce，纯数据看板降 warn。

## What Changes

- `EvidenceGateSettings` 新增 `EVIDENCE_GATE_KIND_OVERRIDES`（JSON，如 `{"dashboard":"warn"}`）：
  **默认空 = 行为完全不变**（既有产物零影响）；只有显式配置的 kind 才降级。
- `mode_for(kind)`：kind 覆盖 > 全局 `mode`；`publish_artifact` 用它取生效模式。
- 坏 JSON / 非法模式值：忽略该键并记告警，不阻断启动。
- 部署清单 `deploy/k8s/fd-wire-api.yaml` 显式开 `{"dashboard":"warn"}`，其余 kind 不动。

非目标：不改变 `detect_strong_claims` 的判定范围，不动 evidence 的结构/校验/核对语义，
不关闭门（`off` 仍是独立回滚位）。

## 实现先于立项（诚实记录）

本变更的代码在撞门当天已实现并上产（`fd-wire` `72afb17` 逻辑 + `d59b06e` 滚镜像
`sha-e76fd47`），本文是**事后补记**，以免 spec 与已上线行为脱节。
