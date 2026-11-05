# 簇 A 体检报告 — 计量/计费/身份/租户（13 模块）

审计日 2026-11-05。fd-wire HEAD=5b782f2（2026-11-05 20:45）；部署镜像 sha-1c5dfc5，`git merge-base --is-ancestor 1c5dfc5 HEAD` → 是（其后仅 b3798ad 滚版记录 + 5b782f2 openspec 归档移动，无 api 代码漂移）。R 根=/Users/chengsishi/finddata/openspec/specs/（非 git，stat mtime），W 根=fd-wire/openspec/specs/。所有时间均为 git log / stat 实测。

---

## 1. wire-facade-metering（R 根）— 评级 B

一句理由：计量管道本体扎实且 spec 刚做事故复盘加固，但 rows_returned 戳的生产半边（registry）不在本仓治理内，曾静默断流一个月。

- ① 对齐：逐调用计量+rows_returned 依据 → api/fd_wire_api/metering/normalize.py:42 `extract_rows_returned`（4 条候选路径 :34-38）、缺戳异常留痕 normalize.py:28 `REASON_MISSING_ROWS`；按客户聚合 → metering/routes.py:151-160（SUM(rows_returned)）。余额预检 402 fail-closed 的 wire 侧探针 → billing/routes.py:152-174 `/internal/quota/{caller}`（未知 caller 404 fail-closed）；转发与戳的生产半边在 registry（fd-infra-deploy/mcp-registry/prod/registry.yaml，mcp-auth-server sha-0cd5e51 镜像注释「rows_returned 戳 fd-audit-rows-stamp@0cd5e516」）。cell 同门计量 → metering/normalize.py:141 `resolve_credential_track`。
- ② 测试：api/tests/test_metering_{driver,ingest,migrations,poller,support,usage}.py 共 6 文件存在（mtime 2026-10-05 ~ 10-11）。
- ③ 部署：wire 侧随主服务 sha-1c5dfc5（新鲜）；registry 侧 registry.yaml 最后提交 2026-11-04（新鲜），mcpgw 钉上游 1.32.0。
- ④ 痛感：spec:74-76 自录事故——2026-10-08 起 rows_returned 戳静默丢失、计量链断流一个月；registry 侧 10-13 双件滚补戳（fd-infra 69a584f/f73de2d）；10-29 nginx 僵死事故补防（a07be8a）。中等偏高。
- ⑤ 陈旧：R spec mtime 2026-11-04（事故复盘刚改）vs metering 代码最近 commit 2026-10-11（695105c）→ spec 领先 24 天，方向健康，非 stale。

## 2. metering-poll-channel（W 根）— 评级 B

一句理由：直读+推送双通道与竞态安全均已落地，但「可达性探针闸门」停留在运维口径，代码侧未配置 Mongo 时是静默跳过（fail-quiet），与「不静默丢账」有张力。

- ① 对齐：直读 → metering/registry_poller.py:96 `poll_registry_once`（:72 未配置 REGISTRY_MONGO_URI 抛 RuntimeError，driver.py 侧未配置静默跳过）；推送 → metering/routes.py:64 `ingest_push`（同一张表）；竞态安全 → metering/ingest.py:53-69 `_insert_on_conflict_do_nothing`（PG/SQLite 双方言 :63-67，对应 spec「双方言一致」场景）。10 分钟入账目标 → driver.py:33-34 间隔默认 300s。
- ② 测试：test_metering_poller.py、test_metering_ingest.py、test_metering_migrations.py（mtime 2026-10-05/10-11）。
- ③ 部署：随主服务 sha-1c5dfc5，无独立清单。
- ④ 痛感：695105c（2026-10-11）摄取竞态安全——并发同键炸批的实修，1 次修复类 commit。
- ⑤ 陈旧：spec 2026-10-11 vs 代码 2026-10-11 → 剪刀差 0 天。
- 备注：探针不过「不得宣称通道建成」的闸门为流程性约束，代码无显式探针端点；生产当前走直读还是推送**未证实**（需运行态确认）。

