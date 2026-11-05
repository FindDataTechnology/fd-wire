# 簇 C 体检报告：转换/管线/MCP 面（11 模块）

体检员：簇 C；日期 2026-11-05；fd-wire HEAD=5b782f2（任务简报写 b3798ad，实查 HEAD 为 5b782f2，2026-11-05 20:45，已按实际 HEAD 取证）。只读调查，未改任何文件（本卡除外）。

---

## 1. wire-transform-pipelines（R 根）— 评级 A

管线执行引擎：版本化步骤链、九种步骤、DAG 拓扑执行、租约队列异步执行器。spec 与代码同日演进，测试厚。

- ① 对齐：定义/路由 `api/fd_wire_api/pipelines/routes.py:187-634`（list/create/run/cancel/schedule）；DAG+重试执行器 `api/fd_wire_api/pipelines/executor.py:131-282`（_is_retryable/_resume_interrupted/execute_new_run）；租约队列 `api/fd_wire_api/pipelines/queue.py:76-89`（claimed_by+heartbeat_at）；九算子直调 `api/fd_wire_api/pipelines/service.py:479-507`（filter/project/aggregate_derive/union/window/sql），工具名常量 `api/fd_wire_api/datasets/ingest.py:73-81`；app.py:66-72、197 挂路由+起 worker。spec Requirement 全部有实现落点，无 shadow。
- ② 测试：`api/tests/test_pipelines.py`（27 test，mtime 10-31）、`test_pipelines_dag.py`（23，10-31）、`test_pipeline_operators.py`（6，10-29）。
- ③ 部署态：api/web 镜像 sha-1c5dfc5（deploy/k8s/fd-wire-api.yaml:46），`git merge-base --is-ancestor 1c5dfc5 HEAD` 成立；pipelines 末次提交 e27b9ef（10-31）**在** 1c5dfc5 内 → 现网即最新。
- ④ 痛感：`git log --oneline --since=2026-09-05 -- api/fd_wire_api/pipelines` 共 5 条，0 fix（全 feat）。
- ⑤ 陈旧度：spec mtime 2026-10-31 14:43 vs 代码 10-31 14:28，Δ<1 天。

## 2. transform-pipeline（W 根）— 评级 B

管线可视化面：派生图端点+管线视图+重派生/定时管理。与 R 根同名异根（裁决见 O6）。

- ① 对齐：图端点 `api/fd_wire_api/pipeline/routes.py:20-21`（GET /graph）+ `api/fd_wire_api/pipeline/graph.py:40,82`（NODE_LIMIT=500、anomalies/truncated 冻结契约）；web 视图 `web/src/console/pipeline/PipelineView.tsx`/`PipelineGraphView.tsx`；重派生/定时 `web/src/console/DatasetDetail.tsx`、`pipeline/PipelineScheduleSection.tsx`。三 Requirement 全对齐，无 shadow。
- ② 测试：`api/tests/test_pipeline_graph.py`（8 test，10-11）；web `PipelineView.test.tsx`、`PipelineWorkbench.test.tsx` 等 7 个测试文件在 `web/src/console/pipeline/`。
- ③ 部署态：同上 sha-1c5dfc5 含 pipeline/ 末次提交 2e48d47（10-11）→ 现网最新。
- ④ 痛感：since 2026-09-05 仅 1 条提交，零 fix。
- ⑤ 陈旧度：spec 末次 git 提交 2026-10-11 09:14 vs 代码 10-11 07:08，Δ<1 天。扣分点：spec Purpose 仍是「TBD - created by archiving change wire-transform-pipeline-view. Update Purpose after archive.」（spec.md:4）——归档后未按纪律回填。

## 3. wire-build-mcp（R 根）— 评级 B+

产物构建 MCP（独立服务，代码仓 /Users/chengsishi/finddata/wire-build-mcp，gitee FindDataTechnology/wire-build-mcp）。整服务契约：草稿优先、列名事实、档位分流、双轨鉴权透传。

