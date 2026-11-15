## MODIFIED Requirements

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
