# 计量链显式告警与通道探针（wire-metering-explicit-alerting）

## Why

体检 P1-7：计量链有静默失败史（rows_returned 戳丢失曾静默断流一月，R 根 wire-facade-metering spec 自录）与 fail-quiet 残留——`metering/driver.py` `_poll_once` 在 `REGISTRY_MONGO_URI/DB` 未配置时静默 `return None`（同文件的 settle 段未配置却有 warning，idiom 不一致）；「可达性探针闸门」只是运维口径，代码无显式探针落点（生产当前走直读还是推送在体检时无法证实）。

## What Changes

- **直读未配置从静默改显式**：`_poll_once` 未配置时记 WARNING（一次即可，不逐 tick 刷屏）——文案明示「直读通道未开闸；若部署走推送通道此为预期，否则计量在静默丢失」，与 settle 段告警对齐。
- **通道状态探针端点**：`GET /internal/metering/channel-status`（复用 `METERING_INGEST_TOKEN` bearer 鉴权，fail-closed 同既有 ingest 面）——返回 `{poll: {configured, last_tick_at, last_result}, driver: {running}}`：直读是否配置、driver 最近一轮 tick 时刻与摄取计数、后台任务是否在跑。运维据此可直接证实「生产走直读还是推送、最近一轮是否活着」。
- driver 在 `tick_once` 记录最近一轮结果（进程内状态，不落库）。
- 非目标：不改摄取/结算行为本身；不做跨进程监控/告警通道对接（那是 infra 面增量）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `metering-poll-channel`: 新增「通道状态可探」requirement——直读未配置 MUST 显式告警（不得静默跳过）；通道状态 MUST 经内部令牌保护的只读端点可探（配置态/最近 tick/驱动存活）。

## Impact

- **代码**：`api/fd_wire_api/metering/driver.py`（告警+last_tick 状态）、`api/fd_wire_api/metering/routes.py`（新 GET 端点）、测试 `api/tests/test_metering_driver.py` 与 `api/tests/test_metering_routes*.py`（按现有文件归属增用例）。
- **外部接口**：新增 1 个内部只读端点（令牌保护）；既有端点行为不变。
- **运维**：生产「走直读还是推送」从体检时的未证实变为随时可探。