- ① 对齐：draft-first 与零半写 `wire_build_mcp/tools_console.py:293-354`（空白建档→PUT spec→补偿归档，`_source_ref`:293）；dashboard/doc 工具 `tools_console.py:391,411`（kind 映射 :31-32）；publish 独立（docstring :4、:370「创建即 published 的参数不存在」）；工具面 17 工具（tool-surface.json tool_groups 合计 17，含 build 12+steward 5）。**shadow**：steward 五工具（corrections 读写/导出）不在 R spec 六条 Requirement 内（可能有 W 根 wire-data-steward 承接，未查证归属）。
- ② 测试：tests/ 5 文件（test_tools.py 25 test、test_tools_steward.py、test_surface_report.py、test_client.py、test_auth_gate.py；mtime 10-16~10-26）。
- ③ 部署态：清单镜像 `wire-build-mcp:sha-4ae7809`（fd-infra-deploy/all-services/prod/wire-build-mcp.yaml:41）；4ae7809 不在本仓 git 对象中，但清单注释声明「快照 sha-4ae7809 = 真 sha 7c21bbf」，`git merge-base --is-ancestor 7c21bbf HEAD` 成立（7c21bbf=10-26 00:43 fix）。仓库 HEAD ae9302e（10-26 01:11，纯 surface 重构）领先现网 1 commit——部署基本新鲜、出处映射依赖注释非机器可验证。
- ④ 痛感：since 2026-09-05 共 11 commit，2 fix——7c21bbf「fastmcp 4.x 无 get_tools，启动自报一发未出即被吞成 failed」+ 4c8c6dc「构建期无事件循环 create_task 必炸」＝生产可观测性事故两连，已修。
- ⑤ 陈旧度：spec mtime 2026-10-31 06:43（已吸收 dashboard/doc+source_ref）vs 代码 10-26，Δ5 天。

## 4. wire-artifact-build-mcp（W 根）— 评级 A

dashboard/doc 两产物的行为契约（wire-build-mcp 的能力增量切片）。

- ① 对齐：`wire_artifact_dashboard_create`/`wire_artifact_doc_create` 实现于 `wire-build-mcp/wire_build_mcp/tools_console.py:391,411`；草稿优先=docstring :4「发布是独立的 wire_artifact_publish」；零半写=补偿归档 :305-354；source_ref 进版本行 :315-329；「未声明参数 MCP 层拒」=auth_gate 拒绝形态（tools_console.py:182）。六 Requirement 全对齐。
- ② 测试：`wire-build-mcp/tests/test_tools.py` 内 dashboard/doc 相关 test 5 个（文件 25 test，mtime 10-23）。
- ③ 部署态：现网 7c21bbf ⊃ 86d634a（10-23「dashboard/doc 两工具+source_ref」）→ 能力已上产。
- ④ 痛感：build-mcp 仓 since 9-05 的 2 条 fix 均非本切片。
- ⑤ 陈旧度：spec 末次提交 2026-10-26 vs 代码 10-23，Δ3 天。

## 5. wire-mcp-client（R 根）— 评级 B

平台调用 MCP 的唯一客户端包 `api/fd_mcp_client/`（native 单模式）。

