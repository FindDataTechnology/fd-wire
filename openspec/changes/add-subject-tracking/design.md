# Design

## Context

见 `proposal.md` — Why。实现约束来自现场代码（只列解释方案所需的部分）：

- **`fd_mcp_client` + `NativeMcpClient` 是唯一出站形态**：`datasets/indicator_fetch.py` 已用它调 business-mcp 的 `indicator_series_read`（`mcp_url` 拼 `/mcp`、平台凭据 `INDICATOR_FETCH_TOKEN`）。Subject 的 indicators/registry/graph/context 四通道复用**同一形态**，只是换工具名与参数。
- **`fd-info` 的调用另有一条既成路径**：`artifacts/info_contract.py` 的 `InfoClient`（薄 client 调 `list_since`），由 `FD_INFO_URL` 注入、可被测试假实现替换。announcements 通道复用它，只是多传 Change 1 的 `source_codes` 参数。
- **引擎派生配方住引擎，不在 wire-api**：`derive_refresh` 靠 `customer_dataset_derive_refresh` 让 cell 按存档 spec 重放；cell 只认识自己的数据根，**不认识 fd-info / ia35 / business-mcp**。因此 Subject 快照**不能**做成引擎可刷新的派生集——它只能在 wire-api 侧扇出后落 api 层行存储。这是本设计与 `wire-dataset-link`（引擎侧 link）的根本不同。
- **`storage_tier` 由客户档位派生**（`service.storage_tier_for`），query 契约按它分流 `api_store` vs 引擎。**关键边界**：Subject 快照数据物理上落在 api 层行存储，若沿用客户档位派生出的 `storage_tier=cell`，查询会被错误路由到引擎而失败。
- 所有既有面（alert / schedule / dashboard query / market）都以「客户数据集」为统一消费对象，只认 `dataset_id`。

## Goals / Non-Goals

**Goals**
- 主体对象 + 5 通道扇出 + 快照数据集，接入既有面零特化。
- 每通道如实三态（`available/stale/unavailable`），不把「不可用」渲染成「0 条」。
- 物化幂等、失败零半写、行数/存储闸照既有建集。
- 通道失败隔离：一个通道挂了不拖垮整次读取。

**Non-Goals**
- 不做服务端统计推断（相关性/领先滞后/传导）——归 pack 层 `chain-transmission`。
- 不做跨源实体对齐（cninfo 的 `600519` 与 fd-open-data 的 `stock:600519` 不在本层 join；`ref.source` 声明用哪种来源就用哪种）。
- 不新增 web 页面、不新增面板类型、不改告警/看板/市场代码。
- 不做 person 类（普通自然人实体今天无数据面，见 proposal 缺口）。

## Decisions

### D1 Subject 住 fd-wire，数据从兄弟线读

主体是「客户针对谁的持续追踪意图」，是客户域对象（与 `wire-entity-layer` 的客户自有实体同类），不属于共享读取面。数据依旧经 business-mcp / fd-info 读。符合 `ROADMAP-v2`「共享源搜索→business-mcp；客户自有对象→wire」的既有切分。

**替代方案**（主体放 business-mcp）：否决——business-mcp 是共享实例、无客户域状态，放不进去。

### D2 快照 = wire-api 侧扇出后落 api 层，`storage_tier` 显式锁 api

快照数据集登记时**显式** `storage_tier = TIER_API`（不沿客户档位派生），因为：
- 数据由 wire-api 扇出产生、落在 `api_store` 行存储（`dataset_rows`），物理上就是 api 层；
- 若标成 cell，query 契约会把它路由到不认识这些数据的引擎，必失败。

这是 D2 的核心诚实点：**数据在哪就标哪**，不因客户付费档而伪装。cell 档客户也能用 Subject，只是该快照数据集的本体存 api 层（与「指标建集」在 cell 档走引擎 ingest 不同——那个是引擎能重放的数据，subject 不是）。

**替代方案**（把扇出逻辑下沉进引擎做成 derive 配方）：否决——引擎不认识外部 MCP 源，且会让 wire-api 的通道投影逻辑泄漏进引擎镜像（`cell-image`），边界更糟。

### D3 通道投影器是纯适配层，一次读取扇出

```
SubjectStore (DB)                 ChannelProjector (pure-ish)        Upstream
  subject row      ──read───▶  indicators  → NativeMcpClient → business-mcp
  channels[]       ──read───▶  announcements → InfoClient    → fd-info
                              registry     → NativeMcpClient → business-mcp
                              graph        → NativeMcpClient → business-mcp
                              context      → NativeMcpClient → business-mcp
```