## 3. usage-transparency（W 根）— 评级 A-

一句理由：自助查量、跨客户隔离、口径同源三点全部有实现与测试，spec 小而新鲜。

- ① 对齐：`GET /api/console/usage` → api/fd_wire_api/console/routes.py:163-164（console/routes.py:11-12 注释明示与额度查询、admin usage 同源 monthly_used_lines）；额度查询 → billing/routes.py:152-174；跨客户隔离 → bearer 身份解析（console/auth.py:177 `resolve_customer`），test_console_api.py:195-207 含 401 与 X-Customer-Id 拒绝断言；前端 → web/src/console/UsagePage.tsx:2（数据源 GET /api/console/usage）。
- ② 测试：test_console_api.py:11-14（6.1 usage 契约+跨客户隔离+enforce_balance+未知 caller 404）、test_metering_usage.py（mtime 2026-10-05）。
- ③ 部署：随主服务 sha-1c5dfc5。
- ④ 痛感：近 30 天该面无 fix 类 commit（7fae9e5 10-09 落地后稳定）。
- ⑤ 陈旧：spec 2026-10-10 vs console 面最近 commit 2026-10-31 → 剪刀差 <30 天（后续大提交为别的能力，非本 spec 漂移）。

## 4. wire-billing（R 根）— 评级 C

一句理由：账本权威/幂等结算/两档预警/对账实现与测试齐备，但 R spec「套餐与按行超额」与部署态计费模型（全部档位零超额）正面矛盾——spec 实质性 stale。

- ① 对齐：账本+幂等结算 → billing/settle.py:1-14（settle 键一月一键、sub2api.adjustBalance 幂等、失败不写账下轮重放）；对账 → billing/reconcile.py（132 行）；两档预警 → billing/notices.py:20 `USAGE_WARNING_TIERS=(80,95)`（唯一约束兜底只发一次）；硬停 → 行数门承担（billing/routes.py:11-12、settle.py:161）。AI 探索/物化归属 → metering credential track（normalize.py:141）+ billing/metering_source.py（146 行）。需求单独立记账 → 未在本簇文件发现独立实现入口（**未证实**，可能在 demands 簇）。
- ② 测试：test_billing_{common,ledger,models,notices,reconcile,settle,sub2api_client}.py 共 7 文件（mtime 2026-10-05 ~ 10-11）。
- ③ 部署：随主服务 sha-1c5dfc5。
- ④ 痛感：10 commits，含 2 次实修——f226cae「sub2api 客户端按生产实测契约重写……销账 lex-platform-v1 跨线挂账 #1」、8da8157「init_billing resolves DATABASE_URL env (prod cwd-unwritable)」。中等。
- ⑤ 陈旧：R spec mtime 2026-10-06 vs portal-pricing 裁决落地（plans.py 注释「portal-pricing 裁决，超额单价一律 0」billing/plans.py:44-49）→ **spec 落后裁决 14 天且内容相抵**（spec:11「超出部分按行单价计费」 vs 代码零超额）。
- 证据：R spec /Users/chengsishi/finddata/openspec/specs/wire-billing/spec.md:11,17-19；W spec portal-pricing/spec.md:10；代码 billing/plans.py:52-56（free/basic/standard overage="0"）。

## 5. portal-pricing（W 根）— 评级 A-

一句理由：四档模型、公开端点、后台可配、旧档退场四条全部有实现与测试钉住，web 活取无面量。