- ① 对齐：native 客户端 `api/fd_mcp_client/native.py:90-238`（NativeMcpClient：握手/会话/call/list_tools）；协议版本试探 native.py:43-44（版本序列 2025-06-18→2024-11-05）+152-165（400+protocol 降档）；端点约定派生 `ai/executor.py:44-56`（fd-wire-cell-<cid>/mcp，MAP 优先）与 `datasets/ingest.py:6-8,144`；「cell 未开通」如实报错 ingest.py:144。消费方 ai/executor.py、datasets/ingest.py、indicator_fetch.py。无 gateway 模块 → 与 Requirement「统一客户端 native 单模式」一致。**spec 内部矛盾**：Requirement 1「统一客户端双模式」与 Requirement 2「计量轨道不变量」（gateway 语义）仍留在 spec，被后两条「native 单模式」「计量轨道不变量（端点决定）」取代（退役 commit 7875600「gateway 简化形态退役」）——append-only 残留造成一册账内新旧互相否定。
- ② 测试：`api/tests/test_fd_mcp_client.py`（17 test，mtime 10-07）；另有 test_catalog_client_mcp.py。
- ③ 部署态：随 api 镜像 sha-1c5dfc5（fd_mcp_client 末次提交 7875600/10-07 在内）→ 现网最新。
- ④ 痛感：since 9-05 相关路径 9 commit，0 专项 fix（多为周边 feat 搭车）。
- ⑤ 陈旧度：spec mtime 2026-10-07 vs 代码 10-07，Δ0 天（但账内矛盾未清，见①）。

## 6. wire-ops-mcp（R 根）— 评级 C

客户面操作 MCP（独立服务 /Users/chengsishi/finddata/wire-ops-mcp，gitee 同步）。spec 仍锚「十工具 v1」，代码/清单已 22 工具。

- ① 对齐：十工具 v1 部分（需求单 3+数据面读 4+市场 3）在 `wire_ops_mcp/tools_console.py`；域动作三工具 `tools_console.py:269-308`（wire_action_list/propose/status，对齐 W 根 wire-domain-actions）。**显著超账**：tool-surface.json 合计 22 工具（packs 3、objects 3、actions 3、content 3 各组为 R spec 十工具清单之外），R spec「Ten-tool v1 subset with explicit writes」已失真；packs/objects/content 三组在本簇 11 spec 中无对应 Requirement（objects/content 可能由 wire-entity/xingyan 簇承接，未证实）。
- ② 测试：tests/ 4 文件（test_tools.py 10-21、test_surface_report.py 10-26、test_client.py、test_auth_gate.py 均在）；但 test_tools.py 中 grep 不到 wire_action_* 用例——域动作工具无服务侧单测钉住（未证实是否有 e2e）。
- ③ 部署态：清单镜像 `wire-ops-mcp:sha-e5b9185`（wire-ops-mcp.yaml:30），**sha-e5b9185 与 33ff697 均不在本仓 gitee 对象中**（`git cat-file -t` 双双 fatal）；清单注释仍写「快照 sha-33ff697 = canonical gitee 99882f3」与现行镜像 tag 不一致。本地仓与 gitee 零偏差（HEAD=d5ca1dd 双向 0 commit）。若现网≈99882f3（v0.1.0 十工具），则 packs/objects/actions/content 12 个工具（562f416/0c16cd6/d5ca1dd 三批）未上产——**部署版本无法确证，未证实**，是本簇最大盲区。
- ④ 痛感：since 9-05 共 7 commit，0 fix。
- ⑤ 陈旧度：spec mtime 2026-10-16 vs 代码 10-31，Δ15 天且为「代码超前 spec」（十工具→22 工具），账实剪刀差持续扩大。

## 7. wire-action-gate（W 根）— 评级 A-

动作闸：AI 提议、风险分档确认、单一执行路径、审计台账。

