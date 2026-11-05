# 簇 E 体检卡：看板/分析/调度/需求管线（8 模块）

体检基线：fd-wire HEAD=5b782f2（2026-11-05，b3798ad 已是其祖先，`git merge-base --is-ancestor b3798ad HEAD` 通过）；部署镜像 sha-1c5dfc5（deploy/k8s/fd-wire-api.yaml:46、fd-wire-web.yaml:32），`git diff --stat 1c5dfc5..HEAD -- api/ web/` 为空 → 部署态与 HEAD 代码等效，八模块共此一判定（下文③不再重复）。仅读调查，未跑测试。

---

## 1. dashboard-refresh（W）——评级 A

理由：契约/AI 双路径、单飞、试取端点全部在码且有同日 spec 与测试，无漂移。
① 对齐：刷新端点 api/fd_wire_api/artifacts/routes.py:410-412；契约执行 api/fd_wire_api/artifacts/query_contract.py:265（refresh_spec_with_contracts）、:143（contract_refresh_plan，raw_option 不入计划）；单飞 api/fd_wire_api/artifacts/refresh.py:313-322（409）；raw_option kept refresh.py:282-283；试取端点 routes.py:524。
② 测试：api/tests/test_artifacts_refresh.py（2026-10-20）、test_query_preview.py（10-11）均在。
③ 部署：等效 HEAD（见基线）。
④ 痛感：`git log --since=2026-09-05 -- api/fd_wire_api/artifacts/` 全为 feat（2e48d47→458822f 共 20+），无 fix 回刷。
⑤ 陈旧：spec 2026-10-20（9e85cc4）vs query_contract.py 最后触碰 2026-10-20（9e85cc4 同提交），剪刀差 0 天。

## 2. dashboard-renderer（W）——评级 A

理由：v2 类型谱/编码通道/panes/叠加层/raw_option/list 面板在渲染器逐一可见，web 测试活跃，spec 逐 Requirement 可对表。
① 对齐：web/src/console/dashboard/DashboardRenderer.tsx:6-8（v2 类型谱注释）、:124（list 类型分派）、:152（raw_option 直通）、:233-235（panes 降级标注）、:581+（list 卡片流）；编辑器 DashboardEditor.tsx（621 行，含 QueryBinding 测试）。18 条 Requirement 中「MCP 产出与渲染同路径」的工具面声明在 api/fd_wire_api/ai/actions.py:195，但 MCP server 运行时本体不在本仓 api/，直接验证未证实。
② 测试：web 侧 DashboardRenderer.test.tsx（10-21）、DashboardEditor.test.tsx（10-21）、DashboardPane.test.tsx（10-11）、DashboardEditorQueryBinding.test.tsx（10-11）、InfoQuery.test.tsx（10-23）。
③ 部署：web 镜像 sha-1c5dfc5 等效 HEAD。
④ 痛感：web/src/console/dashboard/ 近 30 天 11 个提交全 feat（ef98203 list 面板、f340d33 信息流滞后标注）。
⑤ 陈旧：spec 2026-10-26（d4146ef）vs 渲染器最后触碰 2026-10-24（f340d33），剪刀差 2 天。

## 3. dashboard-share（W）——评级 A

理由：四类链接+TTL 自选+0 档长效+HMAC 语义与 spec 逐条对得上，spec 与代码同日改。
① 对齐：api/fd_wire_api/share/service.py:72-93（HMAC-SHA256、ttl=0 无到期哨兵）、share/routes.py:181（生成）、:276（dashboard 打开）、:326（doc）、:418/:447（form 渲染/提交）、:688（record-view）、:580（form options）；分享整体禁用语义 service.py:46-52。
② 测试：api/tests/test_share.py（10-15）、test_share_doc.py（10-17）、test_share_form.py（10-12）、test_share_form_options.py（在库）。
③ 部署：等效 HEAD；FD_WIRE_SHARE_SECRET 经 secretKeyRef 注入（deploy/k8s/fd-wire-api.yaml:131-133）→ 分享面在生产是开着的。
④ 痛感：5 个提交（b898f06 TTL 自选、759cf50 doc 分享、66e1ac0/4e18d46 form），无 fix 回刷。
⑤ 陈旧：spec 2026-10-17（3729265）vs share/routes.py 最后触碰 2026-10-17（759cf50），剪刀差 0 天。品牌面四态（og:/noindex）在 web 侧未逐项核验，未证实。

