# 簇 D 体检报告 — 控制台/门户前端面（10 模块，全部 W 根）

检查基线：fd-wire 实际 HEAD=5b782f2（2026-11-05 20:45，背景给的 b3798ad 为其祖先，git log -1 证实）；镜像 sha-1c5dfc5（=1c5dfc5，2026-11-05 11:02 entities 修复）经 `git merge-base --is-ancestor 1c5dfc5 HEAD` → IS ancestor，部署提交 b3798ad（12:08 roll）亦为祖先，镜像仅落后 HEAD 数小时、内容新鲜。
测试总盘：web vitest 在场（web/vitest.config.ts，happy-dom，include src/**/*.test.{ts,tsx}），实际 68 个测试文件（find web/src -name '*.test.ts*' | wc -l = 68）；api/tests/ 115 个 py。pain 代理窗口 2026-09-05 起。

## 1. console-shell — A
理由：四组/aria-current/宽度基线/窄屏四条 Requirement 全部有实现与测试，spec 与代码同一 commit 更新，零剪刀差。
① 对齐：四组导航 CONSOLE_NAV_GROUPS web/src/console/ConsoleLayout.tsx:39-60（概览=workbench；数据=datasets,entities,packs,market；构建=chat,artifacts；运营=demands,usage,keys,team，与 spec 归组逐项一致）；aria-current ConsoleLayout.tsx:224；统一宽度 App.tsx:361（wideMain max-w-7xl）+ConsoleLayout.tsx:304（页内无整页 max-w 违例，grep 无命中）；窄屏横向分组条 ConsoleLayout.tsx:196-201。
② 测试：ConsoleLayout.test.tsx（分组/aria-current/语言切换，:41-68）、ConsoleView.test.tsx、App.test.tsx；后端 test_console_api.py(18)。
③ 部署态：fd-wire-web.yaml image sha-1c5dfc5=HEAD 祖先（见基线），deploy/k8s/fd-wire-web.yaml:27。
④ 痛感：`git log --oneline --since=2026-09-05 -- ConsoleView/ConsoleLayout/App` 24 commits，含修复浪潮 757db0f（白屏根治+错误边界+去页脚+后台修复+分流摘壳 17 任务）与生产实弹修 598a5e5——shell 是全簇最高修复密度面。
⑤ 陈旧：spec 2026-10-20 03:08 与 ConsoleLayout/ConsoleView 同 commit（9e85cc4）——剪刀差 0 天。

