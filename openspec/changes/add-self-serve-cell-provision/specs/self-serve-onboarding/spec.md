## MODIFIED Requirements

### Requirement: 升档扩权

免费客户升档至付费档后，cell 配给与月度额度按新档即时生效；在线自助充值通道不在本能力范围（首期升档经联系开通/内部操作），降档与退租沿用既有幂等语义。cell 配给 SHALL 经自动配给链完成（升档事件入队→宿主 runner 执行 provision/grant/relay/registry 注册→端点落注册表 DB 兜底源），任一步失败 SHALL 标 failed 并通知运营回退现行手动链，已执行步骤幂等可重试。

#### Scenario: 升档得 cell
- **WHEN** 免费客户被升至基础档（¥10）
- **THEN** cell 配给完成，月度额度按基础档含额生效
#### Scenario: 自动配给链
- **WHEN** 升档触发配给请求入队
- **THEN** 宿主 runner 领任务执行 provision→grant→relay→registry 注册→端点落注册表，全程零人工；完成后 AI 构建即可用

#### Scenario: 配给失败回退人工
- **WHEN** 配给链任一步失败
- **THEN** 请求标 failed 并通知运营回退现行手动链；已执行步骤幂等可重试，客户侧呈现「开通中/需联系支持」而非静默无 cell