- ① 对齐：种子档位 → billing/plans.py:44-79（PUBLIC_SEEDS free ¥0/1000 行、basic ¥10/10 万行、standard ¥50/100 万行，overage 全 0；LEGACY_SEEDS 旧三档 is_active=False）；公开端点 → billing/routes.py:35 + app.py:128（`GET /api/v1/plans` 无鉴权，仅 is_public && is_active，plans.py:134-143）；自定义档 → admin/routes.py:151-189 `create_custom_plan`（恒 is_public=false，409 冲突）；改价不发版 → admin/routes.py:143 `GET /plans` + POST /plans；web 活取 → web/src/pricing/api.ts:22（GET /api/v1/plans）、PricingView.tsx:2。
- ② 测试：test_billing_models.py:28 `test_plan_seeds_adjudicated_values`（裁决值逐字钉住）、test_admin_api.py:321-326（旧三档禁用标记）。
- ③ 部署：api 随主服务；web 镜像同 sha-1c5dfc5（deploy/k8s/fd-wire-web.yaml）。
- ④ 痛感：757db0f（10-13）「档位下拉=活跃档∪当前档、新建客户不预选档（starter 默认值缺陷）」1 次修复。低。
- ⑤ 陈旧：spec 2026-10-10 vs plans.py 最近改动（billing 目录 2026-10-15）→ 剪刀差 5 天。

## 6. free-tier-data（W 根）— 评级 B

一句理由：api 层数据集/限额/档位闸/配额降级/同名守卫实现完整且测试在位，但同名守卫上线时踩过一次生产迁移事故，收敛后不足一月。

- ① 对齐：api 层数据集 → datasets/models.py:104 `storage_tier`（默认 cell）；免费限额 → datasets/service.py:133 `storage_limit_for`、routes.py:991-998 quota 端点（max_* null=fail-closed 口径）；付费档位闸 403 → datasets/routes.py:215-220（api 层数据集耦合路径拒）；配额未知降级 → web/src/console/DatasetsPage.tsx:540-541（max_*==null 中性提示分支）、:294；档位确定性解析+同名守卫 → service.py:300 `plan_code_for` + 迁移 api/alembic/versions/20261015_0037_billing_customer_name_uq.py:12-16（孤儿行 `#orphan-<id>` 自愈改名 + `uq_billing_customers_name` 唯一索引）。
- ② 测试：test_datasets_free_tier.py（mtime 2026-10-13）单文件承载；配额条降级场景前端测试**未证实**（未见 dedicated web test 命中）。
- ③ 部署：随主服务 sha-1c5dfc5（含迁移 0037，生产已跑）。
- ④ 痛感：ad41732「迁移 0037 revision id 缩短……生产首跑 StringDataRightTruncation」+ 0037 文件头自录「当日手工把孤儿行改名 `<name>#orphan-std` 止血」——1 次生产事故 + 手工止血。中。
- ⑤ 陈旧：spec 2026-10-15 vs datasets 最近 commit 2026-10-31（Wave B2，非本能力漂移）→ 16 天，未超限。

## 7. wire-customer-identity（R 根）— 评级 B

一句理由：内外隔离、成员角色、sub2api 代管、key 自助铸吊均有实现，但 R spec 停在 10-06，其后 W 侧 console-auth/customer-key-minting 演进出的登录边界与代铸语义未回灌 R 根；充值人工通道的产品面落点未证实。

- ① 对齐：内外隔离+角色 → console/auth.py:184 `resolve_member_role`（owner/member）、:254 `require_console_customer_actor`、:335 `require_console_owner`（member 不可动密钥/账务的闸）；key 自助铸造/吊销 → console KeysPage（web/src/console/KeysPage.tsx）+ console/onboarding.py:120-170（mint/revoke 通道）；支付凭据不暴露 → admin/routes.py:190-215 `create_customer`（自动代建 sub2api 账户回写 sub2api_user_id；凭据面在平台侧 billing/sub2api.py）；成员邀请审计 → console/models.py:146（member.joined/removed/invite.created/invite.revoked）。
- ② 测试：test_console_api.py（mtime 2026-10-11）+ test_console_resilience.py（10-15）。
- ③ 部署：随主服务 sha-1c5dfc5；Logto 为外部 IdP（无本簇清单）。
- ④ 痛感：低-中（身份面无 fix 类 commit；5074202 resilience 三修含控制台韧性）。
- ⑤ 陈旧：R spec mtime 2026-10-06 vs console 代码 2026-10-31 → 剪刀差 25 天，逼近 30 天线；spec 未覆盖 OIDC 登录细节（W console-auth 已覆盖）。

