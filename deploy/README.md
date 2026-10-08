# fd-wire 部署 runbook（wire-platform-v1 任务 3.4）

上线通道沿用 **tcr-image-pipeline**（GHA 构建推 TCR）+ **mcp-service-deploy**（ArgoCD/GitOps、不可变 sha- tag）既有模式。本仓工件：

| 工件 | 作用 |
|---|---|
| `api/Dockerfile` | FastAPI 镜像（python slim 两阶段、非 root、:8000、HEALTHCHECK /health） |
| `web/Dockerfile` + `web/nginx.conf` | Vite 构建 → nginx 静态托管（非 root、:8080、/ 与 /console SPA fallback、/mcp 占位注释） |
| `.github/workflows/build.yml` | push main → 双镜像推 TCR `ccr.ccs.tencentyun.com/fd-wire/{api,web}`，tag `sha-<7>` + 滚动 `main` |
| `deploy/k8s/fd-wire-api.yaml` | Deployment + Service（ClusterIP :8000），env ← Secret `fd-wire-env` |
| `deploy/k8s/fd-wire-web.yaml` | Deployment + Service（NodePort 31881 待台账确认） |
| `deploy/k8s/ingress.yaml` | Ingress 占位（host `wire.finddatatech.cloud`；实际上线路径=Caddy，见文件头注） |
| `deploy/argocd/application.yaml` | ArgoCD Application（源 gitee `FindDataTechnology/fd-wire`，path `deploy/k8s`，dest `fd-prod`） |

参照仓：`fd-wanxing/.github/workflows/images.yml`（一仓多镜像 matrix）、`fd-proxy-service/.github/workflows/image.yml`（TCR 模板与 secrets 命名）、`fd-infra-deploy/all-services/prod/wanxing-{facade,web}.yaml`（清单风格：labels、TODO(go-live) tag 回填、secretKeyRef、无明文 Secret）、`fd-infra-deploy/argocd/app-*.yaml`（Application 放同步路径之外）。

## Secret `fd-wire-env` 键名表（集群内创建，永不入 git）

与 `deploy/k8s/fd-wire-api.yaml` 的 secretKeyRef 引用**逐键一致**（15 键，按 manifest 引用顺序；对照方法：`grep -o 'secretKeyRef: { name: fd-wire-env, key: [a-z0-9_]* }' deploy/k8s/fd-wire-api.yaml`）：

| env（Deployment 引用名） | Secret key | 用途 |
|---|---|---|
| `DATABASE_URL` | `database_url` | wire 账本数据库 |
| `BUSINESS_MCP_URL` | `business_mcp_url` | 五库联邦工具（rows_returned 计量戳） |
| `REGISTRY_URL` | `registry_url` | 謙面 registry wire 入口 |
| `SUB2API_BASE` | `sub2api_base` | sub2api 计费面（router.finddatatech.cloud） |
| `SUB2API_ADMIN_KEY` | `sub2api_admin_key` | sub2api admin API（同 wanxing-fleet 借用键） |
| `TOKEN_GATEWAY_URL` | `token_gateway_url` | token 网关（AI 构建循环） |
| `METERING_INGEST_TOKEN` | `metering_ingest_token` | 计量管道上报凭据 |
| `FD_WIRE_INTERNAL_TOKEN` | `fd_wire_internal_token` | 内部端点令牌（catalog sync / demands / ai 共用） |
| `AI_DATABASE_URL` | `ai_database_url` | ai 模块库（落 PVC `/var/lib/fd-wire/db/fd_wire_platform.db`，与平台主库同文件） |
| `FD_WIRE_DATABASE_URL` | `fd_wire_database_url` | demands 等模块库名（与计量库同库，落 PVC，pod 重建存续） |
| `INDICATOR_REGISTRY_URL` | `indicator_registry_url` | 目录镜像权威源（fd-open-data-mcp 的 MCP 入口） |
| `INDICATOR_REGISTRY_TOKEN` | `indicator_registry_token` | 目录镜像权威源访问凭据 |
| `CATALOG_SYNC_ENABLED` | `catalog_sync_enabled` | 目录同步开关（默认关闭，权威源就绪后开） |
| `PLATFORM_IDENTITIES` | `platform_identities` | 平台服务身份名单（计量轨道判定，见 `docs/service-credentials.md`） |
| `METERING_SOURCE_MAP` | `metering_source_map` | customer 轨 server → 来源映射（yizuo/wanxing） |