## 4. wire-analysis-console（R）——评级 B

理由：五类产物/AI 入口/计量/证据块/强断言门全部在码且生产 enforce，但 R spec 两条客户承诺（时区调度、邮件通知）在码中无实现。
① 对齐：五类 kind api/fd_wire_api/artifacts/models.py:39-45；AI 对话构建 api/fd_wire_api/ai/loop.py + reads.py（探索读取按 customer_id 过滤，ai/reads.py:92-117）；物化计量走客户主体 api/fd_wire_api/schedules/executor.py:47（_scheduler_principal）；证据块 api/fd_wire_api/artifacts/evidence.py + 提交 458822f（2026-10-27）；强断言发布门生产即 enforce（deploy/k8s/fd-wire-api.yaml:62-63 EVIDENCE_GATE_MODE=enforce）。缺口：R spec「按客户时区配置调度」——api/fd_wire_api/schedules/ 全目录 grep timezone/tz 仅命中 UTC now（models.py:28），无时区概念；「告警通知含电子邮件」——api/fd_wire_api/alerts/ 全目录 grep email/smtp 零命中，仅 webhook（evaluator.py:73 deliver_webhook）。
② 测试：api/tests/test_console_api.py（10-11）、test_console_resilience.py（10-15）；时区/邮件两条无对应测试（与未实现一致）。
③ 部署：等效 HEAD；enforce 门已上产。
④ 痛感：458822f（强断言门）、f340d33/cc416cb（信息流滞后标注）皆 feat；无 fix 回刷。
⑤ 陈旧：spec mtime 2026-10-27 vs 代码 2026-10-27（458822f），剪刀差 0 天；但 spec 三条承诺性 Requirement 属「账本超前」——写进了未实现行为，建议要么补实现要么在 spec 注明未上产（裁决留用户）。

## 5. wire-analysis-presets（R）——评级 C

理由：spec 是技能套件供给面契约，本仓（fd-wire api/web）零实现入口，本仓视角不可验证——账本与代码仓错位。
① 对齐：`grep -rin "preset|谦面|预设" api/fd_wire_api --include='*.py'` 仅命中 api/fd_wire_api/config.py:75（谦面 registry URL 转发配置）；allowTools/fullSurface 声明消费点在 api/fd_wire_api/ai/actions.py:195（tool-surface 对表），但改编 gate/打包/组门本体不在本仓。结论：实现面在仓外（技能供给工具链），本仓无 shadow 也无对齐可判——未证实。
② 测试：api/tests/ 无任何 preset/谦面 相关文件（grep 零命中）。
③ 部署：N/A（无本仓代码可部署）。
④ 痛感：`git log --since=2026-09-05` 对相关路径零提交。
⑤ 陈旧：spec mtime 2026-10-31（新鲜）；代码侧无剪刀差可比。建议：该 spec 的实现仓归属应在审计总表登记（避免"谁家孩子没人认"），裁决留用户。

## 6. alert-evaluation（W）——评级 B

理由：评估器/状态机/通知/管理面四 Requirement 全部在码且 lifespan 在跑，生产冒烟抓过一真 bug 已修；扣分项是 spec Purpose 仍是 TBD 占位。
① 对齐：api/fd_wire_api/alerts/evaluator.py:162（evaluate_once）、:349（tick_once）、:405（_evaluate_rule，published 过滤/边缘状态机）、:73（webhook 5s）、:595（_loop）+ app.py:164（start_alert_evaluator）；试运行 routes.py:137（test_alert_rule）、事件面 routes.py:107（list_alert_events，客户隔离）；契约校验 spec_validate.py。
② 测试：api/tests/test_alerts.py（2026-10-12，与实现同批）。
③ 部署：等效 HEAD；k8s env 无 ALERT 开关（默认启动即跑）。
④ 痛感：`git log --since=2026-09-05` 仅 2 条——c980962（实现）+ 6e8ab12「修 alerts/states 在 PG 上的 GroupingError（生产冒烟实弹抓出）」（2026-10-12）：生产实弹暴露过 PG 方言 bug，属已闭环的真痛感。
⑤ 陈旧：spec 2026-10-12（c5bb270）vs evaluator.py 最后触碰 2026-10-12（6e8ab12），剪刀差 0 天；但 spec.md:4 Purpose 仍为「TBD - created by archiving change wire-alert-evaluation. Update Purpose after archive」——归档时承诺的补写未做，hygiene 欠账。

