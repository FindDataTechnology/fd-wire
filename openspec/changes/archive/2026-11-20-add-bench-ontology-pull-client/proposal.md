# 提案：知验台本体拉取客户端（bench→wire 消费通道，C3 姊妹 change）

## Why

law-bench C3（`knowledge-distribution`，sha-43f7063 已上 spec）落了发布-拉取契约与机器拉取面（`GET /api/v1/distribution/{domain_key}/ontology`，X-Consumer-Token 三态鉴权，8 键载荷形状钉死在其路由 docstring）。P1 交付判据「wire 拉到 v1 本体快照并落库」的最后一跳在 wire 侧：需要一个拉取客户端把平台发布的本体快照取回并落进 wire 本地语义层存储，供 entity-layer/目录/MCP 工具面消费。总纲裁定 wire=拉取方（保存到本地单独处理，松耦合，升级自主）——本 change 兑现消费端。

## What Changes

- **拉取客户端（bench_pull 客户端模块）**：单函数命令式客户端——拉取指定域快照（版本缺省最新）、digest 记录、401/403/404 如实透传报错不吞；凭据只经 env（`BENCH_PULL_URL`、`BENCH_CONSUMER_TOKEN`），永不落仓不进日志（沿 wire-connector 同款脱敏纪律，方向相反：那次 wire=服务方，这次 wire=消费方）。
- **本地落库（一次迁移 0052）**：`bench_ontology_snapshots` 表存拉到的快照（domain/version/digest/payload JSONB/pulled_at）+ `bench_pull_log`（每次拉取一行：版本、digest、成败、错误摘要）——落库幂等按 (domain, digest) 唯一，重复拉同版本不重复落行。
- **消费投影（增量面）**：快照 payload 按 C3 契约形状解包，暴露只读查询面（按 kind 列实体/关系、关系按结构化 from/to 重建两端身份——沿用 C2/C3 的 `{from}->{kind}:{to}` 键约定，无需第二套身份解析）；**非目标：不自动写回 wire 自有 entities 表**（那是另一条编辑语义，涉及归因与 ACL，挂后续），本 change 只做「拉到、存好、可查」。
- **定时拉取（可选cron）**：沿 wire 既有 scheduler 模式，env 可关；失败如实记录不误标成功。
- 非目标：写回 wire entities（后续）、pull 面 Web UI（JSON 面先够用）、多域批量编排（单域多版本已够 P1 判据）、缓存/限流。

## Capabilities

### New Capabilities

- `bench-ontology-pull`: 知验台本体消费通道——拉取客户端、本地快照落库与幂等、只读投影查询面、定时拉取与失败纪律

## Impact

- **代码**：`api/fd_wire_api/bench_pull/`（client.py + store.py + projection.py + routes.py，沿 demands 内部端点模式组织）；`api/migrations` 0052 一档两表；`app.py` 路由注册 + 可选 scheduler。
- **配置**：`BENCH_PULL_URL`（如 `https://<bench-host>`）、`BENCH_CONSUMER_TOKEN`、`BENCH_PULL_DOMAINS`（逗号分隔域 key）、`BENCH_PULL_ENABLED`（cron 开关）；缺凭据启动不崩（客户端惰性报错，沿 connector 「缺凭据如实报错不触网」先例）。
- **既有行为**：entities/console/demands 面零变化；不动 wire-connector（升格-回写环）；0052 纯新增表。
- **测试**：客户端三态透传（401/403/404+网络错误）、落库幂等（同 digest 不重落）、投影查询（键约定重建身份）、cron 失败纪律、跨客户隔离（快照表全域共享不挂客户 tenant——平台级数据）。