> 注：`PLATFORM_IDENTITY_SOURCE_MAP`（platform 轨「身份 → 来源」映射，api 侧 8.2 缺口修复已支持）**尚未接入** `fd-wire-api.yaml`——启用 platform 轨来源区分时需在 manifest 增补对应 secretKeyRef 并同步本表；发放/回填联动约定见 `docs/service-credentials.md`。

## 上线步骤（顺序执行；【外发】= 主代理执行，子代理不做）

1. 【外发】**建仓**：gitee `FindDataTechnology/fd-wire`（主源，ArgoCD 读它）+ github 同名仓（GHA 构建跑 github）。加双 remote 推两侧（或开 gitee→github 镜像）。
2. 【外发】**GitHub secrets**：`TCR_USERNAME` / `TCR_PASSWORD`（TCR 个人版 UIN `100035884308` 的凭据；org 级 secrets 对私有仓不生效，必须配在 repo 级——wanxing 注释同款纪律）。
3. 【外发】**TCR 命名空间确认**：确认 `ccr.ccs.tencentyun.com` 下 `fd-wire` 命名空间（个人版通常推首镜像即建，若控制台需显式建则建之）。若改走 hkccr+relay 快腿：workflow `REGISTRY` 翻为 `hkccr.ccs.tencentyun.com`，并在 cheap-3 `/etc/tcr-relay/repos.conf` 登记 `fd-wire/api`、`fd-wire/web` 两行——k8s 清单引用 ccr 不变。
4. **首次构建**：push main → GHA `build` 出双镜像 `sha-<7>` tag（步骤 1-3 就绪后自然触发）。
5. **回填 tag**：`deploy/k8s/fd-wire-{api,web}.yaml` 的 `sha-0000000` 占位改为实际 tag，提交 gitee main。
6. 【外发】**集群 Secret**（15 键与上表逐键一致，缺一即 pod CreateContainerConfigError）：
   `kubectl --context cheap -n fd-prod create secret generic fd-wire-env --from-literal=database_url=... --from-literal=business_mcp_url=http://business-mcp.fd-prod.svc/execution --from-literal=registry_url=https://mcp.finddatatech.cloud --from-literal=sub2api_base=https://router.finddatatech.cloud --from-literal=sub2api_admin_key=... --from-literal=token_gateway_url=https://token.finddatatech.cloud --from-literal=metering_ingest_token=... --from-literal=fd_wire_internal_token=... --from-literal=ai_database_url=sqlite:////var/lib/fd-wire/db/fd_wire_platform.db --from-literal=fd_wire_database_url=... --from-literal=indicator_registry_url=http://fd-open-data-mcp.fd-prod.svc --from-literal=indicator_registry_token=... --from-literal=catalog_sync_enabled=false --from-literal=platform_identities=... --from-literal='metering_source_map=business-mcp=yizuo,wanxing-*=wanxing'`
   （敏感值从 `~/finddata/secrets` 台账取，命令行历史勿留明文；`platform_identities` 的取值口径与发放联动见 `docs/service-credentials.md`。）
7. 【外发】**端口台账先行**：`fd-infra-deploy/PORTS.md` 第 1 节登记 `31881 fd-prod/fd-wire-web 8080 柏讯门面`（台账先行纪律；若 31881 已被占，改 `deploy/k8s/fd-wire-web.yaml` 的 nodePort 并同步台账）。
8. 【外发】**ArgoCD app**：`kubectl --context cheap -n argocd apply -f deploy/argocd/application.yaml` → UI/CLI 观察 fd-prod 两 Deployment 滚起，`/health` 探活。
9. 【外发】**DNS**：`wire.finddatatech.cloud` → cheap-1（与 wanxing.finddatatech.cloud 同记录形态）。
10. 【外发】**Caddy（cheap-1）**：新站点块 `wire.finddatatech.cloud`：`/`、`/console` → 反代 tailscale 侧 `fd-wire-web` NodePort 31881；`/mcp` → 反代 registry wire 入口（鉴权/逐调用审计在 registry 侧；此路径不进集群）。TLS 由 Caddy 签结。

