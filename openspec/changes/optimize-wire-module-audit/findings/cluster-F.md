# 簇 F 体检卡：artifact/市场/内容/平台总纲（12 模块）

体检基线：fd-wire HEAD=5b782f2（2026-11-05，任务简报的 b3798ad 已是其祖先，`git merge-base --is-ancestor 1c5dfc5 HEAD`/`b3798ad HEAD` 均通过）；部署镜像 sha-1c5dfc5（deploy/k8s/fd-wire-api.yaml:46、fd-wire-web.yaml:32，roll 提交 b3798ad 2026-11-05），`git diff --stat 1c5dfc5..HEAD -- api/ web/` 为 0 行 → 部署态与 HEAD 代码等效，十二模块共此一判定（下文③不再重复）。仅读调查，未跑测试；R 根 spec 时间用 stat mtime，W 根用 git log。

---

## 1. artifact-lifecycle（W）——评级 B

理由：五类产物生命周期/草稿层/带内容创建/来源指针全部在码且 spec 同步，扣分项=证据发布门是 shadow 能力（无 spec）。
① 对齐：版本化/状态机 api/fd_wire_api/artifacts/service.py:366（list_versions）、:529（publish_artifact）、:620（archive_artifact）、:90（validate_kind_spec，kind 分派校验）；草稿层 routes.py:689/:716（GET/PUT /artifacts/{id}/draft）；带内容创建+showcase_slug 幂等 service.py:835-879；生产来源指针 artifacts/models.py:126（source_ref 列）+schemas.py:56。
② 测试：test_artifacts_lifecycle.py（2026-10-23）、test_form_artifacts.py（10-12）、test_artifact_evidence.py（10-27）在库。
④ 痛感：artifacts 路径 30 天 20 提交，绝大多数 feat；94e0ba9 为冒烟抓出的诚实面缺口修复，fix 密度低。
⑤ 陈旧：spec 2026-10-26（d4146ef）vs 代码 2026-10-27（458822f），剪刀差 1 天。
shadow：强断言识别+发布门 422（458822f、b1a2d28、roll 2e9dcea 证据门 enforce 已上产）与 artifacts/evidence.py、routes.py:127 /evidence 端点——grep 全部 W 根 spec 无「证据门/evidence」覆盖，且 wire-info-stream-program 亦无 spec（仅 dashboard-renderer 提及信息流滞后标注）。

## 2. artifact-marketplace（W）——评级 A

理由：四档可见性/订阅审批/只读看/可复制/签名链接零回归全部落码，与敏感度闭包同源 helper，spec-代码-测试三日内在。
① 对齐：可见性设置 market/artifact_service.py:159（set_visibility）、:105/:139（有效敏感度裁决）、:375（_strip_snapshots 复制剥快照）、:388（copy_artifact）、:495（绑定重映射）；路由 market/artifact_routes.py:112（PUT visibility）、:215（GET /market/artifacts）、:270（subscribe）；Q1 快照披露/双点闸语义在 service 内注释与实现一致。
② 测试：test_artifact_marketplace.py（2026-10-29）。
④ 痛感：market 路径 30 天 6 提交全 feat（4146d1b 落地、9e85cc4 橱窗、3d3df7b 闭包接线），零 fix 回刷。
⑤ 陈旧：spec 2026-10-30（934b1db）vs 代码 2026-10-29（3d3df7b），剪刀差 1 天。

## 3. showcase-market（W）——评级 A

理由：平台自营判定/匿名橱窗三硬条件/幂等导入/只读红线在 api 与 web 两侧同日落地，红线注释钉死。
① 对齐：平台发布方固定标识 market/platform_publisher.py:33（PLATFORM_PUBLISHER_NAME="finddata-official"）；匿名端点 market/showcase_routes.py:124/:149，查询硬条件在 market/showcase.py（app.py:319-321 注释指认）；web 只读红线 web/src/views/ShowcaseView.tsx:8-9（无保存/复制/CSV/导出图入口、不注入 noindex 与登录市场刻意相反）、:203-204。
② 测试：test_showcase_market.py（2026-10-20）、test_showcase_import.py（10-22）、ShowcaseView.test.tsx（10-21）。
④ 痛感：随 9e85cc4 一次性落地，后续零 fix 回刷。
⑤ 陈旧：spec 2026-10-20（9e85cc4 同提交）vs 代码同日，剪刀差 0 天。

## 4. wire-content-fleet（W）——评级 C

