# Design: wire-demand-generation-orchestration

## D1 投递通道为什么是「推工单文件」而不是直连 A2A

萬星生成 agent（spider-heal v6+，kind=generate 分诊）是**私有部署**：
调用需 sub2api sk- 键 + 私有 agent 白名单——两件都要一次性的面板操作
（sub2api 无 admin 造键，键只能用户面板会话自铸）。而 fd-industry-data
的 health-inspect 工作流**已经持有在役凭据并每周消化工单**（每日 03:17
跑 + workflow_dispatch；「工具出单」是生成流的正规入口——巡检器只产修复
单，生成单本来就期望外部工具投递）。因此 v1 投递=复刻 fd-health-bot 模式
推 YAML 工单进 `reports/health-tickets/`，SUBMIT 由在役工作流代劳：**零
新凭据进 A2A 层、复用已验证链路**。直连 A2A 留 v2：投递层抽象成
`WorkorderSink` 接口（git / a2a 两实现），切换不改编排语义。

时延口径：每日一轮 SUBMIT → 需求→提交生成最坏 ~24h。对 B2B 需求单
（既有承诺「1 个工作日内响应」）可接受；赶急单由操作员手动
workflow_dispatch（gh CLI，运营手册条目）。

## D2 合规门的「硬」与「软」

用户规则=「只要公开数据都可以代爬」。可机器硬判的：URL 形态（http/https、
无内嵌账密）+ 客户声明（公开数据必勾，表单显式声明不勾即无法提交）。
不可机器判的（登录墙后数据、反爬条款灰色地带）→ 既有评估流人工兜底：
evaluation 的 compliance_flags 已有本地初筛种子（legal-domain-review），
编排侧不重复造。**硬拒路径**只有两条：URL 形态非法、声明缺失——其余
一律进人工评估，不搞自动放行。

## D3 工单映射（需求单字段 → health-loop YAML）

| 需求单 | 工单 | 说明 |
|---|---|---|
| code | 文件名 `<YYYYMMDD>-wire-<code>.yaml` | 目录内可追溯 |
| 源域名 | `unit: spiders/<slug>/` | slug=域名净化 `^[a-z0-9][a-z0-9-]*$`，冲突即拒（仓内已存在=转人工，对齐生成流硬边界） |
| intent + entities_hint | `brief.expectations` | 意图原文+实体提示拼接 |
| source_urls（新增字段） | `brief.source_urls` | 原样（已过合规门） |
| frequency_expect | `brief.cadence` | 映射 daily/hourly/weekly，非法值落 notes |
| company/contact | `brief.notes` 前缀注明来源需求单 | 审计线索 |
| — | `golden: ["spiders/<slug>/golden/"]` | 声明即强制（样本缺失=验证红） |
| — | `verify.commands` | health_verify 标准命令 |
| — | `kind: generate`、`category: null` | 契约要求 |

## D4 状态回流与客户可见性

fd-industry-data 是公开镜像仓 → 工单状态文件可直接 raw.githubusercontent
拉取（免凭据、免 API 限额敏感度）。同步循环（lifespan task，tick 缺省
600s，未启用编排即静默不跑）拉工单 YAML 的 `status` 字段与
last-run.json；状态→事件映射：

| 工单 status | pipeline_event | 客户时间线 |
|---|---|---|
| 新投 | workorder_submitted | 已进入生成流水线 |
| pr_open（agent 汇报） | pipeline_run{branch,pr_url} | 爬虫已生成，待人工审核 |
| closed（人审 merge） | gate_result{passed:true} | 审核通过，点亮部署中 |
| failed/rejected | gate_result{passed:false,note} | 生成受阻，运营跟进 |

内部字段（agent 回执全文/重试细节）只进 pipeline_events 原文留档，客户面
（`Demand.delivery` 同款纪律）只出安全子集。终态后操作员用既有 deliver
端点交付——编排绝不自动置 delivered。

## D5 失败与降级语义

- 推送失败（网络/权限/分支保护）：工单不丢——pipeline_events 留
  workorder_exported 全文，控制台可重试推送；连续失败不阻塞需求单其他
  操作。
- 同步循环失败：静默重试下轮（metering driver 同款），绝不写「未知的
  进度」。
- fd-industry-data 重命名 tickets 目录/改契约：拉取 404 → 事件
  workorder_lost 留痕转人工——外部仓不是我们的变更域，宁可停也不猜。

## D6 安全

- INDUSTRY_GIT_SSH_KEY 只授 fd-industry-data 单仓 deploy key（write），
  不用宽权限 PAT；推送内容仅 `reports/health-tickets/` 下单文件（路径
  白名单在代码里硬编码）。
- 工单内容=客户源地址+意向文本：不含任何凭据（合规门已拒内嵌账密）；
  公司名/邮箱进 notes 需注意——**只进 brief.notes 供内部追溯，PR 是公开
  仓**：v0 决定 contact_email 不进工单，company 以「客户已脱敏代号」
  （customer_id 前 8 位）形式留档。