- ① 对齐：注册表/未注册拒绝 `api/fd_wire_api/ai/actions.py:170-198`（resolve_action、ACTION_TO_TOOL_NAME:198）；风险→档位 `actions.py:52-62`（RISK_TO_TIER write=inline/destructive,cost=second/publish=async）；异步审批+惰性过期 `ai/routes.py:440-459,497`（approve 端点、「读时发现超时即置 expired，fail-closed」）；preflight 原语 `actions.py:213-260`（_require_engine/_deny_viewer/_own_*）；审计脱敏 `actions.py:360,1107`（redact_credentials 落 result_summary）；对拍钉子 test_ai_actions.py docstring :1-3「注册表/提议/确认/审批/审计/过期/对拍」。spec 十条全有落点；ACTION_TO_TOOL_NAME 九条与 tool_risk 对拍由测试钉住。
- ② 测试：`api/tests/test_ai_actions.py`（19 test，mtime 10-21）。
- ③ 部署态：actions.py 末次提交 33f8fbb（10-31）**在**现网 sha-1c5dfc5 内 → 最新。
- ④ 痛感：since 9-05 共 6 commit，2 fix 且均为 6.2 真机验收咬出的缺口（171b2e8 分享令牌落审计、48f957a 草稿转正补建档）——已收敛。
- ⑤ 陈旧度：spec 末次提交 2026-10-30 vs 代码 10-31，Δ1 天。

## 8. wire-domain-actions（W 根）— 评级 A-

客户域动作类型：声明/效果执行落修正层/MCP 提议通道/控制台管理面。

- ① 对齐：`api/fd_wire_api/domain_actions/{routes,service,models,builtins}.py`（service.py 效果三通道、builtins.py 内置 entity-declare/entity-relation-declare）；闸侧动态注册 `ai/actions.py`（domain.{type_id}，spec wire-action-gate Requirement 1 的双来源由本模块供源）；MCP 通道 `wire-ops-mcp/wire_ops_mcp/tools_console.py:269-308`；web `web/src/console/DomainActionsPanel.tsx`。修正层通道归属 domain-action:* 于 service.py（ADR-0006）。
- ② 测试：`api/tests/test_domain_actions.py`（19 test，mtime 10-29）；ops-mcp 侧无对应单测（见模块 6②）。
- ③ 部署态：domain_actions 末次提交 bd41366（11-01）**在**现网 sha-1c5dfc5 内；但 ops-mcp 三工具的现网在场性未证实（模块 6③）。
- ④ 痛感：since 9-05 共 3 commit 全 feat，0 fix。
- ⑤ 陈旧度：spec 末次提交 2026-10-31 12:27 vs 代码 11-01，Δ<1 天。

## 9. connector-distribution（W 根）— 评级 B+

连接器二进制发布/取件闭环 + 客户教程。

- ① 对齐：下载端点 `api/fd_wire_api/downloads/routes.py:116-127`（manifest+按平台二进制，_not_configured:65 诚实降级）；无鉴权注记 `app.py:280-282`；配对向导真实链接 `web/src/console/DatasetsConnectors.tsx:397-448`（版本/sha256 展示复制、不可用态 :401）；版本对照提示 DatasetsConnectors.tsx:9；CI 晋升 `.github/workflows/build.yml:104-125`（connector-test→connector，产物 fd-wire-connector-<os>-<arch>，版本注入 git sha）。五 Requirement 全对齐；客户教程章节（web 文档页双语）有 i18n 键但未逐条核「三步样例」完整性——部分未证实。
- ② 测试：`api/tests/test_datasets_connectors.py`（13 test，10-13）；web `DatasetsConnectors.test.tsx`。
- ③ 部署态：downloads 路由随 api 镜像 sha-1c5dfc5（末次提交 d17e5f1/10-11 在内）；连接器二进制为 CI 产物非容器，无 sha-tag 可对账——分发面以 manifest 为事实源，符合 spec。
- ④ 痛感：since 9-05 downloads 仅 1 commit，0 fix。
- ⑤ 陈旧度：spec 末次提交 2026-10-11 vs 代码 10-11，Δ0 天。

## 10. wire-local-connector（R 根）— 评级 A-

Go 出站连接器：白名单轮询、增量水位、REST 适配器。

