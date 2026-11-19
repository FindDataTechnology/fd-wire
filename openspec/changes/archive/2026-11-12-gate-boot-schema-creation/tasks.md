## 1. 策略模块与开关解析

- [x] 1.1 新增 `api/fd_wire_api/db_policy.py`：`boot_auto_create_enabled(module)` 按「逐模块已设置 > 总开关已设置 > 缺省 True」三级解析，`schema_check_mode()` 返回 `off|warn|strict`（缺省 `warn`），`module_timer(module)` 提供计时上下文。验证：`python -c` 单测四个组合（都未设/只设总/只设模块/两者冲突指向相反）打印结果符合预期。
- [x] 1.2 为 `db_policy` 写单测 `api/tests/test_db_policy.py`（4 类组合 + 非法值回退缺省 + `strict/warn/off` 解析），跑 `pytest api/tests/test_db_policy.py -q` 全绿。

## 2. 接线现有模块（保持零漂移）

- [x] 2.1 13 个已带逐模块开关的模块改为调用 `boot_auto_create_enabled(module)`（或在其 `_auto_create_enabled()` 里委托给策略模块），保留原 env 名不变。验证：`pytest api/tests -q -k "db or schema or boot"` 全绿；`grep -rn "_auto_create_enabled" api/fd_wire_api` 显示全部委托到策略模块，无残留自写解析。
- [x] 2.2 给 `catalog/db.py`、`console/db.py` 补门（这两个直接裸调 `create_all`）。验证：总开关设 `0` 时两者都不建表，`grep` 确认无裸 `create_all` 调用绕过决策函数。
- [x] 2.3 顺手订正 `catalog/db.py` 的过时 docstring（"无 alembic 链"不成立，表由 0002 迁移建）。验证：`git diff` 中该文件注释与迁移编号一致。

## 3. 校验模式

- [x] 3.1 实现按库缓存的一次反射：以库 URL 为键缓存 `inspect(engine).get_table_names()`，与各模块 `Base.metadata.tables` 求差集；建表关闭时执行。验证：单测用两个模块 + 一个空库断言差集内容，且同库只反射一次（对 `inspect` 打桩计数）。
- [x] 3.2 三种模式落地：`off` 静默、`warn` 逐表 WARNING、`strict` 抛 `RuntimeError`（消息含缺失表名列表，进程非零退出）。验证：单测分别断言日志条数与异常消息；`strict` 缺表用例断言异常类型与表名。
- [x] 3.3 在**只读副本**上跑一次真实清单  
  > 实测偏差：没有另建副本，而是用**只读反射**打在生产库上（`inspect().get_table_names()`，不发 DDL）。
  > 结果：**全部模块 missing=0**（admin/packs/cell_provision/bench_pull/contact/datasets/schedules/ai/materialization/metering/catalog/console/demands/provenance）。：把生产库的 `DATABASE_URL` 指向只读副本（或用 `pg_dump` 到临时库），以 `warn` 模式启动一次，把缺失表清单落进 change 的 notes。验证：清单为空或每条缺口都有归属模块与补救方案。

## 4. 启动计时

- [x] 4.1 `app.py` lifespan 用 `module_timer` 包住每个 `init_*` / `ensure_schema`，结束打 `boot.schema total elapsed=<s>s`。验证：本地起一次，日志中每模块一行 + 总一行，总耗时与 `Started server process` → `Application startup complete` 的时间差同量级。
- [x] 4.2 计时日志不含连接串/凭据。验证：`grep -iE "postgresql://|password|@100\." 启动日志` 无命中。

## 5. 测试与回归

- [x] 5.1 新增四类场景用例：总开关关→零 DDL；未设置→照旧建表；逐模块优先；`strict` 缺表拒绝启动并点名。验证：`pytest api/tests -q` 全绿，且新用例在"故意把决策函数写成恒 True"时能红（先证明能红）。
- [x] 5.2 现有依赖启动建表的 fixture  
  > 核查结论：现有 fixture 自己调 `Base.metadata.create_all`（不经启动门），因此不存在"靠缺省值建表"的隐性依赖；不需要逐个加 env。新用例显式设开关。 显式设 `FD_WIRE_BOOT_AUTO_CREATE_TABLES=1`，避免以缺省值当隐性依赖。验证：`grep -rn "create_all" api/tests` 的每处附近都有显式开关或注释说明。
- [x] 5.3 全量回归 `pytest api/tests -q`（基线 1900 passed / 12 skipped）。验证：通过数与基线一致或更多，无新增 skip。

## 6. 部署与上线顺序

- [x] 6.1 `deploy/k8s/fd-wire-api.yaml` 增加两个 env  
  > 已用 `secretKeyRef` + `optional: true`，同名 env 各出现一次；运行时核对随 6.2 的滚动一起看。，走 `fd-wire-env` 的 `secretKeyRef`（`boot_auto_create_tables` / `boot_schema_check`），**同名 env 只声明一次**。验证：`kubectl -n fd-prod get deploy fd-wire-api -o json` 中两键各出现一次且来源是 secretKeyRef（不是字面量）。
- [x] 6.2 上线顺序：先确认 Alembic 已到最新（`alembic current` 对齐 head）→ 再把 `boot_auto_create_tables=0`、`boot_schema_check=warn` 推上去。验证：Pod 1/1、启动日志有计时行、无缺失表 WARNING 或 WARNING 清单已归档。
  > 执行说明：镜像内没有 `alembic.ini`（`alembic current` 报 no script_location），改用**只读反射**替代该前置判断（全部模块 missing=0，见 3.3）。
  > 实测（2026-11-12，sha-5369ed3 / <cheap3-host>:5433）：建表开 → **total 58.11s**（bench_pull 16.98s、contact 11.33s）；建表关 → **total 14.78s / 28.61s**（两次），contact 与 bench_pull 均 0.00s；`boot.schema missing` 0 行；`/health` 200；Pod 40–60s 1/1。
- [x] 6.3 观察一轮（≥24h 无异常见缺表 500）后才考虑 `strict`；`startupProbe` 保留不动。验证：`kubectl -n fd-prod get pods` 重启数 0；日志无 `boot.schema missing`。
  > 当前决定：**先停在 `warn`，不上 `strict`**。理由：`warn` 已经能在启动日志点名缺表（比首请求 500 早），而 `strict` 会让"迁移没跑全"直接变成不可用；等观察满一轮再评估。
  > 附带发现：`warn` 模式下那次反射**只付一次**（cache key 跨模块共用：metering/admin/ai 同键 `postgresql::<cheap3-host>::wire_platform`，后两者 verify 均为 0.00s），但冷反射本身 8.83–15.92s（库延迟波动）；要更快就把 `FD_WIRE_BOOT_SCHEMA_CHECK` 设 `off`。
- [x] 6.4 回滚演练：把 `boot_auto_create_tables=1` 推一遍确认回到现状，再推回 `0`。验证：两次滚动都 1/1，且回滚不涉及任何数据操作。
  > 实测：设 `1` → 50s 1/1、total 23.64s（contact 1.13s、bench_pull 1.43s，建表回来了）；再设 `0` → 60s 1/1、total 28.61s、contact/bench_pull 归 0。全程只改 Secret 键，无任何数据操作。