## 7. refresh-scheduler（W）——评级 B

理由：调度表 CRUD/地板/配额/tick 循环/级联防环/失存清理全在码，与 spec 前三 Requirement 逐条对上；第四 Requirement（舰队产物归调度）在本仓无直接实现痕迹。
① 对齐：api/fd_wire_api/schedules/service.py:45（间隔地板 dataset≥60/artifact≥360）、:119（create，配额+类型校验）、:197（due_schedules）、:217-223（mark_running/finished）；executor.py:62/99（dataset/artifact 执行，客户主体）、:89（cascade_refresh_children 级联）；失存清理 executor.py:34（TargetGone）；tick 循环 app.py:156（start_refresh_scheduler）。
② 测试：api/tests/test_schedules.py（2026-10-11，与实现同日）。
③ 部署：等效 HEAD。
④ 痛感：近 30 天仅 1 条提交（b898f06 实现本身），零 fix 回刷——无运行痛感证据（也可能是无流量，未证实）。
⑤ 陈旧：spec 2026-10-26（d4146ef，wire-content-fleet 归档并入「舰队产物的周期刷新 SHALL 归刷新调度」）vs 代码最后触碰 2026-10-11（b898f06）——spec 比代码新 15 天，剪刀差未超 30 天不判 stale，但新 Requirement 在 api 内无正向登记代码（`grep 岗位节奏|cadence` 仅命中 quality/service.py:429 的 dataset cadence_hint，与舰队模板无关）——「岗位不承担物化」以代码缺席形态一致成立，舰队侧登记路径未证实。

## 8. wire-demand-pipeline（R）——评级 D

理由：R spec 三条 Requirement（八态状态机、gate 必过才交付、报价经人工确认）已被代码有意识废除，spec mtime 落后于废除动作且未更新——双账分裂实锤。
① 对齐（相悖证据）：R spec 需求「需求单状态机」八态 ↔ 代码三态 api/fd_wire_api/demands/statemachine.py:31-46（「三态状态机（wire-ux-consolidation 任务 3.1，自八态压缩）」，evaluating/quoted/awaiting_confirm/building/delivery_acceptance 五态废除只 409）；R spec「流水线衔接与一致性门禁：conformance gate SHALL 必须通过才可进入交付验收」↔ api/fd_wire_api/demands/pipeline.py:10-13（「wire-ux-consolidation 3.1 起 gate 不再门禁状态迁移……仅作构建质量观测留档」）；R spec「报价 SHALL 经人工确认后才发出」↔ api/fd_wire_api/demands/routes.py:245-257（quote 端点「旧八态工作流遗留……一律 409」）。仍对齐部分：AI 预评估 evaluation.py:324/355；私有 scope 交付 delivery.py + scope-retry（68a20d5，2026-10-12）；工单编排/推送回流 orchestration.py:357/411 与 orchestration_sync.py。
② 测试：api/tests/test_demands_statemachine.py（10-11）、test_demands_pipeline_delivery.py（2026-11-05，最新鲜）、test_demand_workorder_sync.py（10-11）、test_workorder_status_push.py（10-12）、test_admin_demand_transition.py（10-12）、test_demand_auto_export.py（10-12）、test_demands_evaluation/compliance/notifications/blocklist（10-11/10-12）。
③ 部署：等效 HEAD；生产 env：WORKORDER_SYNC_ENABLED=false（yaml:80-81，轮询兜底关）、DEMAND_AUTO_EXPORT_ENABLED=true（yaml:86-87）。
④ 痛感（近 30 天 ~18 提交，两次生产实弹校正）：b26de15「状态回流改推送式 + slug 探测三态（fd-prod raw 出站被挡的生产实测校正）」——生产出站被墙逼出架构改版；a5aca4b「生成工单补舰队 schema 必填字段——萬星实弹红环根因」；68a20d5 scope-retry（交付失败重试按钮）；dff833b 禁爬源双闸。
⑤ 陈旧：spec mtime 2026-10-06 vs 废除动作 d6b2bfc 2026-10-10 与后续 10-12 大改——spec 落后 ≥29 天且三条 Requirement 已失真，判 stale（实质失真比天数更严重）。

---

## 停机窗口丢 cron 不补跑类问题（wire-demand-pipeline 专项核查）