理由：spec 的舰队核心机制（fleet 段实例化、凭据轨计量、信号驱动节奏、重复节奏拒）在 fd-wire 仓库内无实现，本仓只落了 D6 来源指针与服务账号脚本；且 AI_CELL_ENDPOINT_MAP 配置漂移已咬过生产。
① 对齐：已实现——source_ref 生产来源指针 artifacts/models.py:126、schemas.py:56/81（D6，roll 510f10c 上产）；服务账号发号/护栏 scripts/provision_service_account.py:34（ORG_NAME="svc-fleet"，change add-fleet-service-accounts 9/12）。未证实在本仓——packs 模块（api/fd_wire_api/packs/，源包语义）grep 零 fleet 引用；「带 fleet 段 pack 安装即出舰队」「周期物化归刷新调度/重复节奏被拒」「凭据轨计量归属」均未见 fd-wire 侧入口（fleet 编排本体在壹座/paas 侧，paas 仓亦未 grep 到 fleet_template 实现，跨仓验证未证实）。
② 测试：api/tests/ 无任何 fleet 专名测试文件；最接近为 AI 通道映射测试（test_ai_infra.py、test_fd_mcp_client.py，覆盖 AI_CELL_ENDPOINT_MAP 解析）。
④ 痛感：bcf57e3「AI_CELL_ENDPOINT_MAP 显式 customer→cell 映射（email 型客户名约定派生必错…wire-content-fleet 5.1 配套）」——配置漂移实锤，且「新付费客户开户须追加 map」是持续运维负担；0f88e52 服务账号护栏为配套。
⑤ 陈旧：spec 2026-10-26（d4146ef）vs 本仓 D6 代码 2026-10-22（81ffaba 批内），剪刀差 4 天；但 spec 覆盖面与已实现面差距大（见①）。

## 5. wire-asset-catalog（R）——评级 B

理由：敏感度三级/有效敏感度闭包/父集登记/档位闸/传播撤回全在码且与产物面同源 helper，spec 与代码隔仓同步良好；扣分=双账本（R spec ↔ W 代码）。
① 对齐：闭包计算 api/fd_wire_api/assets/sensitivity.py:55（effective_sensitivity_bulk）、:177（单条）、:40（load_parent_edges）；目录/筛选 assets/routes.py；市场四档 market/browse.py（dataset 侧）；产物面复检复用同一 helper（market/artifact_service.py:105 调 assets.sensitivity）。
② 测试：test_assets_api.py（2026-10-29）、test_sensitivity_propagation.py（10-29）。
④ 痛感：assets 路径 30 天 4 提交（d648f07 落地→3d3df7b 闭包 v2），零 fix 回刷。
⑤ 陈旧：R 根 spec mtime 2026-10-30 06:18 vs 代码 2026-10-29（3d3df7b），剪刀差 1 天。

## 6. wire-data-steward（R）——评级 B

理由：五工具（读有效视图/三分支修正/历史/撤销/导出截断）在 wire-build-mcp 独立仓全部落码并有专项测试，actor 事实修正已按实现修订进 spec；扣分=实现不在本仓，跨仓核验深度有限。
① 对齐：/Users/chengsishi/finddata/wire-build-mcp/wire_build_mcp/tools_steward.py:90（wire_dataset_rows_read）、:114（correct，source 声明必填 _require_source:70）、:165（corrections_list）、:183（correction_revert）、:200（export）；基行永不改写/409 透传由 api 侧 datasets 修正层承担（test_local_corrections.py 镜像语义）。
② 测试：wire-build-mcp/tests/test_tools_steward.py 在库；fd-wire 侧 test_local_corrections.py（2026-10-11）。
④ 痛感：wire-build-mcp 仓最后提交 ae9302e（2026-10-26）为表面重构，无 fix 回刷迹象。
⑤ 陈旧：R 根 spec mtime 2026-10-16 vs 实现仓最后触碰 2026-10-26，剪刀差 10 天。

## 7. demand-intake（W）——评级 A

