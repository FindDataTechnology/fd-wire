# tasks — fix-metering-poll-pagination

## 1. 定因（只读，生产实测）

- [x] 1.1 从 pod 读 `channel-status`：`fetched=500 / duplicates=500 / accepted=0`，水位停在 11-08
- [x] 1.2 只读探针量源端规模：`mcp_server_access` 共 72,161 条，最新 `2026-11-14T20:15:24Z`，比水位新 64,176 条
- [x] 1.3 复刻旧查询：一页 500 条的时间区间 `09:27:52..09:32:32` 恰好截止在水位 ⇒ **窗口内全是旧事件**，稳态停滞而非抖动
- [x] 1.4 量新查询：复合游标翻页 20 页 × 500 = 10,000 条/轮，推进到 `12:42:43`，剩余 54,676 条（约 7 轮排空）

## 2. 实现

- [x] 2.1 `registry_poller.fetch_batch` 收 `after=(timestamp, _id)` 复合游标，排序键同步为 `(timestamp, _id)`
- [x] 2.2 `poll_registry_once` 在 tick 内翻页，页数上限 `max_pages`；取不满一页即判追平
- [x] 2.3 `settings.metering_poll_max_pages`（默认 20）+ `describe()` 暴露 `poll_max_pages`
- [x] 2.4 头注写清「重叠窗是回看、不是游标」与生产实历

## 3. 验证

- [x] 3.1 新增 4 条用例：追平翻页 / 页数上限圈住单轮 / 满窗前进回归（复刻生产停滞）/ 同时间戳靠 `_id` 切开
- [x] 3.2 夹具补 `_id`（真 Mongo 文档必带），排序键容忍缺键（老夹具）
- [x] 3.3 `tests/ -k metering`：**53 passed / 2 skipped**（2 条 skip 是 PG 方言冒烟，需 `PG_TEST_URL`，与本次无关）
- [x] 3.4 生产只读探针复核新查询能越过水位（见 1.4 读数）
- [ ] 3.5 上线后实跑复核：`channel-status` 由 `accepted=0` 转为 `accepted>0`、水位前进、约 7 轮内积压清零

## 4. 上线（阻塞项）

- [ ] 4.1 **业务裁决**：上线即回补 11-08→11-14 的 64,176 条历史事件（`settle` 只结闭月，11 月不会立即出账）；若要「从今往后计费」，需先把水位跳到当前
- [ ] 4.2 合并分支 `fix/metering-poll-pagination`（gitee/main 上一笔是 `625942e`）
- [ ] 4.3 出片 `fd-wire-api` 并更新部署 image tag（**注意**：`fd-wire` 主工作树在途的本体工作与本修复无关，出片取自 git ref 不取工作树）
- [ ] 4.4 上线后跑 3.5，并把 `channel-status` 前后读数记进本文件