## 2. console-ai-entry — A
理由：默认落地/页内对话/壹座深链/能力分轨四条全落码，后端工具面结构性只读+propose_action 与 spec 逐字对齐。
① 对齐：默认 datasets App.tsx:70 + ConsoleView.tsx:105；整页对话 ChatPage.tsx:27-31（复用 AssistantConversation）；壹座深链新标签 ChatPage.tsx:34-43（target=_blank rel=noopener）；后端 /api/v1/ai/* web/src/console/api.ts:235-345；工具面=读工具+propose_action+（有引擎才加 cell 工具）api/fd_wire_api/ai/loop.py:276-282、构建类 _require_engine api/fd_wire_api/ai/actions.py:213；增量取消息 ?after_id= api.ts:260-265。
② 测试：ChatPage.test.tsx；api test_ai_api.py(13)/test_ai_loop.py(12)/test_ai_assistant_panel.py(14)。
③ 部署态：同上，镜像为祖先。
④ 痛感：ChatPage 6 commits，1 fix（e1f7288 壹座 CTA 直落 platform 免官网中转）。
⑤ 陈旧：spec 10-21 vs ChatPage 10-20 → ~1 天。
备注：「网关可达」场景需真打 token.finddatatech.cloud，本轮只读未打——未证实。

## 3. assistant-panel — A
理由：浮层/Esc 保稿/分轨/两面动作卡/内联看板预览/草稿转正/动作后页面自动刷新九条 Requirement 全部可指到实现。
① 对齐：常驻入口 AssistantPanel.tsx:38-50（fixed 右下）；Esc 收起保稿 :27-34+外壳常驻挂载 :52-77；公开面不渲染——浮层只在 ConsoleView ready 态挂载 ConsoleView.tsx:506-508，share/showcase 走独立壳 App.tsx:310-317；分轨闸 loop.py:276-282；壹座深链 AssistantConversation.tsx:586-591；上下文注入 answer.py:117-119+api.ts:304 白名单；动作卡两面 ActionCard.tsx:110-113（pending）/:9-11（resolved 含 result_summary、历史回放）；内联预览 ActionCard.tsx:375-400（DashboardRenderer :31，:16 明示不渲染占位）；草稿可见+转正 AssistantConversation.tsx:448-474；动作成功刷新受影响页：api.ts:447 广播 wire:action-executed，ArtifactsPage.tsx:248/DatasetsPage.tsx:191 监听重取。
② 测试：AssistantPanel.test.tsx、ActionCard.test.tsx；api test_ai_assistant_panel.py(14)/test_ai_actions.py(19)。
③ 部署态：镜像为祖先。
④ 痛感：assistant/ 仅 2 commits（皆 feat），0 fix——最安静模块之一。
⑤ 陈旧：spec 10-21 vs 代码 10-20 → ~1 天。

## 4. personal-workbench — A
理由：聚合端点六段+隔离+页签位+landing 候选全落码，且有一次按生产现实（form 产物已存在）的补强。
① 对齐：GET /api/v1/workbench api/fd_wire_api/workbench.py:42,424，六段（datasets/free_quota/packs/artifacts/alerts/demands :170-369）；隔离按 customer_id（各 section 函数签名）；工作台首位页签 ConsoleLayout.tsx:44,71-75；空态 CTA WorkbenchPage.tsx:77-103；免费配额内联条 :118-130（付费档 null 不渲染）；壹座入口卡 :26；landing_tab=workbench 候选 api/fd_wire_api/console/preferences.py:48-60 + ConsoleView.tsx:207-220。
② 测试：WorkbenchPage.test.tsx；api test_workbench.py(6)。
③ 部署态：镜像为祖先。
④ 痛感：WorkbenchPage 5 commits，0 fix 前缀；2df5b52 为生产缺口补强（by_kind 漏 form）。
⑤ 陈旧：spec 10-12 vs 代码 10-15 → 代码更新，无剪刀差。

## 5. personal-preferences — B
理由：读写契约/自愈/同步语义在位且有生产实弹修，但 landing_tab 值域三层漂移：spec 九页签 vs api 十页签 vs web 十一页签，切「数据市场」页签的写回被 422 静默吞掉（正是 api 注释里写明踩过的同类坑）。
① 对齐：convergeLocale ConsoleView.tsx:90-103；裸入口落地序 pinned>landing_tab>datasets :207-220；切页签即写+suppress 不回写 :256-270；GET/PUT /api/console/me/preferences api.ts:3502,3511；pinned 自愈 api/fd_wire_api/console/preferences.py:170-176。
② 测试：ConsoleView.test.tsx（含 :539 market 页签用例——mock 层测不到服务端 422）；api test_preferences.py(13)。
③ 部署态：镜像为祖先。
④ 痛感：1 个生产实弹修 598a5e5（落地 suppress 帧序，首帧即目标时吞用户写回）。
⑤ 陈旧：spec 10-12 vs ConsoleView 10-20 → 代码更新；但内容漂移（见下）。
硬伤证据链：spec 九页签 openspec/specs/personal-preferences/spec.md:11,31；api LANDING_TABS 十值无 market（preferences.py:48-60，:45 注释自称「与 web 页签面冻结对表」）；web 十一页签含 market（ConsoleLayout.tsx:110）；切 market 即写 ConsoleView.tsx:267 → 422（preferences.py:166-172）→ catch 静默（ConsoleView.tsx:267-269）；workbench 同型缺陷曾在生产被抓（preferences.py:45-49 注释自证），market 属复发。

## 6. portal-shell — A
理由：三形态页脚/备案口径/后台独立壳/状态卡居中/错误边界双层兜底全部落码，常量与 spec 数字逐字一致。
① 对齐：门户全量页脚 SiteFooter.tsx:51-70；ICP「粤ICP备2026118740号-1」+公安「粤公网安备44030002016558号」footerConstants.ts:6-9（与 spec 数字一致）；跨服务入口仅官网/壹座/识律+「更多产品线」兜底 footerConstants.ts:17-25；console/admin/demandNew 无页脚 App.tsx:247-252；admin 不被门户顶栏包裹 App.tsx:321-324+AdminLayout.tsx:57-69（品牌条+返回门户+登出）；阻塞/引导/错误卡居中 ConsoleView.tsx:323-428（mx-auto max-w-xl）；页签级 ErrorBoundary ConsoleView.tsx:489-500+全局 App.tsx:364。
② 测试：SiteFooter.test.tsx、App.test.tsx、ErrorBoundary.test.tsx。
③ 部署态：镜像为祖先。
④ 痛感：SiteFooter/footerConstants 2 commits，1 fix（e1f7288）。
⑤ 陈旧：spec 10-13 vs footerConstants 10-13 → 0 天。

## 7. team-spaces — A
理由：成员/邀请/角色/切换/席位/数据集 ACL 六条 Requirement 双端齐备，测试数全簇最厚。
① 对齐：邀请 createTeamInvite TeamPage.tsx:130-139；作废 :141-150；角色变更 owner 就地 PATCH :170-183；切活跃队（成功整页 reload 重建身份）:188-199；席位条+超配 grandfather 警示 TeamPage.tsx:5-6,205-208；活跃队徽标（多队才渲染）ConsoleLayout.tsx:173-190,286-294；数据集访问授权 DatasetAccessSection.tsx+fetchDatasetAccess/updateDatasetAccess api.ts:808-818；端点面 api.ts:3369-3468。
② 测试：TeamPage.test.tsx、DatasetAcl.test.tsx；api test_team.py(30)、test_dataset_acl.py(22)——后端最重仓。
③ 部署态：镜像为祖先。
④ 痛感：TeamPage 3 commits 皆 feat（2e4425f→f4970ed→bd41366 本体版本区搭车），0 fix。
⑤ 陈旧：spec 10-31 vs 代码 11-01 → 代码更新 1 天。

## 8. self-serve-onboarding — A
理由：首登 ceremony/key_once 一次性/免费档边界全链在码，前端登录件自wire-self-serve-launch 后稳定。
① 对齐：POST /api/console/session 触发映射+开户 web/src/console/auth.ts:12-13,389-426（key_once 仅开户次非 null）；keyOnce 明文仅一次展示+复制 ConsoleView.tsx:449-476；后端 ceremony api/fd_wire_api/console/onboarding.py:1-115（mint/write_caller_map/grant_cell_face，registry token 鉴权）；免费档 api 层放行+行数闸 fetchDatasetQuota api.ts:1488 + DatasetsPage 配额内联（spec 边界 Requirement ②）。
② 测试：LoginView.test.tsx、CallbackView.test.tsx、ConsoleView.test.tsx（keyOnce）；api test_console_api.py(18，含 onboarding/key_once)。
③ 部署态：镜像为祖先。
④ 痛感：auth/Callback/Login 4 commits，0 fix 前缀；9aca957 boot-ux（静默续期挂起表现为整页空白→加 loading spinner，ConsoleView.tsx:304-318）属痛感驱动。
⑤ 陈旧：spec 10-11 vs auth.ts 10-20 → 代码更新 9 天。
备注：suspend/吊销治理路径在 admin 面，本轮未验——未证实。

## 9. form-apps — A
理由：全簇最厚 spec（371 行）九条 Requirement 双端全落码，含全部新键与文档红线，且 0 fix 记录。
① 对齐：formSpec.ts 信封与校验（visibleWhen :245、visibleWhenGroup :279、optionsFrom/optionsFromDataset/fillFrom/computed/constraints :74-186）；运行时 FormRuntime.tsx（optionsFromDataset 挂载即解析 :82-171、fillFrom 回填 :298-350、computed=add_days :369-373、提交带 artifact_id :5,60）；构建器 FormEditor.tsx(2349 行)；公开分享 App.tsx:115-124+ShareView mode=form+api.ts:2009-2046；文档红线 DocsView.tsx:643-697（动态选项/回填/计算/提交闸四小节+公开选项端点边界说明）。
② 测试：formSpec.test.ts、FormEditor.test.tsx、FormRuntime.test.tsx；api test_form_artifacts.py(15)/test_form_entry_advanced.py(16)/test_share_form.py(27)/test_share_form_options.py(8)。
③ 部署态：镜像为祖先。
④ 痛感：form/ 5 commits 皆 feat，0 fix。
⑤ 陈旧：spec 10-15 与代码 10-15 同窗口 → 0 天。

## 10. rich-text-docs — A
理由：契约 256KB/渲染安全结构性锁死/分栏四态/分享 noindex 全落码，安全底线以「文件全篇无 innerHTML」的实现方式兑现。
① 对齐：doc 契约 {format:"markdown",text}+256KB 422 api/fd_wire_api/artifacts/doc_spec.py:26,49-50；渲染安全 md.tsx:25-39（链接协议白名单 http/https/mailto、图片仅 http(s)、javascript:/data: 拒）、:3-8（结构性无 innerHTML）、noopener :94；分栏编辑器四态（未保存/保存中/已保存(时刻)/失败）DocEditor.tsx:40-45+debounce :37；归档只读 :19；分享 App.tsx:125-135+noindex ShareView.tsx:138-142。
② 测试：md.test.tsx、DocEditor.test.tsx、ShareViewDoc.test.tsx；api test_doc.py(12)/test_share_doc.py(9)。
③ 部署态：镜像为祖先。
④ 痛感：doc/ 仅 1 commit（759cf50 实施），0 fix——全簇最安静。
⑤ 陈旧：spec 10-26 vs 代码 10-17 → spec 新 9 天（archive 后触碰），无剪刀差。
备注：agent 经 MCP 写 doc 的来源指针（spec 最后一条 Requirement）属 api/MCP 面，本轮 web 侧未验——未证实。

## 簇摘要 — 三件最严重的事

1. **landing_tab 值域三层漂移，「数据市场」页签写回被静默 422（活缺陷）**：spec 九页签（openspec/specs/personal-preferences/spec.md:11,31）⊂ api 十页签无 market（api/fd_wire_api/console/preferences.py:48-60）⊂ web 十一页签含 market（web/src/console/ConsoleLayout.tsx:110）。用户切到数据市场即触发 putPreferences({landing_tab:"market"})（ConsoleView.tsx:267）→ 服务端 422（preferences.py:166-172）→ 前端 catch 静默（ConsoleView.tsx:267-269），market 永远无法成为落地页且用户无感。preferences.py:45-49 注释自证 workbench 曾因同型缺陷被生产冒烟实弹抓出——market 是该缺陷类的复发，建议把「新增页签必须同步 LANDING_TABS」写进 spec 或加对表测试。
2. **控制台壳是全簇修复密度最高、且两次靠生产实弹才暴露的面**：web/src 全量 74 commits（2026-09-05 起）中 shell 三件套占 24；两次专门修复浪潮（757db0f 白屏根治+错误边界+去页脚 17 任务、5074202 韧性三修）+两个生产实弹修（598a5e5 偏好落地 suppress 帧序、2cfd6fc fetchCorrections 信封解错致数据集详情白屏）。共性是「真实浏览器帧序/信封形状」类问题 vitest mock 层测不到——68 个前端测试挡不住这类回归，值得给 ConsoleView 落地序与 api 信封加契约级对拍。
3. **console 与 portal 壳边界基本清晰但有一处真实的重复面**：admin（App.tsx:321-324+AdminLayout 自有顶条）与 share（App.tsx:310-317 独立壳）彻底分壳、状态管理无重复（偏好单主 ConsoleView、语言单主 App.tsx:273-283）；但 console 路由仍被门户顶栏整体包裹（App.tsx:324 只排除了 admin），登录后的控制台同时呈现门户导航条（首页/定价/文档/…/控制台/登录）与 ConsoleLayout 顶栏（ConsoleLayout.tsx:252-303）两条横栏，且门户「登录」链接（App.tsx:345-350）在已登录的控制台页恒常渲染。两本 shell spec 均未对此窗口定义口径——不判违规，如实记录为待裁决的边界模糊点。
