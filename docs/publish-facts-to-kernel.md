# 已发布 artifact → 事件内核（可手动跑的脚本，不做 cron）

`scripts/publish_facts_to_kernel.py` 把 `artifacts` 中 `status='published'` 且
`published_at` 非空的产物，按其发布版本锚点（`published_version`，缺省 `version`）
写一条 `marketing.content.published` 事件（`lane='ingest'`）。写入只经
`fd_erp_ledger_mcp.events.append_event`，不直写 SQL——只追加/定型/幂等必须走内核自己的门。

**为什么是手动脚本而不是 cron**：舰队回合本来就独占 cell 锁与数据库连接，常驻调度会在
回合中途抢锁；发布是低频、显式、需要人判断「何时同步」的动作。脚本可重放——同一批跑多少次
事件数都不变，所以补跑没有代价，不需要调度器保证「恰好一次」。

**幂等键口径**：`stable_id = f"{artifact_id}:v{version}"`，即 artifact + 版本，不是时间戳。
发布时间只进 `occurred_at`（事实发生时点），不参与去重；用时间戳做键会把每次重放变成新事实。

**回滚行为**：产物不再是 `published` 后，脚本不再产生新事实；已写事实不删不改。更正走内核
冲正（`reverse_event`），不在本适配器职责内——适配器只负责「不新增」。

**运行**：`ERP_LEDGER_DATABASE_URL` 指向内核库；`--tenant` 缺省取 `ERP_TENANT_ID`；
`--dry-run` 只打印、不连内核。兄弟仓位置可用 `ERP_LEDGER_KERNEL_ROOT` 覆盖。