- ① 对齐：REST 适配器 `connector/internal/adapters/rest/rest.go`（声明式分页/投影/水位路径）；增量水位 `connector/internal/runner/watermark.go`（+零行不上报语义）；同步通道 `connector/internal/client/sync.go`、远端配置 `client/remoteconfig.go`；核心四件（配对/轮询/推送/心跳）在 runner/scheduler/client/config 四包，与「新源型不改核心」结构一致。八 Requirement 全有落点，无 shadow。
- ② 测试：Go 单测 4 文件（runner_test.go、watermark_test.go、rest_test.go、client_test.go）；CI build.yml connector-test job（go 1.x + cache）先测后产。
- ③ 部署态：连接器以单二进制分发（build.yml 产物+版本 sha 注入），不经 k8s 清单——无可对账镜像，符合 spec「单二进制交付」。
- ④ 痛感：since 9-05 共 3 commit，0 fix（REST 源/四算子为 feat 波次）。
- ⑤ 陈旧度：spec mtime 2026-10-30 06:18 vs 代码 10-29（3d3df7b），Δ1 天。

## 11. caller-preflight-map（W 根）— 评级 B

wire 入口余额/行数预检的调用者映射（映射写侧+额度数据源在本仓；402 闸本体在 registry 侧）。

- ① 对齐：映射随开户自动建立 `api/fd_wire_api/console/onboarding.py:59`（CALLER_MAP_PATH="/api/sub2api-caller-map"）、:184-187 write_caller_map、:355 开户流程调用；当月行数门数据源 `api/fd_wire_api/billing/routes.py:146-156`（GET /internal/quota/{caller}，未知 caller 404 fail-closed、非 active 额度归零）；月度聚合唯一实现 `billing/routes.py:69-70`（monthly_used_lines）；余额门客户端 `billing/sub2api.py`（probe :253）。**402 拒绝与 deny 策略本体不在本仓**（registry 预检探针消费 /internal/quota；finddata/MCP-REGISTRY.md:355 记载 402 INSUFFICIENT_BALANCE 语义与 /tmp/preflight_quota.jsonl 判据）——闸侧行为在本仓内未证实，映射侧与额度侧已证实。
- ② 测试：billing 系列测试 7 文件（test_billing_sub2api_client.py 等）；未见 caller-map 写入专项测试（onboarding 相关测试存在与否未证实）。
- ③ 部署态：随 api 镜像 sha-1c5dfc5（onboarding.py 末次提交 b717c7d/10-10 在内）→ 现网最新；registry 侧探针版本无法在本仓对账。
- ④ 痛感：since 9-05 相关路径 5 commit，2 fix 且都是生产契约咬合伤：f226cae「sub2api 客户端按生产实测契约重写（跨线挂账 #1）」、0ba2e85「铸 key 通道 form 形状生产 422」——上游契约不稳定曾造成实痛，已钉死。
- ⑤ 陈旧度：spec 末次提交 2026-10-10 vs 代码 10-10，Δ0 天。

---

## 簇摘要：最严重三件事

1. **wire-ops-mcp 部署态不可对账（C 评的主因）**：现网镜像 tag `sha-e5b9185`（wire-ops-mcp.yaml:30）在 gitee canonical 仓对象中不存在，清单注释仍停留在旧映射「33ff697=99882f3（v0.1.0 十工具）」；而仓内代码已 22 工具（spec 只认十工具）。若现网确为 99882f3 代际，则 wire_action_*（wire-domain-actions 的 MCP 通道）、packs/objects/content 共 12 个工具未上产——这直接动摇 wire-domain-actions 与 R wire-ops-mcp 两条 spec 的部署面成立性。修法：把「镜像 tag 必须可 `git merge-base --is-ancestor` 验证」定为清单纪律，补对账脚本（build-mcp 已是先例：注释里真 sha 可验证）。
2. **wire-mcp-client spec 账内自我矛盾**：Requirement 1「统一客户端双模式」+Requirement 2「计量轨道不变量」（gateway 语义）与 Requirement 4「native 单模式」+Requirement 5「端点决定」同册并存且互斥（代码已是 native 单模式，gateway 于 7875600 退役）。读者按 Req 1/2 理解会得出错误的计量结论（gateway 轨已不存在）。建议按 OpenSpec 纪律出一次 delta 把被取代的两条 REQUIREMENT 标 REMOVED/MODIFIED 归档。
3. **O6 命名撞车 + W 账 Purpose 缺失**：transform-pipeline（W）与 wire-transform-pipelines（R）同名异根，且 W 账 Purpose 仍为「TBD - created by archiving change wire-transform-pipeline-view」（transform-pipeline/spec.md:4）——检索与对账时极易把可视化账当引擎账。

