# metering-poll-channel Specification

## Purpose
定义 wire 计量入账对 registry 审计流的归集通道口径：直读（拉模式）为正道、可达性以活探针为闸门、探针不过按推送（推模式）降级——保证真实客户调用在有限时间内入账，不静默丢账。

边界（2026-11-06 O1 裁决登记）：本 spec 只管计量入账的归集通道口径；权威对账与计费口径见 finddata 根 `wire-facade-metering`（registry 门面计量）、`wire-billing`，两侧分立承接 SHALL NOT 重复记账。

## Requirements

### Requirement: 直读通道入账

直读通道配置达成后，一次真实客户调用须在有限时间（一个轮询周期余量，目标 10 分钟内）内于 wire 计量表出现对应行，且来源标注正确。入账时限 MUST 在**重叠窗被已入库事件填满**的稳态下同样成立：单轮轮询 MUST 在同一 tick 内按复合游标 `(timestamp, _id)` 翻页直至追平，MUST NOT 因为「批上限只够装下窗口内旧事件」而每轮重复读同一页、水位不前进。

#### Scenario: 真实调用按时入账
- **WHEN** 客户经 wire 入口完成一次计费调用，且直读通道已配置
- **THEN** 10 分钟内 wire 侧计量表出现该调用的行，凭据轨道与来源标注正确

#### Scenario: 重叠窗被旧事件填满仍前进
- **WHEN** 水位回看窗内的已入库事件数 ≥ 单页批上限（生产实况：5 分钟约 745 条调用、批上限 500）
- **THEN** 该轮轮询在 tick 内翻页越过这些重复事件继续摄取新事件，轮末水位前进；MUST NOT 出现「每轮 fetched=批上限、accepted=0、duplicates=批上限」而水位恒定

#### Scenario: 同一时间戳的事件跨页不丢
- **WHEN** 超过一页的事件共享同一 `timestamp`
- **THEN** 靠 `_id` 第二段游标继续翻页，这些事件全部被摄取，不发生漏读或死循环

### Requirement: 可达性闸门

直读通道的落地 MUST 以一次真实出站可达性探针为闸门（从 wire 运行环境探测 registry 数据面的只读入口）；探针不通过时 MUST NOT 宣称通道已建成。

#### Scenario: 探针不过不开闸
- **WHEN** wire 运行环境到 registry 数据面只读入口的出站探针失败
- **THEN** 直读通道标记为未达成，走降级路径而非带病上线

### Requirement: 降级到推送且不丢账

直读不可达时按推送口径降级：registry 侧审计事件推送至 wire 既有接收端；降级期间与直读期间一样，任何已发生的计费调用 MUST NOT 静默丢失。

#### Scenario: 降级期间入账连续
- **WHEN** 直读探针失败、系统按推送口径运行，期间发生计费调用
- **THEN** 该调用仍进入 wire 计量表（时间上允许晚于直读口径，但必须到达）

### Requirement: 摄取竞态安全

计量摄取服务（HTTP 推送与轮询归集共用）在并发摄取同一事件时 SHALL 以数据库唯一约束原子吸收冲突：冲突键已由并发事务提交的场合，本事务 SHALL 将该事件计为重复（`duplicates`/`anomaly_duplicates`）并继续处理批内其余事件，MUST NOT 因唯一约束违规使整批摄取失败或回滚。

#### Scenario: 并发同键摄取不炸批

- **WHEN** 两个摄取事务（如手动排空与自动 tick）先后处理同一 `request_id + server_name`（异常另含 `reason`）的事件，且后者的 SELECT 预检发生在前者提交之前
- **THEN** 后者的 INSERT 被唯一约束以 ON CONFLICT DO NOTHING 吸收，该事件计为重复，批内其余事件照常入账，事务不回滚

#### Scenario: 正常重复重放语义不变

- **WHEN** 同一事件在无并发的情况下被重放摄取（预检可见历史行）
- **THEN** 计数仍为重复且不产生第二行，行为与既有幂等口径一致

#### Scenario: 双方言一致

- **WHEN** 摄取服务运行在 PostgreSQL（生产）或 SQLite（测试）任一方言
- **THEN** 冲突吸收语义一致，均不抛出唯一约束违规

### Requirement: 通道状态可探

计量归集通道的实现态 SHALL 可经内部令牌保护的只读端点探明：直读是否配置、驱动最近一轮 tick 时刻与摄取/结算结果、后台驱动是否存活。直读未配置时驱动 SHALL 显式告警（一次即可，不逐周期刷屏），SHALL NOT 静默跳过而不留痕——部署若走推送通道，该告警即为「直读未开闸」的如实陈述，是否属预期由运维经状态端点证实。

#### Scenario: 运维探明生产通道形态
- **WHEN** 运维以 ingest 令牌 GET 通道状态端点
- **THEN** 响应含直读配置态、最近 tick 时刻与两段结果、驱动存活态；无令牌或令牌错误 fail-closed 拒绝

#### Scenario: 直读未配置显式告警
- **WHEN** 驱动 tick 运行而 registry 直读（REGISTRY_MONGO_URI/DB）未配置
- **THEN** 记录一次 WARNING（明示直读未开闸、推送通道部署属预期），后续周期不重复刷屏，且不入账行为不变