## 8. console-auth（W 根）— 评级 A-

一句理由：OIDC 本地验签、sub 映射、双闸矩阵（含 503 fail-closed）、角色分流全链落地，测试钉住；唯一保留是分流实现细节未逐行核验。

- ① 对齐：ID token 本地校验 → console/auth.py:110-158（JWKS 签名+iss/aud/exp/iat，无 IdP 运行时同步调用）；sub↔Customer 映射+占位头退位 → auth.py:177/:286-291（「X-Customer-Id 不再被客户侧端点接受」）；双闸 → admin/auth.py:1-18（X-Admin-Token 常量时间比对 + Bearer wire-admin 角色；裁决矩阵含 Logto 未配置→503）+ datasets/connector_routes.py:654-656（概览端点同闸，依赖 require_admin_access）；web PKCE → web/src/console/auth.ts:1/:67/:178-243（sessionStorage，verifier 落会话）；角色显隐 → web/src/App.tsx:13（wire-admin 才渲染后台入口）。裸入口分流（spec:76-104）在 757db0f「分流摘壳」与 02998ee 有落点，逐行实现**未证实**。
- ② 测试：test_console_api.py、test_console_resilience.py（两文件均 10-11/10-15 修改）。
- ③ 部署：api+web 均 sha-1c5dfc5。
- ④ 痛感：757db0f（10-13 生产反馈五修：白屏/ErrorBoundary/页脚/档位下拉/overview 并双闸）+ ad41732（迁移 0037 生产首跑报错修复）——中等（多数为 UX 韧性而非身份逻辑）。
- ⑤ 陈旧：spec 2026-10-20 vs web/src/console/auth.ts 最近 commit 2026-10-20（02998ee）→ 0 天。

## 9. customer-key-minting（W 根）— 评级 A-

一句理由：代铸/代吊/通道不扩面三条全实现——本机自签 JWT 通道与集群侧 admin 代铸 API 双轨，退租自动化闭环，测试在位。

- ① 对齐：代铸指定归属与组 → cell-manager/cell_manager/keys.py:44-148（`sign_self_signed_jwt` HS256，groups=组快照，TTL 600s）+ :180-202 `AdminPatchKeyChannel`（显式 admin API 铸/吊，26e926a「铸 key 切 admin 代铸 API（4.3 收口）」）；代吊+幂等 → keys.py:148-178 `revoke`（revoked/already_revoked/not_found）；开户代铸接线 → console/onboarding.py:111-149（CELL_REGISTRY_TOKEN=平台 admin wgk-；簿记只落 key_id 明文不落库 :373）；根信任材料不出主机 → keys.py:5-14（CELL_REGISTRY_SECRET_KEY_FILE 只在 cheap-1）。
- ② 测试：cell-manager/tests/test_grant.py、test_registry_http.py（registry client 铸/吊 mock 面）。
- ③ 部署：cell-manager 不在 k8s 主清单（运维主机工具形态）；其产物（key/scope/预检映射）经 registry API 生效，registry 部署新鲜（2026-11-04）。cell-manager 自身版本管理**未证实**（无镜像清单命中）。
- ④ 痛感：26e926a/e53175c/1b14377 为授权束自动化收口链（10-09 ~ 10-12），fix 密度集中在退租链（见 cell-grant）。
- ⑤ 陈旧：spec 2026-10-09 vs keys.py/onboarding.py 最近 commit 2026-10-09/10-10 → 0-1 天。

## 10. wire-cell-tenancy（R 根）— 评级 A-

一句理由：cell 生命周期五动作、注册凭据自动化、存储演进（指向 cell-postgres-storage）全部有实现；paas 侧无 wire-cell 契约面属预期（萬星去处为后续增量）。