每个 projector：入参 `(subject.ref, channel.spec)`，出参统一形状 `{type, status, coverage, rows, as_of, errors?}`。projector 之间不共享状态，扇出时逐个调用、逐个 try 包裹（失败隔离）。client 可注入（测试用假实现，照 `info_contract.py` 的 `InfoClient` 协议先例）。

**备选**（一个巨型 projector 按类型分派）：否决——五个通道的入参/出参/降级语义各不同，拆开才能各自单测、各自注入假 client。

### D4 时间轴合并按日期，事件携带来源引用

`timeline` = 把所有通道的 `rows` 归一成 `{date, channel, summary, ref}` 后按 `date DESC` 合并。`ref` 指回原通道行（如 announcements 的 `item_id`、indicators 的 `{indicator_id, date}`）。**不推断因果、不排序成「因果链」**——只是时间对齐的事实视图。统计归 pack。

### D5 幂等物化键 = `(customer_id, source_kind="subject", source_ref=subject_id)`

同主体快照落同一数据集（查既有则更新行、不新建）。行重建语义：先按 dataset 删除旧 `dataset_rows` 再写新行（api_store 既有能力），整段在一个事务里，失败回滚零半写。`source_ref` 存 subject 的稳定标识（id）。

### D6 调度第三类目标：executor 加一个 `execute_subject` 分支

`refresh_schedules.target_type` 词表加 `subject`；`executor.execute_subject` 调用与手动 `wire_subject_snapshot` 同一实现（`subjects.service.snapshot(...)`），保证手动/定时行为零漂移；主体删除 → 抛 `TargetGone` → 调度循环自动清理（复用既有语义）。间隔地板 60 分钟（扇出会打多个上游，比 artifact 的 AI 便宜、比纯 dataset 贵，取 dataset 档）。

### D7 覆盖三态由 projector 判定，不由调用方猜

- `available`：上游成功且返回 ≥1 行或明确的「窗口内无条目」。
- `stale`：上游成功但 `as_of`（数据截至）超过通道声明的容忍滞后（如 announcements 声明 24h）——沿用 fd-info `stream_health` 的滞后口径，不另造阈值。
- `unavailable`：上游不可达 / 该源不支持主体归属（如 announcements 通道撞上 Change 1 的 `sources_lack_entity_attribution`）/ ref 解析不到。

「窗口内无条目」是 `available` + 空 `rows`，**不是** `unavailable`——这是本设计与柏讯所有分析面共用的诚实口径。

## Risks / Trade-offs

- [快照数据集标 api 层，cell 客户在数据面路由] → D2 已定；query 契约按 `dataset.storage_tier` 分流，标 api 即走 api_store。需在 `_indicator_common_row` 类比处确认登记时显式写 tier（已有先例：`_indicator_materialize_local` 设 `dataset.storage_tier = TIER_API`）。
- [扇出打多上游，慢] → 各 client 侧限并行/限超时（照 `indicator_fetch_timeout_seconds`）；单通道超时记 `unavailable` 不拖整次。
- [行数闸对宽时间轴] → 快照行 = 对齐事件数，受各通道 limit 钳制（announcements limit≤200、indicators 指标数×点数）；超闸整批拒绝零半写，与既有建集一致。
- [`ref` 解析依赖上游实体存在] → 解析不到即 `unavailable` 如实呈现，不猜；这是 v1 的诚实边界。
- [通道投影器客户端要能注入测试] → 照 `info_contract.InfoClient` 协议 + `_engine_factory_override`/`_tool_executor_factory_override` 先例，全部走模块级 override 钩子。

## Migration Plan

1. **前置**：Change 1 `add-info-entity-filter` 上产（announcements 通道依赖 `list_since(source_codes=...)`）。未上产时 announcements 通道如实 `unavailable`，其余通道可用——可灰度。
2. 合入 subjects slice + 迁移（新表 `subjects` / `subject_channels`；`refresh_schedules.target_type` 词表放宽）。若用 SQLite 则复用 `refresh_schedules` 既有库新增列/新库表；迁移按 fd-wire `release-with-migrations.md` 纪律。
3. app.py 挂载 router；workbench 加 section；wire-ops-mcp 加 7 工具并更新 `tool-surface.json`（工具数断言同步）。
4. 回滚：subjects 是新增对象，无存量依赖；`target_type` 放宽是向后兼容；关闭工具面即可退回。

## Open Questions

- ~~subject 表落哪个库~~ **已拍板（实施期）**：subject 与 datasets 同库（`FD_WIRE_DATASETS_DATABASE_URL` → 生产 `wire_datasets`），使快照物化（subject + 数据集行）同一事务；生产迁移 `0056_subject_tracking`（revision 链 0055→0056），对 `wire_datasets` 跑 `upgrade head` 建表。
