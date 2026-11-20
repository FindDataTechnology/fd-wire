# 柏讯（Wire）

<!-- deploy-location -->
> **部署清单不在本仓。** 集群清单已迁至 `fd-infra-deploy/all-services/`，
> Application 定义在 `fd-infra-deploy/argocd/`。
> 原因与判据：`openspec/changes/consolidate-deploy-manifests`（2026-11-20）。


> **Part of the [Wire line (寻数·柏讯)](https://www.finddatatech.cloud/products/wire) of [FindData](https://www.finddatatech.cloud)** — the wire platform: indicator ledger, build analytics, data demands, and end-to-end metering, served as REST and MCP surfaces.

寻数五线（壹座/识律/柏讯/谦面/萬星）中 **wire 线的平台仓**：B2B 数据平台——公开官网、
客户控制台、内部后台三面。单域 `wire.finddatatech.cloud` 三入口：`/` 官网、
`/console` 控制台、`/mcp` API 入口（反代 registry wire 入口）。

2026-10-04 定案：wire 线从「私有镜像交付一个 MCP 服务器」升级为 B2B 自助数据平台
（客户自助注册→领长命 key→浏览指标目录→构建分析→提数据需求，全链路计量计费）。
架构决策起步三条：[ADR-0001](docs/adr/0001-registry-is-the-wire-facade.md)、
[ADR-0002](docs/adr/0002-cell-is-the-enterprise.md)、
[ADR-0003](docs/adr/0003-metering-attribution-is-dual-credential.md)。

## 本仓现在有什么

| 目录 | 职责 | 状态 |
|---|---|---|
| `web/` | 官网 + 控制台前端（React19 + Vite6 + TS + Tailwind4 + echarts + i18next 双语） | **在产**（2026-11-07 线上核证：SPA 门户已上线 wire.finddatatech.cloud，131 个 tsx，含定价/目录/控制台/分享页；本行「骨架」为陈文） |
| `api/` | FastAPI 服务（`fd_wire_api`：结算/后台 API 起步） | 骨架 |
| `cell-manager/` | 企业 cell 生命周期（开通/暂停/恢复/注销、容器+SQLite 卷、注册 registry） | v1 仅骨架 |

## 借用契约（不归本仓，经显式契约访问）

- **business-mcp**：五库联邦数据读取工具（`rows_returned` 计量戳），`BUSINESS_MCP_URL`
- **谦面 registry**：wire 入口——鉴权、逐调用审计、转发（ADR-0001），`REGISTRY_URL`
- **sub2api 计费面**：客户账户平台代管、余额与结算，`SUB2API_BASE`
- **DAAS 引擎**（fd-daas-mcp）：cell 内运行，零多用户化（ADR-0002），经 cell 编排
- **token 网关**：AI 构建循环（token.finddatatech.cloud），`TOKEN_GATEWAY_URL`

对兄弟线与外部组件只经 HTTP 契约访问、env 可重指——这条纪律与 fd-wanxing 同款，
守住它才有跨线互联而不互相阻塞发布。

## 相关

- 治理：finddata 母仓 `openspec/changes/wire-platform-v1/`（specs 随代码成长后迁入本仓）
- 品牌与五线语言：`~/finddata/CONTEXT.md`
- 同范式参照：`fd-wanxing`（萬星独立仓）

## 文档地图

`docs/` 下 33 篇按主题分四组。不知道看哪篇时按这个表找：

**架构与领域模型**

| 文档 | 一句话 |
|---|---|
| `docs/adr/` | 三条架构决策：registry 是 wire 门面、cell 是企业单元、计量归属是双凭据 |
| `docs/cell-postgres-storage.md` | 企业 cell 的存储形态与卷布局 |
| `docs/ontology-versioning.md` | 指标本体的版本化规则 |
| `docs/registry-requirements.md` | registry 的能力要求（19K，最全的一份） |

**客户与商业**

| 文档 | 一句话 |
|---|---|
| `docs/customer-onboarding-integration.md` | 客户从注册到能用的完整链路 |
| `docs/business-mcp-shared-objects-requirements.md` | 借用 business-mcp 时的对象契约 |
| `docs/service-credentials.md` | 各面之间的凭据口径与轮换 |
| `docs/ESIGN-WIRE-ACTION-AUDIT.md` | 电子签动作审计 |

**平台与舰队**（`paas-*` 系列，9 篇）

| 文档 | 一句话 |
|---|---|
| `docs/paas-fleet-orchestration-modes.md` | 舰队编排的几种模式与适用场景 |
| `docs/paas-fleet-turn-reliability-requirements.md` | 单轮可靠性要求 |
| `docs/paas-fleet-self-heal-execution-requirements.md` | 自愈执行的边界 |
| `docs/paas-wire-content-fleet-requirements.md` | 内容舰队的形态 |
| `docs/paas-line-credential-renewal-requirements.md` | 线凭据轮换 |
| `docs/paas-model-upstream-resilience-evidence.md` | 上游模型抖动的实测证据 |
| `docs/paas-domain-action-requirements.md` / `paas-wire-remaining-closeout-requirements.md` / `paas-fleet-post-model-requirements.md` | 领域动作、收口清单、投递模型 |

**运维与发布**

| 文档 | 一句话 |
|---|---|
| `docs/release-with-migrations.md` | 带迁移的发布流程（改表时必读） |
| `docs/provenance-ops.md` | 溯源数据的运维 |
| `docs/publish-facts-to-kernel.md` | 把事实推给本体内核 |
| `docs/handoff-pack-install-to-zcode.md` | pack 安装交接 |
| `docs/registry-tool-snapshot-longterm.md` | 工具快照的长期形态 |
| `docs/PERSONAL-CELL-EVAL.md` | 个人 cell 的评估结论 |
| `docs/ROADMAP.md` `docs/ROADMAP-v2.md` | 路线图（v2 为现行） |
| `docs/wire-intel-sentiment-fleet-requirements.md` | 情报与情绪舰队 |

新增文档请同时更新本表——`tools/check_doc_map.py` 会核「地图里的都在、`docs/` 下的都列了」。
