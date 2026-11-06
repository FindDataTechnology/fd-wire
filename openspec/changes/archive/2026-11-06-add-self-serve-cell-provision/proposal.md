# cell 开通自助化——付费升档即得 cell（add-self-serve-cell-provision）

## Why

付费客户升档后的「cell 配给」目前是纯运营手动链：cell-manager provision+grant（cheap1 宿主 CLI、每客户 identity map）→ socat relay → PATCH registry proxy_pass_url → AI_CELL_ENDPOINT_MAP 加行+出片——四步横跨宿主/集群/部署面，DocsView「上线中」徽标如实挂着，bcf57e3 的映射漏配咬过生产（本战役已补 create_customer 事前提醒，但那是护栏不是解）。self-serve-onboarding spec 的「Requirement: 升档扩权」明文承诺「cell 配给完成」——现网不成立，是本线最后一块「spec 承诺 vs 产品现实」缺口。

## 核心架构裁决（本提案要拍板的事）

1. **AI_CELL_ENDPOINT_MAP 从 env 迁库**：现役 env 显式口径（test_ai_infra 钉住）无法运行时追加——自助化要求 DB 化（`customer_cell_endpoints` 表：customer_id→registry 入口 URL+state），读路径改为「env map 优先（存量显式口径不动）→ DB 表兜底」，迁移期双源并存、测试语义保持「显式优先，未命中=未开通」。
2. **配给编排不走 API 直驱宿主**：cell-manager 是 cheap1 宿主 CLI（docker+PG 本地权限），fd-wire api 不应直连。采用**任务队列模式**：api 落 `cell_provision_requests` 行（升档事件触发），cheap1 侧轻量 runner（systemd timer/cron 拉队列，复用既有 CELL_* env 与审计面）执行 provision+grant+relay+PATCH registry，回写状态；幂等键=customer_id。
3. **失败即回退人工**：runner 任一步失败→请求标 failed+运营通知（common/mail）→回退现行手动链；Webhook/重试不做首期。

## What Changes

- api：`cell_provision_requests` 表+迁移；升档动作（admin 改档路径）落 request 行+未读运营提醒；`resolve_cell_endpoint` 读路径加 DB 兜底；admin 面新配给状态页（排队/执行中/完成/失败）。
- cheap1：`cell-manager` 新增 `runner` 子命令（轮询 fd-wire `/internal/cell-provision/next` 领任务→执行→回写），复用 provision/grant 全部既有幂等与审计。
- spec：self-serve-onboarding「升档扩权」Requirement 补自动配给 Scenario（spec 本已承诺，无需扩权）；ai-infra/endpoint-map 语义 delta（DB 兜底口径）；新 runner 契约小节。
- 非目标：免费档仍无 cell（spec 边界不动）；不做在线支付充值；不动既有 env map 三条存量映射的显式口径。

## Capabilities

### New Capabilities

（无——落在既有 self-serve-onboarding/ai-infra/新 runner 文档）

### Modified Capabilities

- `self-serve-onboarding`: 升档扩权 Requirement 补「自动配给链」Scenario 与 runner 失败回退语义。
- `ai-infra`: endpoint 解析加 DB 兜底源（env 显式口径不变为第一优先）。

## Impact

- **代码**：fd-wire api（表+迁移+读路径+admin 页+内部领任务端点）、cheap1 cell-manager（runner 子命令）。
- **生产**：cheap1 systemd timer 一个；fd-wire-api.yaml 无新 env（contact 模式复用现有 SMTP/INTERNAL_TOKEN）。
- **下游**：DocsView「上线中」徽标可摘；AI_CELL_ENDPOINT_MAP 人肉开户链退役（存量三行保留为第一优先显式口径）；bcf57e3 同型痛根治。
