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

| env（Deployment 引用名） | Secret key | 用途 |
|---|---|---|
| `DATABASE_URL` | `database_url` | wire 账本数据库 |
| `BUSINESS_MCP_URL` | `business_mcp_url` | 五库联邦工具（rows_returned 计量戳） |
| `REGISTRY_URL` | `registry_url` | 謙面 registry wire 入口 |
| `SUB2API_BASE` | `sub2api_base` | sub2api 计费面（router.finddatatech.cloud） |
| `SUB2API_ADMIN_KEY` | `sub2api_admin_key` | sub2api admin API（同 wanxing-fleet 借用键） |
| `TOKEN_GATEWAY_URL` | `token_gateway_url` | token 网关（AI 构建循环） |
| `METERING_INGEST_TOKEN` | `metering_ingest_token` | 计量管道上报凭据 |

## 上线步骤（顺序执行；【外发】= 主代理执行，子代理不做）

1. 【外发】**建仓**：gitee `FindDataTechnology/fd-wire`（主源，ArgoCD 读它）+ github 同名仓（GHA 构建跑 github）。加双 remote 推两侧（或开 gitee→github 镜像）。
2. 【外发】**GitHub secrets**：`TCR_USERNAME` / `TCR_PASSWORD`（TCR 个人版 UIN `100035884308` 的凭据；org 级 secrets 对私有仓不生效，必须配在 repo 级——wanxing 注释同款纪律）。
3. 【外发】**TCR 命名空间确认**：确认 `ccr.ccs.tencentyun.com` 下 `fd-wire` 命名空间（个人版通常推首镜像即建，若控制台需显式建则建之）。若改走 hkccr+relay 快腿：workflow `REGISTRY` 翻为 `hkccr.ccs.tencentyun.com`，并在 cheap-3 `/etc/tcr-relay/repos.conf` 登记 `fd-wire/api`、`fd-wire/web` 两行——k8s 清单引用 ccr 不变。
4. **首次构建**：push main → GHA `build` 出双镜像 `sha-<7>` tag（步骤 1-3 就绪后自然触发）。
5. **回填 tag**：`deploy/k8s/fd-wire-{api,web}.yaml` 的 `sha-0000000` 占位改为实际 tag，提交 gitee main。
6. 【外发】**集群 Secret**：
   `kubectl --context cheap -n fd-prod create secret generic fd-wire-env --from-literal=database_url=... --from-literal=business_mcp_url=http://business-mcp.fd-prod.svc/execution --from-literal=registry_url=https://mcp.finddatatech.cloud --from-literal=sub2api_base=https://router.finddatatech.cloud --from-literal=sub2api_admin_key=... --from-literal=token_gateway_url=https://token.finddatatech.cloud --from-literal=metering_ingest_token=...`
   （敏感值从 `~/finddata/secrets` 台账取，命令行历史勿留明文。）
7. 【外发】**端口台账先行**：`fd-infra-deploy/PORTS.md` 第 1 节登记 `31881 fd-prod/fd-wire-web 8080 柏讯门面`（台账先行纪律；若 31881 已被占，改 `deploy/k8s/fd-wire-web.yaml` 的 nodePort 并同步台账）。
8. 【外发】**ArgoCD app**：`kubectl --context cheap -n argocd apply -f deploy/argocd/application.yaml` → UI/CLI 观察 fd-prod 两 Deployment 滚起，`/health` 探活。
9. 【外发】**DNS**：`wire.finddatatech.cloud` → cheap-1（与 wanxing.finddatatech.cloud 同记录形态）。
10. 【外发】**Caddy（cheap-1）**：新站点块 `wire.finddatatech.cloud`：`/`、`/console` → 反代 tailscale 侧 `fd-wire-web` NodePort 31881；`/mcp` → 反代 registry wire 入口（鉴权/逐调用审计在 registry 侧；此路径不进集群）。TLS 由 Caddy 签结。

**验收**（任务 3.4）：一次端到端——push 一次 main → GHA 双镜像 sha tag → 回填 tag 提交 → ArgoCD 自动滚动 → `https://wire.finddatatech.cloud/` 与 `/console` 出脸、`/health` 200。

## 备注

- Ingress（`deploy/k8s/ingress.yaml`）是占位：集群现无 ingress controller，真实入口是步骤 9-10 的 Caddy；清单为路由意图存档，controller 启用后即生效。
- `fd-wire-api` 只暴露 ClusterIP；控制台将来接服务端接口时启用 `web/nginx.conf` 里的 `/api/` 反代占位。
- 回滚：清单回退 git tag/commit → ArgoCD 滚回；镜像按不可变 sha- tag 永远可指回。