- ① 对齐：开通/暂停/恢复/注销 → cell-manager/cell_manager/manager.py:122 `provision`/:277 `pause`/:287 `resume`/:326 `purge`/:386 `purge_expired`（保留期清除）；注册凭据自动化 → cell_manager/config.py:17-19（CELL_REGISTRY_AUTH/TOKEN）+ manager.py provision 注册步（30ba42d「register 追加启用步」修复默认 disabled）；provision 失败原子回滚 → 77ee695（CELL_READINESS_TIMEOUT）；引擎无多租户概念 → 引擎在 DAAS 仓（internal-main 线），fd-wire 侧无 tenant 列（datasets 模型以单 cell 数据根为前提）。
- ② 测试：cell-manager/tests/test_lifecycle.py、test_retention.py、test_isolation.py、test_manager_storage.py。
- ③ 部署：cell-manager 为运维面工具（provision 动作在 cheap-1 执行），主服务清单不含之；cell 容器由 docker driver 拉起（drivers/docker.py）。
- ④ 痛感：22 commits 中 ≥6 次 fix（30ba42d/8bedec7/77ee695/e53175c/10b529e/ef2eb79/1b14377）集中在 provision/退租链——中高（见 cell-grant）。
- ⑤ 陈旧：R spec mtime 2026-10-07 vs cell-manager 最近 commit 2026-10-12（cee7fbf 配额下发）→ 5 天。
- 备注：paas 仓（壹座）grep `wire_cell|DAAS_DATABASE_URL|cell-key` 零命中——萬星去处契约尚未落地，与 spec「后续增量」一致，无矛盾。

## 11. cell-grant（W 根）— 评级 B

一句理由：授权束随开户自动铸/退租自动回收/跨客户隔离实现且测试在位，但退租链三周内 4 次 fix + R5(P0)/R6(P1) 缺陷入册，可靠性欠账刚还完。

- ① 对齐：开户自动授权 → cell_manager/grant.py:97 `grant`（_do 内 scope/组/预检映射一次完成）；跨客户隔离 → grant.py 按 customer_id 派生组/scope（config.py:368-376 cell_group/scope_name/customer_key_groups）+ 测试 test_isolation.py；回收 → grant.py:151 `revoke_customer_key`/:167 `revoke_all_customer_keys`/:182 `teardown_registry_face`/:227 `_delete_scope`（10b529e「scope 删除走 internal/delete-group（IdP 全跳过）」）；预检映射写入 → grant.py:256 `_write_preflight_map`（e53175c「失败即中止，不静默跳过」）；平台凭据不受限 → registry 侧 admin scope（对侧，代码不在本仓）。
- ② 测试：cell-manager/tests/test_grant.py、test_isolation.py。
- ③ 部署：同 cell-manager（运维面）；registry 对侧新鲜。
- ④ 痛感：ef2eb79「退租不因删 scope 失败卡死」、1b14377「退租收口补两处残留——purge 走 R5 通道+摘预检映射」、10b529e、e53175c + fd-wire docs/registry-requirements.md R5(DELETE 405 P0)/R6(计费账户缺失误分类 P1) 入册（b5292f9/291e6be）。高（4 fix/3 周，但已收敛）。
- ⑤ 陈旧：spec 2026-10-09 vs grant.py 最近 commit 2026-10-09（1b14377）→ 0 天。

## 12. cell-postgres-storage（W 根）— 评级 A-

一句理由：fd-wire 侧供给（cell-manager 七步建库+OpenBAO）与引擎侧（DAAS internal-main 双方言+配额）双侧齐备，双真腿测试在位，spec 0 漂移。