理由：三态机/邮件通知解耦/禁爬双闸/表单硬校验与 spec 逐条对应，废除态有迁移留痕，测试齐。
① 对齐：三态机 api/fd_wire_api/demands/statemachine.py:34-46（submitted/in_progress/delivered/rejected）、:65（废除态不可迁入，alembic 0019 归并）；邮件 notifications.py:3（wire@finddatatech.cloud，SMTP 往返后台线程、失败仅留痕）；禁爬源 source_policy.py（淘宝/拼多多系九域，与出单闸共用单一出处）；提交路由 demands/routes.py:102（submit_demand）。
② 测试：test_demands_statemachine.py（2026-10-11）、test_demands_notifications.py（10-11）、test_demands_blocklist.py（10-12）、test_demands_three_state_migration.py（2026-11-05 仍被触碰）。
④ 痛感：demands 路径 30 天 16 提交；d6b2bfc 三态化实施，fix 少（ef61470 属 workbench 不属本模块）。
⑤ 陈旧：spec 2026-10-12（35a9dac）vs 代码 2026-10-12（dff833b/a5aca4b 同日），剪刀差 0 天。

## 8. demand-orchestration（W）——评级 A

理由：出单映射/舰队拉取/推送回流/自动补扫/萬星直连/scope 重试全部落码，测试面是全仓最活跃（11-05 仍在补），生产校正均回写 spec。
① 对齐：出单 demands/routes.py:281（export_workorder）、:312（dispatch_wanxing）、:188（retry_demand_scope）；拉取/回推 routes.py:344/:353/:390（pending/ack/tracked/status-push）；自动补扫 auto_export.py:72（auto_export_demand，trigger=auto 标注）、:124（sweep_missing_exports）、:188（lifespan 循环）；萬星直连 wanxing.py（A2A message/send、WANXING_CALLER_KEY 缺失 503、Idempotency-Key）。
② 测试：test_demands_workorder.py（10-12）、test_workorder_status_push.py（10-12）、test_demand_auto_export.py（10-12）、test_wanxing_dispatch.py（10-12）、test_scope_retry.py（10-12）、test_admin_demands_workorder.py（10-11）、test_demands_pipeline_delivery.py（**2026-11-05**，最新）。
④ 痛感：有真实生产痛但都被驯化——a5aca4b（萬星实弹 validate_ticket 缺字段判红的根因修复）、b26de15（fd-prod raw 出站被挡→推送式改道，回写进 spec「轮询兜底可关」）。
⑤ 陈旧：spec 2026-10-13（e8da6b3）vs 代码 2026-10-12（2ddd4f2），剪刀差 1 天。

## 9. xingyan-content-supply（W）——评级 B

理由：幂等摄取/指纹/陈旧标记/claim 解析/对账在码，但 MCP 窄工具面声明本体在 wire-ops-mcp 独立仓，跨仓两处实现需对齐。
① 对齐：摄取 api/fd_wire_api/xingyan/sync.py:46（fingerprint）、:144（run，零差异重跑）、:335（_mark_failure，stale/schema_mismatch/upstream_error 不冒充空集）；claim 解析 xingyan/routes.py:114（resolve_claim）；对账只读 models.py:74（逐区比对用指纹）；工具面在 wire-ops-mcp（wire_content_browse/search + wire_claim_resolve，commit d5ca1dd 2026-10-31「声明 19→22」）——spec「安装/订阅后会话可探到」的在线验证未证实（需 live registry）。
② 测试：test_xingyan_content_supply.py（**2026-11-05** 仍在补）。
④ 痛感：runner.py:5 记录「CronJob 停机窗口错过一轮不补跑的教训（2026-10-26）」→ 已由对账脚本兜底，痛感一次、已闭环。
⑤ 陈旧：spec 2026-10-31（f15a3d6）vs 代码 2026-10-31（633014d 同日），剪刀差 0 天。

## 10. wire-base-integration（R）——评级 B

理由：HTTP 契约/env 可重指纪律在 config 与部署面实锤、无 agent-runner 直连；但 spec（4 条 Requirement）先于萬星直连与自报工具面两件新事，覆盖已薄。
① 对齐：env 可重指 api/fd_wire_api/config.py:1/:60（借用契约端点+同名环境变量优先）；FD_INFO_URL 指集群内 fd-info /mcp（deploy/k8s/fd-wire-api.yaml:57，注释明示必须带 /mcp）；SCOPE_API_BASE/TOKEN 接线（68a20d5，deploy/README scope 段）；grep api/ 无任何 agent-runner 内部接口直连（"runner" 命中均为 xingyan/schedules 自身 runner）——「不直连 runner」通过。壹座市场联动在对面实锤：paas/docs/registry-maintenance.md:79 自报工具面已接入 wire-build/wire-ops 等四服务（surface_source=self_report，巡检跳探活）。
② 测试：无专项文件（跨平台集成面以部署接线+对面仓为准），属结构性缺口。
④ 痛感：registry-maintenance.md:140 记录 wire 行数门 404→503 整线不可用事故（lex 客户 caller map 共享），痛感在对面接线层。
⑤ 陈旧：R 根 spec mtime 2026-10-06 vs 相关代码持续到 10-24（fd-info 接线 9db85fa），剪刀差约 18 天；spec 无 A2A 直连与自报工具面条目（见末节）。

