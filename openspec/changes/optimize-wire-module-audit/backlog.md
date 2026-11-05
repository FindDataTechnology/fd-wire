# 体检 backlog（柏讯试点，2026-11-05）

68 模块评级分布：A/A- 38、B/B+ 25、C 4、D 1。证据：`findings/cluster-{A..F}.md`，抽查 3 项全实锤（plans.py 到量即停、statemachine 三态+五废除态、preferences LANDING_TABS 十值无 market）。

## P0 — 会误导实现/资金口径、或生产不可对账

| # | 问题 | 证据 | 建议动作 |
|---|------|------|----------|
| ~~P0-1~~ ✅已修（2026-11-05，change fix-wire-billing-caliber 已归档） | **O2 计费口径真矛盾**：R 根 wire-billing 仍写「超额按行计费」，但代码/定价页/部署全在「到量即停 overage=0」（plans.py:44-56 PUBLIC_SEEDS 注释自证；且旧三档 LEGACY_SEEDS is_active=False 退场） | cluster-A §4/§5 | 拍板口径后改写 R spec（现网行为=到量即停是 portal-pricing 裁决的既成决定）；若要恢复超额计费属产品决策另立 |
| ~~P0-2~~ ✅已修（retire-wire-demand-pipeline-spec 已归档） | **O8 需求双账分裂**：R wire-demand-pipeline 八态/gate 必过/人工报价三条 Requirement 已被代码废除（statemachine.py:31-46 三态+五废除态、gate 观测化、quote 一律 409），W demand-intake 明文废除五旧态，代码站 W 侧 | cluster-E §8、cluster-F §3 | R spec 收缩为域级规格或标 superseded；W 两本为真源（簇 E/F 证据已合并互证） |
| ~~P0-3~~ ✅已核（探针三方实证 live=d5ca1dd、22 工具全上产；manifest 注释已修，fd-infra-deploy 4f00f22） | **wire-ops-mcp 部署不可对账**：现网镜像 sha-e5b9185 不在 gitee 对象中，清单注释仍锚旧映射 99882f3；10-31 后 12 个新工具（含 wire_action_*）上产与否**未证实** | cluster-C §6 | 人工核 registry live 工具面 vs 22 工具声明；修复快照-镜像映射纪律（对照 law-bench「ls-remote 先于 relay 诊断」教训） |

## P1 — 债务/复发缺陷/能力缺口

