# 任务：计量链显式告警与通道探针

## 1. 代码

- [x] 1.1 `_poll_once` 未配置 → 一次 WARNING（settle 段同 idiom）；`tick_once` 记 last_tick 快照
- [x] 1.2 新增 `GET /internal/metering/channel-status`（ingest 令牌 fail-closed，只读）
- [x] 1.3 测试：未配置告警一次且返回 None；tick 记录快照；端点鉴权矩阵与形状

## 2. spec 与验证

- [x] 2.1 metering-poll-channel delta：「通道状态可探」ADDED
- [x] 2.2 metering 相关 pytest 过；`openspec validate wire-metering-explicit-alerting --strict` 过
