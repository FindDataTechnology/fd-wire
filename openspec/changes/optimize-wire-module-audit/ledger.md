# 柏讯模块总账（68 模块）

R = finddata 根 `openspec/specs/`（跨仓契约/平台面）；W = fd-wire 根 `openspec/specs/`（产品功能面）。
评级列由体检健康卡回填。重叠对编号 O1-O9。

| # | 模块 | 根 | 簇 | 重叠对 | 代码域（初判） | 评级 |
|---|------|----|----|--------|----------------|------|
| 1 | wire-facade-metering | R | A | O1 | api 计量面 | B |
| 2 | metering-poll-channel | W | A | O1 | api 计量面 | B |
| 3 | usage-transparency | W | A | O1 | api usage 出参 | A- |
| 4 | wire-billing | R | A | O2 | api billing.*（tests 6 个 billing 文件在场） | C |
| 5 | portal-pricing | W | A | O2 | web 门户定价 | A- |
| 6 | free-tier-data | W | A | O2 | api/web 免费档 | B |
| 7 | wire-customer-identity | R | A | O3 | api console 身份 | B |
| 8 | console-auth | W | A | O3 | web/api console auth | A- |
| 9 | customer-key-minting | W | A | O3 | api key 签发 | A- |
| 10 | wire-cell-tenancy | R | A | O4 | cell-manager/租户面 | A- |
| 11 | cell-grant | W | A | O4 | cell 授权 | B |
| 12 | cell-postgres-storage | W | A | O4 | cell PG 存储 | A- |
| 13 | fleet-service-accounts | W | A | — | api 服务账号 | B |
| 14 | wire-data-plane | R | B | — | api 数据面 | A |
| 15 | wire-storage-postgres | W | B | — | PG 存储层 | A |
| 16 | wire-indicator-catalog | R | B | O5 | api catalog.*（tests 6 个 catalog 文件在场） | B |
| 17 | catalog-governance | W | B | O5 | api catalog 治理 | A |
| 18 | indicator-to-dataset | W | B | O5 | api indicator→dataset | A |
| 19 | wire-customer-datasets | R | B | — | api datasets | A- |
| 20 | dataset-export | W | B | — | api 导出面 | A |
| 21 | dataset-form-editing | W | B | — | api/web 表单编辑 | A |
| 22 | record-view | W | B | — | api/web 记录读面 | A |
| 23 | wire-dataset-link | R | B | — | api dataset link | B+ |
| 24 | wire-dataset-quality | R | B | — | api 质量面 | A- |
| 25 | wire-quality-rules | R | B | — | api 质量规则 | A |
| 26 | wire-provenance-ledger | R | B | — | api 溯源台账 | A |
| 27 | entity-layer | W | B | — | api entities（0050 迁移刚落） | B |
| 28 | wire-transform-pipelines | R | C | O6 | api transform | A |
| 29 | transform-pipeline | W | C | O6 | api transform | B |
| 30 | wire-build-mcp | R | C | O7 | wire-build-mcp 独立服务 | B+ |
| 31 | wire-artifact-build-mcp | W | C | O7 | api artifact build mcp | A |
| 32 | wire-mcp-client | R | C | — | api fd_mcp_client | B |
| 33 | wire-ops-mcp | R | C | — | wire-ops-mcp 独立服务 | C |
| 34 | wire-action-gate | W | C | — | api 动作闸 | A- |
| 35 | wire-domain-actions | W | C | — | api 域动作 | A- |
| 36 | connector-distribution | W | C | — | connector/ | B+ |
| 37 | wire-local-connector | R | C | — | connector/ | A- |
| 38 | caller-preflight-map | W | C | — | api 调用方预检 | B |
| 39 | console-shell | W | D | — | web 控制台壳 | A |
| 40 | console-ai-entry | W | D | — | web AI 入口 | A |
| 41 | assistant-panel | W | D | — | web/api 助手面板 | A |
| 42 | personal-workbench | W | D | — | web 工作台 | A |
| 43 | personal-preferences | W | D | — | web 偏好 | B |
| 44 | portal-shell | W | D | — | web 门户壳 | A |
| 45 | team-spaces | W | D | — | api/web 团队空间 | A |
| 46 | self-serve-onboarding | W | D | — | web/api 自助开通 | A |
| 47 | form-apps | W | D | — | web/api 表单应用 | A |
| 48 | rich-text-docs | W | D | — | web 富文文档 | A |
| 49 | dashboard-refresh | W | E | — | api 看板刷新 | A |
| 50 | dashboard-renderer | W | E | — | api/web 看板渲染 | A |
| 51 | dashboard-share | W | E | — | api/web 分享 | A |
| 52 | wire-analysis-console | R | E | — | web/api 分析台 | B |
| 53 | wire-analysis-presets | R | E | — | api 分析预设 | C |
| 54 | alert-evaluation | W | E | — | api 告警评测（test_alerts 在场） | B |
| 55 | refresh-scheduler | W | E | — | api 刷新调度 | B |
| 56 | wire-demand-pipeline | R | E | O8 | api demands（test_admin_demand* 在场） | D |
| 57 | demand-intake | W | F | O8 | api demands 入口 | A |
| 58 | demand-orchestration | W | F | O8 | api demands 编排 | A |
| 59 | artifact-lifecycle | W | F | — | api artifacts（test_artifacts_lifecycle 在场） | B |
| 60 | artifact-marketplace | W | F | — | api marketplace（test_artifact_marketplace 在场） | A |
| 61 | showcase-market | W | F | — | api/web 橱窗 | A |
| 62 | wire-content-fleet | W | — | O9 | api 舰队内容（归属核验：根仓无此 spec） | C |
| 63 | wire-asset-catalog | R | F | — | api assets（test_assets_api 在场） | B |
| 64 | wire-data-steward | R | F | — | api data steward | B |
| 65 | xingyan-content-supply | W | F | — | api 星言内容供给 | B |
| 66 | wire-base-integration | R | F | — | 跨仓（壹座↔wire 集成） | B |
| 67 | source-packs | W | F | — | api 数据包 | B |
| 68 | wire-platform | R | F | — | 平台总纲 spec | B |

## 重叠对清单（体检逐对裁真源）

- **O1 计量**：wire-facade-metering(R) ↔ metering-poll-channel(W) + usage-transparency(W)
- **O2 计费**：wire-billing(R) ↔ portal-pricing(W) + free-tier-data(W)
- **O3 身份**：wire-customer-identity(R) ↔ console-auth(W) + customer-key-minting(W)
- **O4 租户**：wire-cell-tenancy(R) ↔ cell-grant(W) + cell-postgres-storage(W)
- **O5 目录**：wire-indicator-catalog(R) ↔ catalog-governance(W) + indicator-to-dataset(W)
- **O6 转换**：wire-transform-pipelines(R) ↔ transform-pipeline(W)（同名异根，最危险）
- **O7 build**：wire-build-mcp(R) ↔ wire-artifact-build-mcp(W)
- **O8 需求**：wire-demand-pipeline(R) ↔ demand-intake(W) + demand-orchestration(W)
- **O9 归属核验**：wire-content-fleet(W)——memory 记其归档在先，根仓无此 spec，确认无双记账

> 分工语义：R=跨仓契约/平台面，W=产品功能面。体检若证伪该语义（同能力两根都写实现级 requirement），按「合并到真源+另一根降指针」给裁决建议。
