# 设计：知验台本体拉取客户端

总纲：law-bench `docs/knowledge-platform-blueprint.md` §六（C3 姊妹）。对端契约：law-bench `knowledge-distribution` spec + 其 `src/web/routes/distribution.py` docstring（8 键载荷形状）。

## D1 依赖方向与复用边界

- wire 侧**零新增依赖**：HTTP 用既有 httpx（demands 面在用，核实版本）；无 PyYAML 需求（只拉 json，yaml 是对端格式兼容项不是消费必需）；
- 不 import law-bench 任何东西（松耦合铁律：对端契约只有 HTTP+8 键 JSON 形状，键形状以 C3 路由 docstring 为准在本仓 docstring 复述一份并标注来源 sha-43f7063，双仓漂移风险由契约测试兜底——见 D5）。

## D2 数据模型（0052 一档两表，沿 wire alembic 惯例）

```
bench_ontology_snapshots  id BIGINT identity PK, domain_key TEXT NOT NULL, version INTEGER NOT NULL,
                          digest TEXT NOT NULL, payload JSONB NOT NULL, pulled_at TIMESTAMPTZ DEFAULT now(),
                          UNIQUE (domain_key, digest)
bench_pull_log            id BIGINT identity PK, domain_key TEXT NOT NULL, version INTEGER NULL,
                          digest TEXT NULL, ok BOOLEAN NOT NULL, error TEXT NULL, pulled_at TIMESTAMPTZ DEFAULT now()
```

- 快照表无 UPDATE/DELETE 路径（append-only；版本内容冻结靠 UNIQUE(domain,digest) 天然幂等）；
- 平台级数据：不挂 customer_id/tenant（与 wire 客户租户表刻意分离）；运营读面走内部端点鉴权（沿 `demands` 的 `X-Internal-Token` 先例）。

## D3 模块组织（`api/fd_wire_api/bench_pull/`）

- `client.py`：`pull_ontology(*, domain_key, version=None) -> dict`——requests/httpx 单发 GET，超时 10s；401/403/404/网络错误各自抛专用异常（`PullAuthError`/`PullNotFoundError`/`PullTransportError`，消息保留对端语义，脱敏 token）；凭据 `BENCH_PULL_URL`/`BENCH_CONSUMER_TOKEN` 惰性读取（函数内 os.environ，缺失时 raise `PullConfigError` 指明缺哪个）；
- `store.py`：`save_snapshot(conn, *, domain_key, version, digest, payload) -> dict`（ON CONFLICT (domain_key,digest) DO NOTHING + SELECT 既有行返回，幂等）+ `log_pull(...)` + `list_snapshots/get_latest`;
- `projection.py`：`list_domains() / list_versions(domain) / list_entities(domain, version=None, kind=None) / list_relationships(domain, version=None)`——payload 解包，关系身份重建纯函数 `rebuild_identity(rel) -> {from_key, kind, to_key, external_key}`（键约定 `{from_key}->{kind}:{to_key}` 本地复述）；
- `routes.py`：内部只读端点 `GET /api/v1/internal/bench-ontology/{domain_key}/...`（X-Internal-Token，沿 demands `_require_internal` 先例）+ `POST /api/v1/internal/bench-ontology/{domain_key}/pull`（手动触发，同鉴权）。

## D4 定时拉取

`app.py` lifespan 沿既有 scheduler 模式（entity-layer 版本调度同款）：`BENCH_PULL_ENABLED=true` 时按 env 间隔轮询 `BENCH_PULL_DOMAINS`；逐域 try/except，单域失败 log+入 pull_log 不中断；`BENCH_PULL_ENABLED` 缺省 false（零配置部署零行为变化）。

## D5 契约测试（防双仓漂移）

`tests/test_bench_pull_contract.py` 用本地 fixture JSON（按 C3 8 键形状手造）跑 client→store→projection 全链（httpx MockTransport，不触真网）：形状变更会在这里先红。真端到端联调（真 bench 环境）挂 apply 后手动验一次，不入 CI。

## D6 风险与非目标

- 风险①：对端载荷形状演进——键集变更属 C3 spec 级变更，本仓投影按「未知键忽略、已知键缺失报错」处理（宽容读+核心键严格）；
- 风险②：快照体积（大域）——P1 规模小，JSONB 整存；分页挂后续；
- 非目标（proposal 已列）：不写回 wire entities（编辑语义+归因+ACL，后续另立）、无 Web UI、无多域编排、无缓存。