## 11. source-packs（W）——评级 B

理由：静态包定义/filter 实时切目录/公开端点/幂等订阅/控制台页全在码，spec-代码-测试同日；扣分=此后 25 天零演化（未超 30 天红线）。
① 对齐：包查询 api/fd_wire_api/packs/service.py:50（readonly_session 只读面）、:59（indicators 按 filter 实时切片分页）、:97/:111（subscribe/unsubscribe 幂等+404）；定义 packs/definitions.py（静态 filter）；路由 packs/routes.py（公开 /api/v1/packs）。
② 测试：test_packs.py（2026-10-11）。
④ 痛感：30 天仅 1 提交（95f9863 落地），零 fix 回刷——安静但非痛。
⑤ 陈旧：spec 2026-10-11（c44b6d4）vs 代码 2026-10-11 同日，剪刀差 0 天；距今天 25 天未动，观察项。

## 12. wire-platform（R）——评级 B

理由：单域三入口/URL 契约/后台门禁/客户本地用量视图仍与现状相符，核心未过时；但公开面清单与后台边界两处已落后于产品面（详见末节过时点清单）。
① 对齐：三入口 deploy/README.md:58（Caddy：/、/console → fd-wire-web，/mcp → 反代 registry，TLS 同域同证书）；per-cell 存储用量+连接器健康只读视图 api/fd_wire_api/datasets/connector_routes.py:659（注释「无吊销/删除/白名单管理入口」）；后台 fail-closed 门禁 api/fd_wire_api/admin/auth.py；admin 职能=客户/计划/账本/需求单/目录治理/用量（admin/routes.py:143-710）。
② 测试：无 wire-platform 专名测试；平台面测试分散（test_admin_api.py、test_console_api.py 等）。
④ 痛感：ac21c52 revert 事故（sha-995a1cb 镜像含并发会话半成品 crashloop，回滚恢复生产）——部署管线痛感一次；后台控制台路由修复 757db0f/2026-10-20（admin 壳出口全指门户，管理员不可达控制台）。
⑤ 陈旧：R 根 spec mtime 2026-10-07 vs 平台面代码持续演化至 2026-11-05，剪刀差 29 天，逼近 30 天红线。

---

## 簇摘要：三件最严重的事

1. **R/W 双账本对同一状态机各执一词（最严重，接 O8）**：R 根 wire-demand-pipeline/spec.md（mtime 2026-10-06）仍规定八态「已提交、评估中、已报价、待确认、构建中、交付验收、已交付、已拒绝」，而 W 根 demand-intake/spec.md:11 明文 MUST 废除其中五旧态且代码（demands/statemachine.py:65、alembic 0019 归并）按 W 执行——两本账直接矛盾，R 侧至今未修。任何按 R spec 做的对面/下游开发都会做出与生产相反的客户面。
2. **已上产能力的 shadow 缺口**：产物证据发布门（强断言缺证据 422，roll 2e9dcea 已在产）与信息流刷新契约（cc416cb）在 api/tests/test_artifact_evidence.py 有测试、生产已 enforce，但 W 根 specs/ 无任何对应能力条目（grep「证据门/evidence/信息流」仅 dashboard-renderer 与 demand-orchestration 顺带提及）——不变量只活在代码里，后续 change 可能在不知情下破坏它。
3. **wire-content-fleet spec 覆盖面 > 本仓实现面**：舰队段实例化、凭据轨计量归属、信号驱动节奏、重复节奏拒绝四项核心 Requirement 在 fd-wire 内零代码（packs 模块 grep 零 fleet 引用），实现散在壹座侧与运维脚本且跨仓验证未证实；同域配置漂移已咬生产一次（bcf57e3 AI_CELL_ENDPOINT_MAP）。spec 现状是「半在册」，误读为已交付能力的风险高。

## O9 归属核验（wire-content-fleet）

