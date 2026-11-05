## MODIFIED Requirements

### Requirement: 通知

告警触发/恢复沿的通知渠道 MUST 支持两类，可并存：`webhookUrl`（在则 POST，5s 超时，载荷含规则名/artifact id/状态/归约值/阈值/时间）与 `notifyEmails`（在则 SMTP 发信，收件为该列表，主题含规则名与状态、正文含归约值/阈值/时间与产物链接）。持续 firing 且距上次通知超过 cooldownMinutes MUST 对两类渠道再发（防静默）；任一渠道投递失败 MUST 记 notify_failed 事件（注明渠道）且不阻塞评估、不阻塞另一渠道。两类渠道均未配置 MUST 零外呼（只落状态与事件）。SMTP 配置缺失（未配 env）时邮件渠道 MUST 如实跳过并记结构化告警（一次），MUST NOT 静默吞掉「承诺了邮件但平台没配」。

#### Scenario: 沿触发通知

- **WHEN** ok→firing 沿
- **THEN** 已配 webhook 收到一次 POST；恢复沿再收一次；持续 firing 在冷却内不重复、超冷却再收

#### Scenario: 邮件通知

- **WHEN** 规则配置 notifyEmails 且触发，平台 SMTP 已配置
- **THEN** 列表内收件人收到告警邮件（含规则名/状态/归约值/阈值/时间）；发送失败记 notify_failed（渠道=email）且 webhook 投递不受影响

#### Scenario: SMTP 未配置不静默

- **WHEN** 规则配置了 notifyEmails 但平台 SMTP env 缺失
- **THEN** 邮件跳过并落一次结构化告警（明确「SMTP 未配置」），评估与 webhook 渠道行为不变