## O6 裁决建议：wire-transform-pipelines（R） vs transform-pipeline（W）

证据链：两边 Requirement 集合**零交集**。R 账 12 条全部是引擎面（版本化/九步骤/槽位/run 留痕/cron/隔离/算子契约/SQL 护栏/DAG/租约执行器），实现于 `api/fd_wire_api/pipelines/*`；W 账 3 条全部是可视化面（GET /api/v1/pipeline/graph 只读图、web 管线视图、数据集详情页重派生与定时登记），实现于 `api/fd_wire_api/pipeline/{routes,graph}.py` 与 `web/src/console/pipeline/`——api/app.py:41-42 与 66-72 的注释本身就按两本账分挂两个路由（「管线图（wire-transform-pipeline-view）」vs「变换管线（wire-transform-pipelines）」）。两边无一条 Requirement 在对方账中有重述，连「定时」都是两回事（W=按数据集 materialized_artifacts 重派生登记，R=管线级 cron 调度）。**结论：真重复＝否；这是「契约面（引擎） vs 实现面（可视化/控制台）」的分工，但命名撞车制造了最危险的同名异根假象。** 建议真源：R 根 wire-transform-pipelines 为管线引擎唯一真源；W 账改名（如 pipeline-graph-view）或并入 R 账作「控制台可视化与管理」Requirement 组，同时回填 W 账 TBD Purpose。拍板留给用户；本体检未改任何 spec。

## O7 裁决建议：wire-build-mcp（R） vs wire-artifact-build-mcp（W）

证据链：**同一服务，两本账**。代码面只有一物：/Users/chengsishi/finddata/wire-build-mcp（gitee FindDataTechnology/wire-build-mcp），部署面也只有一物：fd-infra-deploy prod/wire-build-mcp.yaml（镜像 sha-4ae7809=真 sha 7c21bbf，ancestor 成立）。工具面：wire_artifact_dashboard_create/wire_artifact_doc_create 就在 wire-build-mcp 的 tools_console.py:391,411，tool-surface.json 17 工具内含之。账面：W 账（10-26 归档）是 dashboard/doc 能力切片的 5 条 Requirement；R 账（mtime 10-31 06:43）随后吸收了同一能力——「四类产物共用同一写入纪律」Requirement 已把 dashboard/doc 写进 R 账正文，且 source_ref 以 Scenario（「来源指针可选」，spec.md:132-135）入账。逐条比对：W 的「草稿优先，发布独立」「零半写补偿」「错误口径带事实」「产物携带生产来源」四条在 R 账的 Draft-first/Spec errors/四类产物纪律/来源指针 Scenario 中逐语义重述，仅 W 的「dashboard 与 doc 的写入工具」（工具存在性声明）是 R 账未单列的薄条目。**结论：两账一物，R 账 10-31 更新后 W 账实质成为冗余窄拷贝，仅剩工具名清单一条增量。** 建议：以 R 根 wire-build-mcp 为唯一真源；W 账归档删除或改写为指向 R 账的索引页（保留 wire_artifact_dashboard_create/doc_create 工具名与 tool_risk 标注的登记职能）。注意连带：wire-action-gate 的对拍条款引用「wire-ops-mcp / wire-build-mcp 的工具面清单」，删除 W 账不影响该对拍（对拍对象是 tool-surface.json 而非 spec）。拍板留给用户；本体检未改任何 spec。
