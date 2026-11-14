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
- [x] 3.5 上线后实跑复核（2026-11-15T22:50Z 首轮 tick，pod `fd-wire-api-6bfcdfb4cf-jthnd` / 镜像 `sha-91cabb6`）：
      `polled = {fetched: 10000, accepted: 9500, duplicates: 500}`、`poll_max_pages = 20`、
      表行数 **49,186 → 58,686（+9,500）**、水位 **2026-11-08 09:32:32Z → 12:42:43.204Z**。
      与出片前只读探针的预测**逐字相同**（探针：20 页 × 500 = 10,000/轮、推进到 `12:42:43.204`）。
      积压余 54,676 条，按 10,000/轮约 6 轮排空。

## 4. 上线（阻塞项）

- [x] 4.1 回补判定：实测 `settled = {period: "2026-10", ok: true, customers: 0}`、`SUB2API_ADMIN_KEY` 已配 ⇒ 结算只结**闭月**，11 月要等 12-01 才结，回补 64,176 条真实调用不会立即出账；且规格首条要求「计费调用不得静默丢失」⇒ 回补是合规行为，不是需要特批的账务动作
- [x] 4.2 合并：`gitee/main` 由 `625942e` FF 到 `417fff7` → `7327d34` → `64ddc05`（代码与闸，未动 `deploy/k8s`，Argo 无 diff）
- [x] 4.3 出片 + tag 更新：池 run `43648299288` 全绿出 `sha-91cabb6`；ccr 侧 tag 可解析（relay 回灌，同一查法解析在役 tag 自证）；清单 `70a5d79` 只改镜像一行（`kubectl diff` 仅该行 + Argo 自有 `instance` 标签）
- [x] 4.4 上线后跑 3.5：见 3.5 读数（`accepted=0 → 9500`、水位前进、`poll_max_pages=20`）

## 5. 出片闸（2026-11-15 实历后补）

- [x] 5.1 定因：池 run `43643236199` 的 `Smoke gate` 起容器即 `sqlite3.OperationalError: unable to open database file`（镜像 `WORKDIR /app` 属 root、进程跑 appuser(10001)，默认 `DATABASE_URL=sqlite:///./fd_wire_dev.db` 是相对 CWD）⇒ `Push image` 被 skip，一个镜像都没出
- [x] 5.2 走池认的 repo 自带闸（优先级高于池共享的 `SMOKE_MODE`，后者是所有会话共用变量，不该为一条线改）：新增仓根 `scripts/ci-smoke.sh`
- [x] 5.3 该闸断言三件：`/health` 200／`channel-status` 带令牌 200（计量子系统真挂上）／`poll.poll_max_pages >= 2`（**镜像里有没有 11-15 那条修法**）
- [x] 5.4 为此把 `poll_max_pages` 加进 `channel-status` 响应——它是唯一能分辨「每轮一页」与「每轮二十页」的可观测口径；红路已有实测数据：线上老镜像的响应只有 `configured`/`last_tick` ⇒ 判 `absent` ⇒ 红