- ① 对齐：cell-manager 自动建库 → cell_manager/storage_pg.py（376 行，9ced37c「七步供给+隔离四查自动验证+purge 删库语义」）+ openbao.py（134 行，KV v2，路径前缀 wire/cell-db config.py:229）；CELL_STORAGE fail-closed → config.py:276-321（postgres 画像五项 env 必需）；配额下发 → config.py:230-231/:290-301（CELL_PG_QUOTA_MB 正整数校验）+ 容器 env 注入；引擎侧 → /Users/chengsishi/finddata/DAAS 分支 internal-main，fd-daas-mcp/customer-dataset-mcp/customer_dataset_tools.py:221-225/:3719（FD_CELL_STORAGE_QUOTA_MB 配额闸）+ tests/test_storage_quota.py；备份动态发现 → 9ced37c 注释（backup.sh wire_cell_% 动态发现）。
- ② 测试：cell-manager/tests/test_storage_pg.py + test_storage_pg_integration.py（双真腿）、test_openbao.py；引擎侧 test_storage_quota.py（internal-main 线）。
- ③ 部署：cell 侧为容器 env 形态（DAAS_DATABASE_URL 注入），engine 镜像线 internal-main（e5e2537 2026-10-31）；drill 试点（drillcust001）实弹验收**未复核**（验收记录在 docs/，本审计未逐条核对）。
- ④ 痛感：9ced37c/cee7fbf 为能力落地非修复；低。
- ⑤ 陈旧：spec 2026-10-12 vs storage_pg.py 2026-10-12 → 0 天；引擎侧 latest 10-31（同日随 wire-window-operator 前进，非漂移）。

## 13. fleet-service-accounts（W 根）— 评级 B

一句理由：发号/隔离/护栏/退役四条以运维脚本形态落地且 change 12/12 全勾，但无自动化测试、护栏靠 cron 脚本、生产狗粮运行状态未证实——能力太新，观察期未满。

- ① 对齐：发号幂等 → scripts/provision_service_account.py:6-22（ensure-org/provision/retire/probe/guard 五子命令；svc-fleet 组织、svc/<key> 服务客户、billing_customers 映射）；组织隔离+命名约定 → :26-28（ORG_NAME="svc-fleet"、EMAIL_DOMAIN、KEY_RE）；护栏巡检 → scripts/service_account_guard.sh:1-33（浏览器 UA=ALARM，Logto 审计 SQL）；退役 → provision_service_account.py retire（is_suspended+关服务客户，幂等）。
- ② 测试：**无**（ssh+docker exec psql 的运维脚本，无 api/tests 覆盖）——与 spec 场景的对应验证依赖 probe/guard 实跑。
- ③ 部署：脚本形态（xinru/cheap-3 双库），无 k8s 清单；cron 于 xinru-master（guard 脚本头注释）。
- ④ 痛感：仅 0f88e52 一次提交（10-31 能力落地），无 fix——太新，痛感样本不足。
- ⑤ 陈旧：spec 2026-11-01（归档日）vs scripts 2026-10-31 → 1 天。
- 备注：change archive/2026-11-01-add-fleet-service-accounts/tasks.md 12/12 `[x]` 全勾；狗粮迁移（Requirement 5）实跑效果**未证实**。

---

# 簇摘要 — 三件最严重的事

1. **O2 正面矛盾：R 根 wire-billing 与部署态计费模型相抵**。R spec（mtime 2026-10-06）要求「套餐月费含额度加超额按行计费」（spec.md:11,17-19），而 W portal-pricing（2026-10-10）与代码、部署全部按「零超额、到量即停」运行（billing/plans.py:44-56 overage 全 0；settle.py:161「硬停由当月行数门承担」）。两本账对「超额」给出相反语义，任何按 R spec 验收或对接的人都会得到错误口径。需要一次 R 根 change 修订（本审计不改 spec）。
2. **计量链的静默失败史与残留 fail-quiet 面**。rows_returned 戳曾无 change 记录静默丢失，致计量断流一个月（R spec:74-76 自录；registry 侧 10-13 才补上）；wire 侧竞态炸批 10-11 实修（695105c）。残留风险：driver 在 REGISTRY_MONGO_URI 未配置时静默跳过（driver.py:23-24、「_poll_once 未配置返回 None」），spec 的「探针不过不开闸」无代码级闸门，生产当前通道形态未证实——断流类事故的防回归仍靠人肉口径。
3. **cell 退租链路的可靠性欠账**。cell-grant/退租路径三周内 4 次 fix（ef2eb79 卡死、1b14377 残留、10b529e scope 405、e53175c 映射静默跳过），并产出 R5(P0)/R6(P1) 跨线缺陷入册（b5292f9）——退租是租户模型的合规红线（数据保留/注销清除），收敛不足一月，需在下一批客户退租前做一次实弹演练。