**验收**（任务 3.4）：一次端到端——push 一次 main → GHA 双镜像 sha tag → 回填 tag 提交 → ArgoCD 自动滚动 → `https://wire.finddatatech.cloud/` 与 `/console` 出脸、`/health` 200。

## 备注

- Ingress（`deploy/k8s/ingress.yaml`）是占位：集群现无 ingress controller，真实入口是步骤 9-10 的 Caddy；清单为路由意图存档，controller 启用后即生效。
- `/internal/`（内部后台端点族）**不经 Caddy 单列路由**：`web/nginx.conf` 的 `location /internal/` 直接反代 `fd-wire-api.fd-prod.svc.cluster.local:8000`（wire-internal-public-routing），门禁在后端令牌 `X-Admin-Token`（fail-closed：未配置 403/不匹配 401）。⚠️ 前端 bundle 公开含开发占位令牌 `dev-admin-token`——生产 secret `fd-wire-env` 键 `fd_wire_admin_token` 必须保持强随机值（10-07 核验为 48 位非占位）。
- `fd-wire-api` 只暴露 ClusterIP；`/api` 由边缘 Caddy 承接直指 api，web nginx 刻意不设 `/api` 反代（同域双路由是隐患，注释占位保留仅作文档）。
- 回滚：清单回退 git tag/commit → ArgoCD 滚回；镜像按不可变 sha- tag 永远可指回。

## datasets 迁出 /tmp（wire-provenance-ledger D8.1）

背景：datasets 模块的 sqlite 库（`/tmp/fd_wire.db`）与上传原件目录
（`/tmp/fd_wire_dataset_uploads`）原落容器临时层——pod 重建即丢登记、同步
历史与上传原件。新清单（`deploy/k8s/fd-wire-api.yaml`）已改挂 PVC
`fd-wire-datasets-data`（`/var/lib/fd-wire/{db,uploads}`）。迁移工件：
`fd-wire/scripts/datasets_off_tmp.py`（自包含标准库，`--help` 自解释；
`--selftest` 本地演练）。备份/恢复均在 pod 内执行，镜像 slim 无 tar，
文件进出一律走 `kubectl exec -i … cat`（不用 `kubectl cp`）。

前置：`kubectl --context cheap -n fd-prod get pvc` 确认目标 PVC 名未占用；
旧 pod 健康（迁移期间 datasets 面短暂只读，告知控制台侧）。

1. **备份导出（旧 pod → 本地）**：

   ```bash
   POD=$(kubectl --context cheap -n fd-prod get pod -l app.kubernetes.io/name=fd-wire-api -o jsonpath='{.items[0].metadata.name}')
   # 脚本送进旧 pod（exec cat 流式；kubectl cp 依赖容器内 tar，slim 镜像没有）
   kubectl --context cheap -n fd-prod exec -i "$POD" -- sh -c 'cat > /tmp/datasets_off_tmp.py' < scripts/datasets_off_tmp.py
   kubectl --context cheap -n fd-prod exec "$POD" -- python3 /tmp/datasets_off_tmp.py backup \
     --db /tmp/fd_wire.db --uploads /tmp/fd_wire_dataset_uploads --out /tmp/datasets_off_tmp_backup
   mkdir -p datasets_off_tmp_backup
   for f in db.sqlite uploads.tar.gz MANIFEST.json; do
     kubectl --context cheap -n fd-prod exec -i "$POD" -- cat /tmp/datasets_off_tmp_backup/$f > datasets_off_tmp_backup/$f
   done
   sha256sum datasets_off_tmp_backup/*   # 留档；restore 侧会再验 MANIFEST 哈希
   ```

