# Spec Delta

## MODIFIED Requirements

### Requirement: 调度表与 CRUD

登录客户可为其属主目标创建刷新调度：派生数据集（derived 来源）、dashboard
产物、以及**追踪主体（subject）**三类。可调度目标 SHALL 属于这三类之一；间隔有地板（dataset ≥60 分钟、
subject ≥60 分钟、artifact ≥360 分钟——AI 刷新耗 token，地板封无人值守成本）；
每客户配额（默认 10，env 可调）；列表/删除/暂停/恢复；跨客户 404。

#### Scenario: 建调度地板
- **WHEN** 客户试图为看板创建 60 分钟间隔的调度
- **THEN** 被拒并提示最小间隔 360 分钟

#### Scenario: 类型校验
- **WHEN** 对非 derived 数据集、非 dashboard 产物、非 subject 主体建调度
- **THEN** 被拒并说明可调度目标类型

#### Scenario: 建主体刷新调度
- **WHEN** 客户为一个现存 subject 创建 60 分钟间隔的调度
- **THEN** 调度创建成功，目标类型记为 subject

## ADDED Requirements

### Requirement: subject 目标的定时物化

调度器到点执行 subject 调度时 SHALL 重跑该主体的物化快照（`wire_subject_snapshot` 同一实现），把结果更新进主体对应的数据集。subject 目标已删除时 SHALL 抛目标失存、由调度循环自动移除调度行（与既有目标失存语义一致）。执行失败 SHALL 记 `last_status=failed + last_error` 并继续循环，MUST NOT 中止调度器。

#### Scenario: 到点物化
- **WHEN** 一个 subject 调度到点且未暂停
- **THEN** 该主体的快照数据集按最新读结果更新，状态记为 ok，next_run_at 前移

#### Scenario: 主体删除自动清理
- **WHEN** 一个 subject 已被删除而其调度仍在
- **THEN** 该调度自动移除，不再空转
