## ADDED Requirements

### Requirement: 通道状态可探

计量归集通道的实现态 SHALL 可经内部令牌保护的只读端点探明：直读是否配置、驱动最近一轮 tick 时刻与摄取/结算结果、后台驱动是否存活。直读未配置时驱动 SHALL 显式告警（一次即可，不逐周期刷屏），SHALL NOT 静默跳过而不留痕——部署若走推送通道，该告警即为「直读未开闸」的如实陈述，是否属预期由运维经状态端点证实。

#### Scenario: 运维探明生产通道形态
- **WHEN** 运维以 ingest 令牌 GET 通道状态端点
- **THEN** 响应含直读配置态、最近 tick 时刻与两段结果、驱动存活态；无令牌或令牌错误 fail-closed 拒绝

#### Scenario: 直读未配置显式告警
- **WHEN** 驱动 tick 运行而 registry 直读（REGISTRY_MONGO_URI/DB）未配置
- **THEN** 记录一次 WARNING（明示直读未开闸、推送通道部署属预期），后续周期不重复刷屏，且不入账行为不变