# O1-O4 裁决建议（拍板留给用户；本审计不改任何 spec）

**O1 计量（wire-facade-metering R vs metering-poll-channel W + usage-transparency W）**：三本 spec 无语义冲突，是「门面契约 / 归集通道 / 客户透明」的三层切分。R 根管 facade 行为与 registry 戳（含事故防回归条款），W 两本管 wire 侧通道与用量呈现。建议：维持三本分立，但在 R spec「逐调用计量记录」Requirement 处加一行 cross-ref 指向 metering-poll-channel（通道口径）与 usage-transparency（消费面），消除「计量」一词的三处定义漂移风险；metering-poll-channel 的「可达性闸门」应补一条代码级落点（探针端点或启动期 fail-loud），否则该 Requirement 长期停留在流程口径。风险点：R 根非 git 仓，mtime 无法追溯谁改的——建议把 facade 契约的后续演进迁回 git 治理（与既有 R/W 双根惯例对齐前先请用户裁决）。

**O2 计费（wire-billing R vs portal-pricing W + free-tier-data W）**：这是四组重叠中唯一真矛盾——R「超额按行」vs W「零超额到量即停」，代码与部署站 W（portal-pricing 裁决 2026-10-10，plans.py 种子+测试钉住）。建议：以 W 口径为准修订 R 根 wire-billing 的「套餐与按行超额」Requirement（改为月费含额+到量即停+可选自定义档询价），保留 R spec 仍然正确的部分（账本权威/幂等结算/硬停两档预警/AI 归属/需求单独立记账）；free-tier-data 与本矛盾无关，维持独立。同时 settle.py 的 overage 分支与 LEGACY_SEEDS 的非零超额单价（starter 0.004 等，仅禁用档保留可审计）是 R 旧口径的活化石，修订 spec 时应注明「仅禁用旧档保留历史单价字段，不构成现行计费模型」。

**O3 身份（wire-customer-identity R vs console-auth W + customer-key-minting W）**：R 管「身份模型与归属」（Logto org、长命 key 自助铸吊、sub2api 代管、成员角色），W console-auth 管「登录边界」（OIDC/PKCE/验签/双闸/分流），W customer-key-minting 管「平台代铸代吊语义」——互补无冲突：R 的「自助铸造」由 KeysPage 兑现，「平台代铸」由 customer-key-minting 兑现，二者权限面不同（用户自铸 vs 服务身份代铸）不重叠。建议：维持三本分立；R 根下次修订时补两条 cross-ref（登录边界见 console-auth、代铸见 customer-key-minting），并把 R spec 未覆盖的「充值走人工通道」落点核实后写入（当前实现证据未证实，属 R spec 落空的 Requirement，需要在 O3 裁决时一并决定是补实现还是改 spec）。

**O4 租户（wire-cell-tenancy R vs cell-grant W + cell-postgres-storage W；paas 对侧）**：R 管租户模型与生命周期（cell=企业、三去处、注册凭据自动化），W cell-grant 管 registry 授权束、cell-postgres-storage 管数据根演进——切分清晰、无冲突，且 cell-postgres-storage 的「存储演进不改变对外行为」正是 R spec 该 Requirement 的实施细节化。paas 仓（壹座）grep `wire_cell|DAAS_DATABASE_URL|cell-key` 零命中：萬星去处契约在 paas 侧尚无实现，与 R spec「后续增量」一致，**不构成契约缺口**；真正的对侧实现是 DAAS 仓 internal-main 线（引擎双腿）。建议：维持三本分立；O4 的行动项不是改 spec 而是补两处运行态验证——drill 试点实弹验收记录复核、退租 purge 删库（PG 画像）实弹演练（对应簇摘要第 3 条）。若未来萬星去处立项，应在 paas 侧新建独立 spec 而非扩写 wire-cell-tenancy。
