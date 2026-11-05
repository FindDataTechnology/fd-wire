# 任务：柏讯模块体检

## 1. 模块总账

- [x] 1.1 登记 finddata 根 23 条 `wire-*` spec + fd-wire 根 45 条 spec，逐条标注：归属根 / 代码位置（fd-wire 仓目录或跨仓）/ 簇归属 / 跨根重叠对标记 → `ledger.md`
- [x] 1.2 确认 8 对重叠对清单：metering、billing、identity、tenancy、demand、indicator-catalog、transform-pipeline、build-mcp（+content-fleet 归属核验）

## 2. 簇体检（6 个并行子代理，每簇一张健康卡）

- [x] 2.1 簇 A 计量/计费/身份/租户（13 模块）：wire-facade-metering、metering-poll-channel、usage-transparency、wire-billing、portal-pricing、free-tier-data、wire-customer-identity、console-auth、customer-key-minting、wire-cell-tenancy、cell-grant、cell-postgres-storage、fleet-service-accounts
- [x] 2.2 簇 B 数据面/目录/数据集（14 模块）：wire-data-plane、wire-storage-postgres、wire-indicator-catalog、catalog-governance、indicator-to-dataset、wire-customer-datasets、dataset-export、dataset-form-editing、record-view、wire-dataset-link、wire-dataset-quality、wire-quality-rules、wire-provenance-ledger、entity-layer
- [x] 2.3 簇 C 转换/管线/MCP 面（11 模块）：wire-transform-pipelines、transform-pipeline、wire-build-mcp、wire-artifact-build-mcp、wire-mcp-client、wire-ops-mcp、wire-action-gate、wire-domain-actions、connector-distribution、wire-local-connector、caller-preflight-map
- [x] 2.4 簇 D 控制台/门户（10 模块）：console-shell、console-ai-entry、assistant-panel、personal-workbench、personal-preferences、portal-shell、team-spaces、self-serve-onboarding、form-apps、rich-text-docs
- [x] 2.5 簇 E 看板/分析/调度（8 模块）：dashboard-refresh、dashboard-renderer、dashboard-share、wire-analysis-console、wire-analysis-presets、alert-evaluation、refresh-scheduler、wire-demand-pipeline
- [x] 2.6 簇 F artifact/市场/内容/平台（12 模块）：artifact-lifecycle、artifact-marketplace、showcase-market、wire-content-fleet、wire-asset-catalog、wire-data-steward、demand-intake、demand-orchestration、xingyan-content-supply、wire-base-integration、source-packs、wire-platform
- [x] 2.7 每张健康卡：每模块 A/B/C/D 评级 + 五项检查证据（file:line / 命令输出）；只读生产探针限既有配方

## 3. 集成与 backlog

- [x] 3.1 汇总 6 卡 → 68 模块总评分表；抽查 3 个模块的代码证据防幻觉
- [x] 3.2 评分 backlog（P0/P1/P2）→ `backlog.md`；8 对重叠逐对给真源裁决建议（含证据链，拍板留用户）
- [x] 3.3 方法学收口：五项检查+簇拆分模板定稿（design.md 补记实测偏差），供其余线试点复用
- [x] 3.4 向用户汇报 backlog 摘要；修复 change 另立，不混入本 change