| # | 问题 | 证据 | 建议动作 |
|---|------|------|----------|
| ~~P1-1~~ ✅已修（fix-landing-tab-market-drift，c1c49fc：api 补 market+对拍测试+显式提示条；假后端第四本账顺手同步） | **landing_tab 三层漂移（复发型）**：spec 九页签 ⊂ api 十页签（无 market）⊂ web 十一页签（有 market）；切「数据市场」写回被 422 静默吞——workbench 同型缺陷有生产前科（preferences.py:45 注释自证），market 属复发 | cluster-D §5 | api LANDING_TABS 补 market 或 web 摘页签（拍板）；写回失败改显式提示不静默；补一条端到端值域对拍测试 |
| P1-2 | **entity-layer 高变动不稳定期**：5 天 4 fix，含双修复事故（5975db1 误扫并发会话半成品→50a986c 再修）+ 1c5dfc5 袋键绕过列快照校验的生产缺陷 | cluster-B §14 | 1-2 周冻结非必要扩展；落实「归档前测试对账 tasks.md」纪律；并发会话 git add 范围约束 |
| ~~P1-3~~ ✅已修（reconcile-transform-spec-homes 6ffc964：视图面改名 transform-pipeline-view+Purpose 回填，同名撞车消除） | **O6 转换同名异根**：两账 Requirement 零交集（R=引擎契约九算子，W=可视化图端点），非真重复但同名撞车 + W Purpose TBD | cluster-C §1/§2 | R 为真源；W 改名 transform-pipeline-view 并回填 Purpose |
| ~~P1-4~~ ✅已修（同 change：wire-artifact-build-mcp 五条退役，真源=R 根 wire-build-mcp） | **O7 build 一物两账**：同仓同部署（dashboard/doc 工具就在 build-mcp），R 账 10-31 已吸收 W 账，W 成冗余窄拷贝 | cluster-C §3/§4 | W wire-artifact-build-mcp 归档或降为索引指针 |
| ~~P1-5~~ ✅已修（fix-wire-mcp-client-gateway-residue 归档：gateway 旧账两条移除，5→3 条） | **wire-mcp-client 账内新旧互斥**：gateway 语义 Requirement（双模式）与 native 单模式并存一册（退役 commit 7875600 后 append-only 残留） | cluster-C §5 | 修 R spec：删 gateway 旧 Requirement，留退役注记 |
| ~~P1-6~~ ✅已修（两根两单：R 属主声明 clarify-catalog-ownership；W 去重+交叉引用 afd0325——分页条按证据保留，偏差记 proposal） | **O5 目录三本**：三本不合并但需定属主——R wire-indicator-catalog 为权威；W catalog-governance 删去与 R 重复的镜像同步两条；indicator-to-dataset 独立保留+状态语义交叉引用 | cluster-B §3/§4/§5 | 按此改三本 spec（属主+去重+交叉引用） |
| ~~P1-7~~ ✅已修（wire-metering-explicit-alerting b381fe8：未配置显式告警一次 + /internal/metering/channel-status 探针，spec「通道状态可探」入册） | **O1 计量链静默失败史**：rows_returned 戳丢曾致断流一月（spec 自录）；driver 未配置时 fail-quiet、探针闸无代码级落点 | cluster-A §1/§2 | fail-quiet 改显式告警；探针闸落点进 spec 或代码二选一 |
| P1-8 | **wire-analysis-console 两条客户承诺无实现**：时区调度（schedules 仅 UTC）、告警邮件（仅 webhook evaluator.py:73） | cluster-E §4 | 产品拍板：补实现或从 R spec 降级为 backlog 条目 |
| P1-9 | **wire-analysis-presets 账本归属错位**：本仓零实现入口（评级 C） | cluster-E §5 | 核实现主体所在仓，spec 迁移或补实现 |
| ~~P1-10~~ ✅已修（annotate-content-fleet-impl-state 453df3c：4 条悬空 Requirement 加实现态注记；实查修正初步清单——凭据轨/周期物化有在产落点未标，R1/R7 坐实悬空补标，证据在 proposal） | **wire-content-fleet spec 能力悬空**：fleet 段实例化/凭据轨/信号驱动/重复节奏拒仓内零代码；AI_CELL_ENDPOINT_MAP 漂移已咬生产（bcf57e3） | cluster-F §4 | spec 标注实现态（哪些 requirement 未落地）；漂移治理另立 |
| P1-11 | **shadow 能力两处**：产物证据发布门（已上产 enforce）+信息流契约无 spec 条目；refresh-scheduler「舰队产物归调度」Requirement 无实现痕迹 | cluster-F、cluster-E §7 | 前者补 spec；后者核挂账出处 |
| P1-12 | **cell 退租链收敛不足一月**：4 次 fix + R5(P0)/R6(P1) 缺陷入册 | cluster-A §11 | 挂观察名单下轮复检 |
| ~~P1-13~~ ✅已修（align-wire-platform-platform-reality 归档：公开面补橱窗/星研、后台边界钉工单延伸、对接清单补 A2A；12 原 Scenario 零削弱） | **wire-platform 总纲 3 条过时**：公开面清单缺橱窗+星研内容面；后台边界被萬星直连/工单编排逼近；兄弟线对接清单缺 A2A（另证：「13 条 wire 契约」说法过时，ops-mcp 已 22 工具） | cluster-F §12 | 总纲按现势改写 |

## P2 — 卫生/文档/边界裁决

- ~~**Purpose TBD 占位三处**~~ ✅已回填（实际扫出 6 处：dataset-export、dataset-form-editing、personal-workbench、alert-evaluation、cell-postgres-storage、personal-preferences；transform-pipeline 随改名消解）——2026-11-05。
- **O1/O3/O4 三本分立无冲突（cross-ref 延后）**：cluster-A 裁决无合并必要；交叉引用句属 Purpose 层，归档通道不动已有 Purpose（CLI 口径），延后至下次触及这些 spec 的内容 change 顺路补。
- **console 页被门户顶栏双横栏包裹**：已登录控制台双横栏+门户「登录」恒渲染（App.tsx:324），两本 shell spec 均无此口径——体验裁决项（cluster-D）。
- **引擎半边在仓外**：link/quality/check 工具实现主体在 cell engine 仓；indicator-catalog 两条实现主体在 business-mcp——下轮体检扩大到对侧仓（cluster-B）。
- **shell 修复密度全簇最高但 mock 测不出帧序类问题**：建议控制台壳加契约对拍（cluster-D）。

## 下一步

1. 用户对 P0×3 + P1-1（复发缺陷）拍板；其余 P1/P2 批量确认。
2. 拍板项逐个立修复 change（还债/收敛/性能各归各类）；本 change 不实施修复。
3. 方法学定稿后铺下一线（建议壹座 Base 或数据地基）。


## 2026-11-05 修复战役收尾注记

- 已修 9 项（P0×3 + P1-1/3/4/5/6/7/13 + P2 大部），open 项=P1-2（纪律）、P1-8（产品拍板）、P1-9（先查归属）、P1-11（补 spec 独立 change）、P1-12（观察名单）、O1/O3/O4 cross-ref（延后）、console/portal 双横栏（体验裁决）。
- 代码修复（landing-tab、metering 探针）已推 main 未出片——现网仍 sha-1c5dfc5，出片滚动待拍板。
- fd-wire 仓 cell-manager/* 未提交改动非本战役所为（疑并发会话），未触碰。
