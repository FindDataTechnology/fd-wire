# demand-orchestration 变更：受理即自动出单（wire-demand-auto-export）

## ADDED Requirements

### Requirement: 受理 SHALL 自动出单

`submitted→in_progress` 迁移成功后，系统 MUST 自动调用既有出单 service
（`export_workorder_service`，语义/留档/拒绝口径逐字复用）把需求单送入
舰队拉取队列——内部端点与管理台两个迁移面 MUST 同语义接入（管理台不得
漏钩子）。自动出单成功时 `workorder_exported` 事件 MUST 带 `trigger:
"auto"` 标注（人工出单不带此键，既有历史零漂移）；被拒时（无源地址/
slug 占用/禁爬复检）MUST NOT 产出工单、MUST NOT 回滚迁移，MUST 落一条
`auto_export_failed` 事件（含 reason 与 status_code）供运营面如实呈现。
钩子自身的意外异常 MUST 被兜住：迁移响应不受影响，失败如实留痕。

#### Scenario: 受理即出单
- **WHEN** 操作员把带合法源地址的 submitted 单迁移到 in_progress
- **THEN** 响应照常返回 in_progress，pipeline_events 末条为
  workorder_exported（trigger=auto，含 ticket_path 与 sha256），该单
  即入舰队拉取队列（pending 端点可见）

#### Scenario: 出单被拒如实留痕
- **WHEN** 操作员受理一张无 source_urls 的存量单（或 slug 已占用的单）
- **THEN** 迁移照常成功（in_progress），pipeline_events 末条为
  auto_export_failed（reason 含服务端拒绝文案），无 workorder_exported

#### Scenario: 管理台同语义
- **WHEN** 操作员经管理台端点（/internal/admin/demands/{id}/transition）
  受理同一形态的单
- **THEN** 行为与内部端点逐字一致（成功出单或失败留痕），两面对同一
  需求单的响应键集与事件形状同形

#### Scenario: 钩子异常不打断迁移
- **WHEN** 自动出单钩子内部发生意外异常（非出单被拒）
- **THEN** 迁移仍成功返回，auto_export_failed 留痕，绝不 5xx

### Requirement: 自动出单 SHALL 有补扫兜底

系统 MUST 以后台 tick 循环定期补扫「in_progress 且无任何出单尝试留档
（既无 `workorder_exported` 也无 `auto_export_failed`）」的需求单并自动
出单——兜住受理钩子未生效（进程崩溃/瞬时异常/存量在途单）的漏网。补扫
MUST 幂等：已有出单留档的单绝不重出；已有 `auto_export_failed` 的单
MUST NOT 重试（防事件刷屏——拒绝原因均为需人工处置类，等操作员经人工
入口处理），继续扫其余单；单次 tick 的失败 MUST NOT 中断循环。循环
MUST 可经环境变量关闭（缺省开）。

#### Scenario: 漏网补扫
- **WHEN** 某 in_progress 单因钩子失效而没有任何出单尝试留档
- **THEN** 下一轮 tick 自动为其出单（workorder_exported trigger=auto）

#### Scenario: 补扫幂等
- **WHEN** 已出单的 in_progress 单经历任意多轮 tick
- **THEN** 不产生任何新导出（零重复工单），其事件流逐字节不变

#### Scenario: 失败单不重试
- **WHEN** 某 in_progress 单已有 auto_export_failed 留档且仍无导出
- **THEN** 补扫跳过该单（零新事件），其余漏网单照常补出

#### Scenario: 关闭开关
- **WHEN** 环境变量把自动出单关闭
- **THEN** 钩子与补扫循环均不动作（受理照常成功、零出单事件），
  人工「转生成工单」入口不受影响

### Requirement: 运营进度面 SHALL 呈现自动出单失败

admin 派发台进度面 MUST 渲染 `auto_export_failed` 阶段（含失败原因），
操作员可见「自动出单被拒·需人工处置」并据此使用既有「转生成工单」
人工入口重试；`workorder_exported` 为自动触发时 SHOULD 呈现自动标注。
未出单占位（「尚未出单」）语义不变——有 auto_export_failed 即非「尚未
出单」，MUST NOT 再显示该占位。

#### Scenario: 失败可见
- **WHEN** 操作员展开一张自动出单被拒的需求单进度面
- **THEN** 时间线含「自动出单被拒」阶段与失败原因，且不再显示
  「尚未出单」占位

#### Scenario: 自动成功标注
- **WHEN** 操作员展开一张自动出单成功的单
- **THEN** 「已出单」阶段带自动触发标注，其余阶段渲染不变
