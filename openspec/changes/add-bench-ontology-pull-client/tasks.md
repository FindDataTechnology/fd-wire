# 任务：add-bench-ontology-pull-client

## 1. 数据层

- [x] 1.1 迁移 0052：`bench_ontology_snapshots`（UNIQUE (domain_key, digest)，append-only）+ `bench_pull_log`（成败与错误摘要），alembic down_revision=0051（SQLite/PG 双方言沿 `_JSON_DUAL` 惯例；upgrade/downgrade/re-run 全验）

## 2. 客户端与落库

- [x] 2.1 `bench_pull/client.py`：`pull_ontology`（版本缺省最新、超时 10s、401/403/404/网络错误专用异常如实透传对端语义、token 脱敏（min-length 守卫防误伤短串）、凭据惰性读取缺失报明 env 名；`transport=` 注入缝供 MockTransport）
- [x] 2.2 `bench_pull/store.py`：`save_snapshot` ON CONFLICT (domain_key, digest) 幂等 + `log_pull` + `list_snapshots/get_latest` + `pull_and_store` 单一写径编排（成功/失败日志纪律单点收口）；快照表无更新删除路径
- [x] 2.3 `bench_pull/projection.py`：`list_domains/list_versions/list_entities/list_relationships` + `rebuild_identity`（键约定 `{from_key}->{kind}:{to_key}` 本地复述，来源标注 sha-43f7063；宽容读+核心键严格）

## 3. 路由与调度

- [x] 3.1 内部只读端点 + 手动触发 pull（`X-Internal-Token` 复用 demands `_require_internal`）；错误映射 Auth/Transport→502（对端语义保留）、Config→503（报明 env）、NotFound→404 透传；无快照域返回空集+状态标记
- [x] 3.2 可选定时拉取（`BENCH_PULL_ENABLED` 缺省 false no-op、`BENCH_PULL_DOMAINS` 去重保序、`BENCH_PULL_INTERVAL_SECONDS` 缺省 3600、逐域失败不中断、asyncio.to_thread 包裹阻塞 IO）；env 文档落 `deploy/README.md`（5 个 vars）

## 4. 测试

- [x] 4.1 契约测试（MockTransport）：8 键形状 fixture 全链 client→store→projection；对端 401/403/404 语义透传（六种消息逐字保留且两两区分）；对端回显 token 时消息零泄露（`***` 脱敏）
- [x] 4.2 落库幂等：同 digest 二拉零新行、拉取日志两条、历史版本冻结、pull_and_store 失败零快照行
- [x] 4.3 投影：关系身份重建（结构化 from/to + 键约定 + 端点回退）、空域空集、未知键宽容/核心键缺失报错
- [x] 4.4 调度纪律：单域失败其余继续（ok=1/failed=1）、失败入 log、enabled=false no-op、interval 解析边界
- [x] 4.5 全量既有测试零回归（bench_pull 范围内 1835 绿；并发 change `add-self-serve-cell-provision` 的 0053 迁移头 pin 撞挂账归该 change 修）

## 5. 收口

- [x] 5.1 `openspec validate add-bench-ontology-pull-client --strict` 绿
- [ ] 5.2 对 law-bench 真环境联调一次（真凭据拉 v1 落库）记录证据；blueprint 台账更新（P1 判据收口）——挂账：需 bench 生产发布 v1 + wire 侧登记消费者凭据，双前置就绪后执行
