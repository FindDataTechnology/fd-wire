## Why

api 启动时的 lifespan 会对 **~25 个模块逐个 `create_all`**，实测启动耗时 **60–75 秒**；而
`deploy/k8s/fd-wire-api.yaml` 的 liveness 预算只有约 60 秒（`initialDelaySeconds: 10` +
`3 × periodSeconds: 10`），容器在启动完成前被 SIGKILL（exit 137，`Started` 与 `Finished`
正好差 60 秒），于是无限 CrashLoop。2026-11-11 滚到 `sha-2fd9725` 后连续十余小时、31 次重启。

已上的止血是给 Deployment 加 `startupProbe`（180 秒启动预算，提交 `67bb2f2`）——服务已恢复，
但那只是把窗口调够：**根因仍在**。生产本来就只该走 Alembic（每个 `init_db` 的注释都写着
"生产走 alembic 00xx"），启动期建表是开发兜底，却在生产里成了启动时间的主要成本；
而且建表一旦被 DDL 锁或库慢拖住，表现是"启动挂住"，排查成本极高（本次靠 faulthandler 周期打栈
才证明是慢不是死锁）。

## What Changes

- 新增**一个启动期总开关** `FD_WIRE_BOOT_AUTO_CREATE_TABLES`（缺省 `1`，保持开发/测试行为不变），
  所有模块的 `init_db()` / `ensure_schema()` 都遵守它；既有的逐模块开关
  （`FD_WIRE_<MODULE>_AUTO_CREATE_TABLES`）保留，**更具体的那个优先**，不改变任何既有语义。
- 补齐两个**没有门**的模块：`catalog/db.py`、`console/db.py` 的 `init_db()` 直接裸调
  `create_all`，其余 13 个模块都已有开关。
- 新增**校验模式**（建表关闭时生效）：`FD_WIRE_BOOT_SCHEMA_CHECK=off|warn|strict`（缺省 `warn`）。
  每个库做一次反射（`inspect().get_table_names()`，不是逐表 `has_table`），与模型声明比对：
  `warn` 只记日志点名缺失表，`strict` 直接拒绝启动并列出缺失表名——**早失败**，而不是等到
  第一个请求 500。
- 启动期**计时日志**：逐模块与总耗时各打一行（`boot.schema module=<m> elapsed=<s>s`、
  `boot.schema total=<s>s`），让"启动变慢"在日志里可见，而不是只能从 CrashLoop 反推。
- `deploy/k8s/fd-wire-api.yaml` 的生产环境设 `FD_WIRE_BOOT_AUTO_CREATE_TABLES=0`（先 `warn`，
  观察一轮再考虑 `strict`）。`startupProbe` 保留作为安全网。

**非目标**：不替换 Alembic、不删除任何 `init_db()`、不改动任何迁移链；本期不追求启动耗时的
绝对数值目标，只把"生产启动不做 DDL"这件事做成可开关、可校验、可观测。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `wire-storage-postgres`: 该能力已定义「api 双 URL 语义」与「生产迁移与回退手册」，
  但把"启动时建表"当作既有事实。本期把**启动期 schema 处置**升为显式契约：
  统一开关、逐模块开关的优先级、校验模式的三种取值与失败语义、启动计时可观测。

## Impact

- 代码：`api/fd_wire_api/app.py`（lifespan 计时与调用顺序不变）、
  `api/fd_wire_api/catalog/db.py`、`api/fd_wire_api/console/db.py`（补门）、
  以及 13 个已带开关模块的 `db.py`（改为同时遵守总开关）、各 `*/settings.py`。
- 部署：`deploy/k8s/fd-wire-api.yaml` 增加两个 env（走 `fd-wire-env` Secret 或直接字面量）。
- 测试：新增"总开关关闭时零 DDL""逐模块开关优先于总开关""strict 缺表拒绝启动并点名"
  "warn 缺表仅告警"四类用例；既有测试里依赖启动建表的 fixture 需显式设 `=1`。
- 风险：生产若在 Alembic 未跑全时把总开关关掉，缺表会暴露为启动失败（`strict`）或
  首请求 500（`warn`）——这正是要的"早失败"，但需要发布顺序为 **先跑迁移、再关开关**。
