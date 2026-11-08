# artifact-lifecycle — spec delta

## ADDED Requirements

### Requirement: 证据发布门 SHALL 按产物 kind 分流

发布前的证据门 SHALL 允许按产物 kind 覆盖全局模式（`EVIDENCE_GATE_KIND_OVERRIDES`）：
未配置时行为与配置前完全一致（读全局 `EVIDENCE_GATE_MODE`）；配置的 kind 使用其覆盖值，
其余 kind 仍按全局模式。覆盖值只接受 `off|warn|enforce`，非法值与坏 JSON 一律忽略该键并
记告警，不得阻断服务启动。

理由（须随实现保留）：`evidence` 只能指向 fd-info 的 info-stream 文档，而**纯数据观测类
产物**（图表 + 数值面板）的可追溯性在 `data_plane` 的 `source/concept/entity` locator 里——
两条等价的溯源路径。要求数据看板出 info-stream 证据，等于要求它证明一个自己不依赖的来源；
一刀切 enforce 会让所有含真实金额读数的数据看板无法发布。

#### Scenario: 未配置覆盖时行为不变
- **WHEN** 未设置 `EVIDENCE_GATE_KIND_OVERRIDES`，全局为 `enforce`
- **THEN** 任何 kind 的产物都按 `enforce` 判定，与配置该能力之前完全一致

#### Scenario: 只降低被点名的 kind
- **WHEN** 配置为 `{"dashboard":"warn"}` 且全局为 `enforce`
- **THEN** dashboard 产物的强断言只记结构化告警日志并放行；doc 等其余 kind 仍被 `enforce` 拦截

#### Scenario: 非法覆盖值不阻断启动
- **WHEN** 覆盖值是坏 JSON，或模式值不在 `off|warn|enforce` 之内
- **THEN** 忽略该键（记告警），该 kind 回落全局模式，服务正常启动

#### Scenario: 告警可见而非静默
- **WHEN** 某 dashboard 产物含强断言且无 evidence 块，被降级为 warn 放行
- **THEN** 发布日志出现带产物 id、断言条数与首条断言路径的 `evidence_gate warn` 结构化记录