结论：**W 侧归属成立，无双记账**。证据：
- R 根 `ls /Users/chengsishi/finddata/openspec/specs/ | grep wire-` 共 23 条（wire-analysis-console…wire-transform-pipelines），**无 wire-content-fleet**；`grep -i "content\|fleet"` 命中的 fleet-* 条目（fleet-platform-positioning、fleet-shared-packs、ops/marketing/lex/crossborder-*-fleet）均为壹座/其他线域，非 wire 内容舰队。
- wire-content-fleet spec 引用 R 根 pack-server-closure（校验沿用）属跨账引用，非双记账。
- 邻接观察：R 根 xingyan-* 七条是星研产品侧规格，W 根 xingyan-content-supply 是「星研内容进柏讯供给面」，域相邻但能力不重叠，判定无双记账；另发现一对潜在双账候选——W 根 wire-artifact-build-mcp 与 R 根 wire-build-mcp 两名并存（本簇未深查，建议列入后续归属核验）。

## O8 W 侧证据（demand-intake + demand-orchestration，待与簇 E 合并）

- W demand-intake（spec 2026-10-12）：拥有**现行三态状态机**（statemachine.py:34-46）、五旧态废除与 0019 归并、邮件通知、禁爬清单、我的需求只读列示——代码完全按 W 侧执行。
- W demand-orchestration（spec 2026-10-13）：拥有 **in_progress 之后的编排域**——确定性出单、舰队拉取投递/推送式回流、自动补扫、萬星直连第二通道、scope 交付重试；「编排不自动置 delivered」（spec.md:87）把终态交还 intake 的三态机，两能力边界清晰。
- R wire-demand-pipeline（spec 2026-10-06）宣称拥有状态机+AI 预评估+报价+scope 交付闭环，其中状态机八态与 W 冲突（见簇摘要#1）、报价流已被 W「报价不进状态机」（demand-intake spec:11）废弃；其「默认私有 scope 交付」与 W demand-orchestration 的自动开 scope 语义重叠但方向一致。分工建议口径：R 侧仅保留与爬虫构建流水线的衔接（conformance gate）与 AI 预评估的历史记录价值，状态机/交付归属 W——拍板留用户，**待与簇 E 合并**。

## wire-platform（R）过时点清单

1. 公开面清单过时：spec「单域三入口」（/、/console、/mcp）未覆盖已上产的**匿名橱窗**（/api/v1/showcase/*，app.py:319）与**星研公开内容面**（xingyan 目录/claim）两个第四/第五公开面——各自有专项 spec，但平台总纲的入口清单不再完整。
2. 内部后台边界被逼近：spec「后台仅商业运营职能，爬虫运维 SHALL NOT 迁入」，而 admin/routes.py:483/:509 现含工单导出与**萬星直连调度**（生成流水线投递动作）——属需求单派发的延伸尚可辩护，但「工单丢失/舰队拉取器状态」类编排监控已在后台呈现，红线距离在缩短，宜在 spec 补一句边界解释。
3. 萬星对接描述过时（与 wire-base-integration 同源）：spec/整合面只写 packs 台账通道，未覆盖 demand-orchestration 的 A2A `message/send` 直连 spider-heal 通道（2ddd4f2）——非 cell 部署故不违规，但总纲的兄弟线对接清单缺此通道。
4. 未过时项（核对为仍准确）：/mcp 反代 registry（deploy/README.md:58）、内部后台同域可达+fail-closed（admin/auth.py）、客户本地数据运营视图（connector_routes.py:659）、URL 契约稳定。

## wire-base-integration「13 条 wire 契约在册」抽查

- 该说法在 spec 本体无出处（spec.md 仅 4 条 Requirement，grep 无「13」）。可对应的两处在册事实：
  a) wire-ops-mcp 在册工具 13 条：出处 paas/docs/registry-maintenance.md:79（2026-10-26 快照「wire-build(17)/wire-ops(13)/wanxing-ops(8)/paper-trading(19)」）——**已过时**：wire-ops-mcp/tool-surface.json 现声明 22 工具（git d5ca1dd 2026-10-31「星研内容供给三工具…声明 19→22」）；live registry 是否已随自报机制刷新到 22 **未证实**（本次只读不探活）。
  b) wire 动作闸自理动作 13 条：archive/2026-10-30-wire-domain-actions/proposal.md:5「现注册的 13 条动作全部是平台自理动作」——属 wire-domain-actions 模块，不在本簇 12 模块内，未核今数。
- 建议：若该说法用于对外/跨线汇报，应改写为「wire-build-mcp 17 + wire-ops-mcp 22（2026-10-31 声明）」或以 live registry 实测为准。
