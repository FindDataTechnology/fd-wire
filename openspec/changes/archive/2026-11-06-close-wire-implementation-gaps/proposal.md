# 柏讯实现缺口收口（close-wire-implementation-gaps）

## Why

「这一版做到最好」收尾（姊妹 change `close-wire-spec-residue` 在 finddata 根收口径，本 change 在 fd-wire 根补实现与簿记）。11-05 七路实查确认四类缺口：①告警邮件是 R 根 spec 白纸黑字的客户承诺（「含电子邮件」）但全仓零邮件通道，且仓内 SMTP 模式现成（demands/notifications.py）、生产 DirectMail 账号现成（CRM chatwoot 在用）——成本一天内；②AI cell 端点映射（AI_CELL_ENDPOINT_MAP）防漂移只有事后可见性（stats.errors），开户时点无提醒，bcf57e3 同型痛咬过生产；③ops-mcp 扩展组 9 工具零单测（v1 十工具+packs 三有测试，objects/actions/content 九工具无）；④门户「登录」钮无会话条件恒渲染（App.tsx:345-350），登录用户全站看到「登录」。另有簿记：体检 backlog 三条改判注记、W 侧 O1/O3/O4 交叉引用、cell-manager OpenBAO 退役代码提交收口（finddata 根 change 已 11/11，代码在工作区未提交）。

## What Changes

- **告警邮件通道**：`alerts/` 接入邮件投递——demands 的 SMTP 直发模式（`_smtp_config`/`_smtp_send`，env 驱动+后台线程+失败不阻塞）提为共享小模块复用；告警 spec 校验新增可选 `notifyEmails`（客户自配收件列表）；`evaluator._notify` 加邮件分支（失败沿 `notify_failed` 语义）；deploy yaml 加 SMTP env + secretKeyRef（生产复用 CRM DirectMail 账号与发件域 `finddatatech.cloud`，本地密钥源 `secrets/crm-mail.env`）。**部署配置与代码同一 change 出，否则纸面承诺**（demands 的 SMTP 现在生产就没配 env）。
- **开户 cell 映射提醒**：`admin/routes.py` create_customer 返回体/日志在客户无 AI_CELL_ENDPOINT_MAP 条目时显式提示「该客户无 cell 映射，AI 构建将不可用（配方 HANDOFF §5）」——事前卡点，不改显式口径语义（测试钉住）。
- **ops-mcp 9 工具薄转发单测**：wire-ops-mcp 仓补 objects/actions/content 九工具测试（复用现有 bearer fixture，钉 URL 与语义）——跨仓任务。
- **门户登录钮会话条件**：已登录时门户头部「登录」换「进入控制台」；顺手清死代码 `ConsolePlaceholder`（ConsoleLayout.tsx:127-149）与 `placeholder?` 字段。双横栏摘壳**不做**（需语言切换/返回门户 parity，另立 change）。
- **cell-manager OpenBAO 退役提交收口**：工作区 10 文件（FileSecretStore 替换 openbao.py，含 test_secrets_store 10 用例）跑全量测试后提交——对应 finddata 根 change `remove-cell-openbao-dependency`（已 11/11）。
- **簿记**：体检 backlog P1-11 三处改判结案（证据门/信息流契约 R 根已覆盖、舰队归调度 annotate 已裁决）、P1-12 判据更新（OpenBAO 退役提交+出片+实弹退租三件齐备才摘牌）、收尾注记更正（现网已滚 sha-b750016，landing-tab/metering 已在产）；W 侧 O1/O3/O4 交叉引用句直改三本 spec Purpose（metering-poll-channel、usage-transparency、console-auth、customer-key-minting、cell-grant、cell-postgres-storage）。
- 非目标：时区/时刻调度实现（无客户诉求，spec 已降级）；双横栏摘壳；endpoint map 启动强门（刻意口径，会误报无 cell 客户）；HomeView mailto 表单化（可选后续，不属本版承诺）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `alert-evaluation`: 通知面从「仅 webhook」扩为「webhook + 电子邮件」，新增 `notifyEmails` 可选契约与投递语义。

## Impact

- **代码**：fd-wire（alerts + admin + web App/ConsoleLayout + cell-manager 提交）；wire-ops-mcp（测试）；deploy yaml（SMTP env/secret）。
- **外部接口**：alert_rule spec 新增可选字段 `notifyEmails`（向后兼容，未配置行为不变）；邮件走 SMTP 出站（生产 DirectMail）。
- **下游**：R 根 wire-analysis-console「含电子邮件」承诺落地；P1-8 邮件半边销账；P1-12 摘牌判据明确；ops-mcp 9 工具回归钉住；下次出片须干净树（cell-manager 提交后工作区仅剩并发会话的电子签 WIP）。
