## Context

见 proposal.md 的 Why。这里只记设计相关现状：

- `api/fd_wire_api/app.py` 的 `lifespan` 顺序调用 ~25 个 `init_*` / `ensure_schema`，每个模块自己
  持有 `Base` 与惰性引擎（`get_engine()` + `cache_clear()` 模式），彼此不共享 metadata。
- 开关现状是**逐模块各写一份**：`contact/db.py` 的 `_auto_create_enabled()` 读
  `FD_WIRE_CONTACT_AUTO_CREATE_TABLES`，其余 12 个模块同构（部分在 `*/settings.py` 里）。
  `catalog/db.py` 与 `console/db.py` **完全没有门**，直接 `Base.metadata.create_all(...)`。
- **`catalog/db.py` 的 docstring 声称"无 alembic 链"是过时的**：实测 `indicator_snapshots` /
  `catalog_sync_state` 由 `20261004_0002_add_catalog_mirror_tables.py` 建表；`console` 的
  `console_onboardings`(0015) / `customer_members`(0027) / `member_preferences`(0029) 同样都有
  迁移。也就是说"生产不建表"在迁移跑全的前提下是可行的——但**不能凭 docstring 判断**，必须以
  反射差集为准（见 D2）。

## Goals / Non-Goals

**Goals**
- 生产启动默认不再执行 DDL，且这件事是**可关、可验、可看**的。
- 保持开发/测试零漂移（缺省仍建表）。

**Non-Goals**
- 不追求"启动 < N 秒"的量化目标（那是结果，不是契约）。
- 不补齐缺失的 Alembic 迁移；本设计只把缺口暴露出来，补迁移另立。
- 不引入迁移框架变更、不改任何既有迁移脚本。

## Decisions

### D1：一个中心策略模块，而不是再抄 15 份 env 解析

新增 `api/fd_wire_api/db_policy.py`：

```
boot_auto_create_enabled(module: str) -> bool     # 决策函数
schema_check_mode() -> str                        # off|warn|strict，缺省 warn
module_timer(module: str)                         # 计时 + 一行日志的上下文管理器
```

解析优先级（**必须能区分"未设置"与"设为 0"**）：

1. 逐模块开关 `FD_WIRE_<MODULE>_AUTO_CREATE_TABLES` 若**已设置** → 以它为准（最具体优先）。
2. 否则总开关 `FD_WIRE_BOOT_AUTO_CREATE_TABLES` 若**已设置** → 以它为准。
3. 否则 → `True`（开发/测试既有行为）。

**替代方案**：继续在每个 `db.py` 里各写 `_auto_create_enabled()`。否决——15 份优先级逻辑
必然漂移，本次的两个"无门"模块就是漂移的结果。

### D2：校验用"每库一次反射 + 与各模块 metadata 比对"

`create_all` 慢的根因是逐表 `has_table` 往返。校验模式不能重复这个错误：
按**目标库 URL** 缓存一次 `inspect(engine).get_table_names()`，再用各模块自己的
`Base.metadata.tables` 求差集。没有 Alembic 覆盖的模块（如 `catalog`）在差值里会立刻现形，
`warn` 模式等于给出"上线前必须先补迁移/或保持该模块开关为开"的清单。

**替代方案**：直接跑 `create_all(checkfirst=True)` 当校验。否决——那正是要消灭的开销，
且它会在"校验"名义下偷偷建表。

### D3：`strict` 用抛错拒绝启动，不吞异常

`strict` 缺表时抛 `RuntimeError`（消息含缺失表名列表），让 uvicorn 以非零码退出、k8s 拉起
新副本并在 `kubectl logs` 一眼可读。**不用 `sys.exit(0)` 或降级**——静默降级会让"缺表"变成
首请求 500，正是本次事故的同类伪装。

### D4：计时日志一行一模块，字段固定

`boot.schema module=catalog phase=create elapsed=1.23s` / `boot.schema total elapsed=62.40s`。
字段固定便于 grep 与后续做看板；不打印连接串、库名之外的任何环境信息（凭据纪律）。

### D5：部署侧环境变量走既有 Secret，不写字面量

`deploy/k8s/fd-wire-api.yaml` 通过 `fd-wire-env` 的 `secretKeyRef` 注入两个键
（`boot_auto_create_tables` / `boot_schema_check`）。**同一 env 名只声明一次**——
本仓踩过"同名 env 字面量覆盖 secretKeyRef、Argo 仍报 Synced"的坑。

## Risks / Trade-offs

- **生产某模块没有迁移覆盖，关掉建表后该模块的表不存在** → 先用 `warn` 跑一轮，拿到缺失清单；
  有缺口的模块把它的逐模块开关保持 `=1`，或补迁移。迁移未跑全前不许上 `strict`。
  已抽查 `catalog` / `console` 的表均有迁移建表（0002 / 0015 / 0027 / 0029），但**以反射差集为准**。
- **发布顺序错会导致启动期建表刚好是唯一屏障** → 迁移计划里固定顺序：**先跑 Alembic →
  再关总开关**；回滚只需把总开关设回 `1`（或删掉 env），不涉及数据变更。
- **校验反射在超大库上也可能慢** → 每库一次 `get_table_names()` 是单条系统目录查询，
  与表数量近似线性但无网络往返叠加；实测 `init_db()` 单模块 13s 的主因是逐表往返，不是反射本身。
- **测试 fixture 依赖 import 期建表** → 缺省开启保证零漂移；新增用例显式设置开关，
  不让"默认值"成为隐性依赖。

## Migration Plan

1. 合入代码（缺省行为不变，生产无感）。
2. 生产设 `FD_WIRE_BOOT_AUTO_CREATE_TABLES=0` + `FD_WIRE_BOOT_SCHEMA_CHECK=warn`，观察启动日志
   与缺失表清单。
3. 按清单补迁移或保留个别模块开关；清单清空后再考虑 `strict`。
4. 回滚：`FD_WIRE_BOOT_AUTO_CREATE_TABLES=1`（或删除该 env）→ 完全回到现状。
   `startupProbe` 保留，与本次改动互不依赖。

## Open Questions

- 是否需要在 `/health` 里暴露"启动耗时"以便拨测？（本期只落日志，够用；要看板另立。）
- `console/db.py` 是否也有 Alembic 覆盖？→ **已查：有**（0015/0027/0029 建 `console_onboardings` /
  `customer_members` / `member_preferences`）。仍以实现时的反射差集为准。