结论：**无此类风险敞口**，证据链：
- 状态回流生产不走 wire 侧定时任务：b26de15 明言「fd-prod raw 出站被挡」，生产清单 WORKORDER_SYNC_ENABLED=false（deploy/k8s/fd-wire-api.yaml:80-81），拉取式循环 orchestration_sync.py:417-427 在生产关闭，仅作出站可达环境的兜底。
- 生产取推式：舰队拉取器读本地工单文件回推 `GET /internal/demands/workorders/tracked` + `POST .../status`（routes.py:344-403），幂等（orchestration.py `_acked_after`/ack 幂等）；事实源是工单 YAML 自身 append-only lifecycle——停机窗口错过的事件在下一轮推送按全量 lifecycle 幂等补齐，不丢事实。
- 出单侧：auto_export sweeper（auto_export.py:124 sweep_missing_exports）按「in_progress 且无出单留档」补扫，天然覆盖停机窗口；单点失败留痕下轮兜底（auto_export.py:104-119）。
- 残余观察（非缺陷，如实记）：推送链依赖外部拉取器存活，拉取器停摆时客户时间线会静默滞留（无「回流滞后」告警面），`at` 时间戳按 wire 收到时点盖章（orchestration_sync.py:276-291）而非真实事件时点——补跑不丢事实但时间线时序有偏，未证实是否需要收口。

## 簇摘要：三件最严重的事

1. **R wire-demand-pipeline 与代码/W spec 三条 Requirement 正面相悖（D 级）**：八态状态机（statemachine.py:31-46 已压三态）、gate 必过才交付（pipeline.py:10-13 已改观测留档）、人工报价（routes.py:245-257 已一律 409）。R 根 spec（mtime 2026-10-06）落在 wire-ux-consolidation（d6b2bfc 2026-10-10）废除动作之前未更新——「能力规格两本账」在这一个模块上同时失真三条，是全簇最重的账实分裂。
2. **R wire-analysis-console 两条客户承诺无实现**：按客户时区调度（schedules/ 无时区概念，models.py:28 仅 UTC）与告警邮件通知（alerts/ 零 email/smtp，仅 webhook evaluator.py:73）。R 根 spec 是对外承诺口径时，这是可直接被客户抓到的缺口；实现或改 spec 需二选一。
3. **refresh-scheduler 第四 Requirement（舰队产物周期刷新归调度，2026-10-26 并入）在本仓无实现痕迹**：spec 比代码新 15 天，api 内无舰队登记路径、无岗位节奏概念（唯一 cadence 命中在 quality/service.py:429 且无关）——要么实现面在仓外需指认，要么该 Requirement 是归档时「只并 spec 不落码」的挂账。

（次级：alert-evaluation spec Purpose 仍 TBD 占位；wire-analysis-presets 本仓零实现入口属账本归属错位，应登记实现仓。）

## O8 重叠裁决：wire-demand-pipeline(R) vs demand-intake(W)+demand-orchestration(W)

R 侧证据链：
- R wire-demand-pipeline（/Users/chengsishi/finddata/openspec/specs/wire-demand-pipeline/spec.md，mtime 2026-10-06）规定：八态状态机、AI 预评估+人工报价、conformance gate 必过、私有 scope 交付、验收后计量。
- W demand-intake（openspec/specs/demand-intake/spec.md:9-19）Purpose 明言「废除非现场实际的八态人肉报价模型」，Requirement 规定三态+五旧态废除；W demand-orchestration（openspec/specs/demand-orchestration/spec.md，10 条 Requirement）覆盖工单映射/投递/推送回流/安全子集/scope 交付/禁爬闸。
- 代码站在 W 侧：statemachine.py:31-46、pipeline.py:10-13、routes.py:245-257 均按三态/观测化 gate/报价废除实现；R spec 仅「私有 scope 交付」「验收后计量」「AI 预评估」三条仍与代码对齐（delivery.py、metering、evaluation.py:324）。
- 初步建议（拍板留用户）：以 W 两本为权威账本，R wire-demand-pipeline 收缩为供给闭环域级规格（保留 scope 交付/计量/AI 预评估三条仍真命题）或整本标记 superseded-by W demand-intake+demand-orchestration；无论哪种都应先在 R 根把三条失真 Requirement 修正或注明废除，避免对外口径继续引用八态/gate 门禁。
- **待与簇 F 证据合并**：demand-intake/demand-orchestration 两 W spec 的 W 侧体检证据（测试覆盖、部署 env、痛感代理）在簇 F 同事手里，本卡仅提供 R 侧与代码侧证据，最终裁决以两簇合并为准。
