# metering-poll-channel Specification（delta）

## MODIFIED Requirements

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
