# Proposal: fix-metering-poll-pagination — 直读轮询「重叠窗满即停摆」

## Why

`metering-poll-channel` 的第一条 requirement 写的是「一次真实客户调用须在有限时间
（一个轮询周期余量，目标 10 分钟内）于 wire 计量表出现对应行」。2026-11-15 在
`fd-prod/fd-wire-api` 内只读实测：**这条 requirement 已经被违背了 7 天，而所有
判据都是绿的**。

实测读数（pod 内探针，只读）：

- 计量水位停在 `2026-11-08T09:32:32.606Z`；
- 旧实现在这个水位上取「一页 500 条、升序」，拿回的 500 条时间区间恰好是
  `09:27:52 .. 09:32:32` —— **全部是已入库事件**，`accepted` 恒 0、水位永不前进；
- 此后 `2026-11-08T09:32Z → 2026-11-14T20:15Z` 的 **64,176 条**客户调用一条都没进
  计量表（源端共 72,161 条 `mcp_server_access`）；
- 与此同时 `driver.running` 一直是 `true`，`channel-status` 一直报
  `fetched=500 / duplicates=500 / accepted=0` —— 「在跑」与「在入账」是两件事。

根因不是批太小，是**把重叠窗当成了游标**：`METERING_POLL_LIMIT=500` 与水位回看
5 分钟这两件事叠加后，只要窗口内的事件数 ≥ 批上限（生产里 5 分钟约 745 条调用，
稳定超过 500），每轮都会读到同一页，水位永远不动。这是稳态失效，不是抖动。

## What Changes

1. **复合游标 `(timestamp, _id)`**：同一毫秒的事件只按 `timestamp` 切不开，
   翻页游标必须带 `_id`（Mongo 文档必带），排序键与游标同序。
2. **同一 tick 内翻页直到追平**：`METERING_POLL_LIMIT` 的语义从「单轮总量」
   收窄为「单页大小」；新增 `METERING_POLL_MAX_PAGES`（默认 20）给单轮圈定
   工作量，避免一次 tick 无限拉取。
3. **规格补一个场景**：把「重叠窗被已入库事件填满」写成 scenario，否则这条
   稳态失效形态在规格里不可见（现有首个场景只覆盖「新调用能否入账」，覆盖不到
   「窗口饱和」这个前置条件）。

## Impact

- 受影响能力：`metering-poll-channel`（只加场景，不改既有判据口径）。
- 受影响代码：`api/fd_wire_api/metering/registry_poller.py`、`settings.py`；
  测试 `api/tests/test_metering_poller.py`、`test_metering_support.py`。
- **计费后果（需业务确认时序）**：上线后首轮起会把 64,176 条历史事件补进 11 月
  计量表（每轮 10,000 条、约 7 轮排空）。`settle` 只结**已关闭月份**，11 月当前
  不会被结算成账单；但如果要「从今往后计费」而不是回补，必须先跳水位再上线。
- 该修复不改变 `POST /internal/metering/ingest/poll` 的对外形状与幂等键。