2. **部署新清单（挂 PVC）**：提交 `deploy/k8s/fd-wire-api.yaml` 到 gitee
   main → ArgoCD 同步：PVC `fd-wire-datasets-data`（local-path，10Gi）创建、
   api 滚起到 `/var/lib/fd-wire/*`（空卷、新库由进程自动建表）。确认
   `kubectl --context cheap -n fd-prod get pvc fd-wire-datasets-data` 为
   Bound、新 pod Ready（`/health` 200）再进下一步。

3. **一次性恢复（备份灌入 PVC）**——在挂 PVC 的新 pod 内执行（PVC 为
   RWO 单写者，api pod 即恢复执行位；备份文件在本地，独立 Job 对象拿不
   到本地文件，exec 注入等价且少一亲清单）：

   ```bash
   NEWPOD=$(kubectl --context cheap -n fd-prod get pod -l app.kubernetes.io/name=fd-wire-api -o jsonpath='{.items[0].metadata.name}')
   kubectl --context cheap -n fd-prod exec -i "$NEWPOD" -- sh -c 'cat > /tmp/datasets_off_tmp.py' < scripts/datasets_off_tmp.py
   kubectl --context cheap -n fd-prod exec "$NEWPOD" -- mkdir -p /tmp/datasets_off_tmp_backup
   for f in db.sqlite uploads.tar.gz MANIFEST.json; do
     kubectl --context cheap -n fd-prod exec -i "$NEWPOD" -- sh -c "cat > /tmp/datasets_off_tmp_backup/$f" < datasets_off_tmp_backup/$f
   done
   kubectl --context cheap -n fd-prod exec "$NEWPOD" -- python3 /tmp/datasets_off_tmp.py restore \
     --backup-dir /tmp/datasets_off_tmp_backup \
     --db /var/lib/fd-wire/db/fd_wire_datasets.db \
     --uploads /var/lib/fd-wire/uploads
   # 库文件被整体替换，重启让进程重开句柄（restore 幂等，失败可原样重跑）
   kubectl --context cheap -n fd-prod rollout restart deploy/fd-wire-api
   ```

4. **回归验证**：
   `kubectl --context cheap -n fd-prod exec deploy/fd-wire-api -- python3 -c "import sqlite3; print(sqlite3.connect('/var/lib/fd-wire/db/fd_wire_datasets.db').execute('select count(*) from uploads').fetchone())"`
   行数与备份口径一致；控制台「我的数据」数据集列表与同步历史可见；
   新传一个测试 CSV（uploads 行 `content_sha256` 应有 `sha256:` 值）；
   `ls /var/lib/fd-wire/uploads` 有原件暂存。旧 pod 的 /tmp 数据暂不动
   （回滚介质之一，收口前保留）。

5. **回滚**：git revert 本次清单提交 → ArgoCD 自动滚回（env 指回
   `/tmp`，PVC 留着不删）；旧 /tmp 数据若仍在即原样可用；若旧 pod 已
   重建（/tmp 已空），用步骤 1 的本地备份反向灌回
   （`restore --db /tmp/fd_wire.db --uploads /tmp/fd_wire_dataset_uploads`）。
   备份目录 `datasets_off_tmp_backup/` 保留至迁移收口（D8.1：回滚=配置
   回切，备份保留）。

> 备注：恢复是旧库逐字节落位——库结构随备份（当前生产 datasets 库由
> `create_all` 兜底建表，api 镜像不带 alembic 工件）。0013 的
> `dataset_syncs` 终态触发器与新列要在该库生效，需另行以 alembic 链
> （`api/alembic`，head=0013）对该库执行 upgrade；执行前应用层行为已按
> 触发器约束改写（abort 留痕不删行），不依赖触发器在场。

## 连接器 fd-wire-connector（客户内网单二进制，仅出站连接）

上游能力：`specs/wire-local-connector/`；代码 `connector/`（Go module，随本仓 CI 独立构建；详细行为见该目录各包注释）。

### 取件

GHA `build` 的 `connector` job 在 push main 时产出三平台产物（artifact 名即 `fd-wire-connector-<os>-<arch>`，内含同名可执行文件；`-trimpath`，版本注入 `sha-<7>` 并随心跳上报控制台）：

| 平台 | 产物 |
|---|---|
| Linux | `fd-wire-connector-linux-{amd64,arm64}` |
| macOS | `fd-wire-connector-darwin-{amd64,arm64}` |
| Windows | `fd-wire-connector-windows-amd64.exe` |

本地自建：`cd connector && go build ./cmd/fd-wire-connector`（或 `go build -ldflags "-X main.version=sha-$(git rev-parse --short HEAD)"`）。

### 安装三步（零入站开孔）

1. **配对**（令牌在控制台「我的数据 → 连接器 → 配对向导」生成，15 分钟单次有效）：
   `fd-wire-connector pair --token fwp_xxx --api https://wire.finddatatech.cloud --name erp-app-01`
   连接器 key 只写入本地配置文件（0600），云端仅保存其哈希；吊销即时生效。
2. **配客户源**（在本地配置文件 `sources` 段；凭据只存这里，永不上传云端）：
   ```json
   {"api_url":"https://wire.finddatatech.cloud","connector_key":"fwc_...",
    "sources":[{"name":"erp_db","kind":"postgres","dsn":"postgres://user:pass@host/db"},
               {"name":"sales_mysql","kind":"mysql","dsn":"user:pass@tcp(host:3306)/sales"},
               {"name":"reports","kind":"file","path":"/data/reports"}]}
   ```
   路径：Linux/macOS `$XDG_CONFIG_HOME/fd-wire-connector/config.json`（缺省 `~/.config/fd-wire-connector/config.json`）、Windows `%APPDATA%\fd-wire-connector\config.json`。建议给数据库账号**只读 + 仅白名单库表**的库级权限（第一道边界）。文件源 `source_ref` 是文件名（一个文件=一个数据集），不与目录拼接。
3. **常驻**：`fd-wire-connector run --verbose`（`--once` 只跑一轮，用于冒烟/排障）。
   控制台圈定白名单与调度频率后，连接器在下一轮询周期内生效；白名单之外的数据没有离开内网的路径。

### 常驻方式

- Linux（systemd）：`/etc/systemd/system/fd-wire-connector.service` → `ExecStart=/usr/local/bin/fd-wire-connector run --config /etc/fd-wire-connector/config.json`、`Restart=always`、专用账号（配置文件属主 0600）。
- Windows：任务计划程序「启动时」运行，或 `nssm install fd-wire-connector fd-wire-connector.exe run` 注册为服务。
- macOS：`launchd` LaunchDaemon 或前台运行；该机器需能同时访问客户源与公网。

### 运行语义与排障

- **心跳/轮询**：默认 60s（云端可下发覆盖，夹紧在 10s–1h）；心跳上报版本、各数据集同步状态与本地告警。控制台按 `now - last_heartbeat > 3×周期` 判离线。
- **同步**：按云端 cron + 最小同步间隔全量快照（begin → chunk ≤2000 行 → commit 原子替换；任一步失败即 abort 并回报原因）。同一数据集并发锁；白名单里 `source` 名在本机 `sources` 找不到 → 跳过该数据集，并在心跳 `warnings` 里回报（控制台连接器区块可见）。
- **重试**：5xx 与网络错误指数退避（默认 4 次尝试）；4xx 立即失败并带原因（key 吊销 401、漂移 409、配额 429 均属此类，不做无谓重试）。
- **schema 漂移**：加列自动跟随；缺列/改类型由控制台暂停该数据集（`paused_drift`）等人工 `resume`，期间数据集保持最后一次有效快照。
- **安全**：只发起出站 HTTPS——唯一例外是本机回环 `http://127.0.0.1`（本地联调用），其余明文地址启动即拒；配置文件权限 0600，过宽时启动打印告警。轮换 = 控制台吊销连接器后重新配对。
