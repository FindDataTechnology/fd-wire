# 设计：柏讯实现缺口收口

## 决策 1：邮件通道走「仓内 SMTP 直发模式复用」，不引入邮件服务依赖

- 依据：`api/fd_wire_api/demands/notifications.py:1-141` 已有全链验证的 smtplib 直发（`_smtp_config` env 驱动 SMTP_HOST/PORT/FROM/USER/PASSWORD/STARTTLS、`_smtp_send` EmailMessage+10s 超时、后台线程解耦失败不阻塞）+ 全 mock 测试（`api/tests/test_demands_notifications.py`）。
- 做法：把 `_smtp_config`/`_smtp_send` 提为共享小模块（如 `api/fd_wire_api/common/mail.py`），demands 与 alerts 同源调用；**不改 demands 行为**（导出后原处改为薄委托，现有测试保持绿）。
- 不引入 sendgrid/HTTP 邮件 API：无现成账号与预算线，SMTP 已有生产域名。

## 决策 2：生产凭据复用 CRM DirectMail，密钥链走既有 secretKeyRef 模式

- 依据：`fd-infra-deploy/all-services/chatwoot/01-chatwoot-web.yaml:71-91`（smtpdm.aliyun.com:465 SSL、support@finddatatech.cloud、secretKeyRef chatwoot-secrets）；本地密钥源 `secrets/crm-mail.env`（SMTP_PASSWORD/IMAP_PASSWORD 键）。
- 做法：`deploy/k8s/fd-wire-api.yaml` 加 SMTP_* env + secretKeyRef（新 secret `wire-mail-secrets`，值来自 crm-mail.env 的 SMTP_PASSWORD；不与 chatwoot 共用 secret 对象，避免 CRM 侧轮换波及 wire）。发件域同 `finddatatech.cloud`。
- 注意：`secrets/` 内容不进任何仓；fd-infra-deploy 改动属部署侧提交（GitOps 通道），任务里单列。

## 决策 3：notifyEmails 形态=客户自配收件列表字符串数组

- 不做「企业成员目录映射」：成员目录依赖（owner/member 关系）会引入邀请态/角色态联动，而客户最真实的诉求是「发到我指定邮箱」；spec_validate 沿 `webhookUrl` 同款模式（alerts/spec_validate.py:116-122）加可选 `notifyEmails`（http 无关，校验邮箱形态+条数上限，与 PACK_LIMITS 无关，上限 10）。
- cooldown 与 webhook 共用同一 `cooldownMinutes`（不拆双值，先保简单）。

## 决策 4：cell-manager 提交收口不混入本 change 代码提交流

- 工作区现有两股 WIP（cell-manager OpenBAO 退役 / api 电子签）。cell-manager 属 finddata 根 change `remove-cell-openbao-dependency`（11/11），其提交只含 cell-manager/* 文件（git add 显式路径，教训：不得 `git add openspec`/`-A`）；电子签 WIP 是并发会话的，不碰。
- 快照出片红线：出快照必须 git 干净树（git archive 或提交后导出），严禁 rsync 工作区（496 行 WIP 会被卷进镜像）。

## 方法学实测偏差（与体检同款纪律）

- 实现完成判据=任务勾选与测试对账（juchuang 教训）；本 change 测试面：alerts 邮件（mock SMTP 沿/cold-start/notify_failed 渠道标注）、admin 提醒（无映射客户返回体字段断言）、ops-mcp 九工具（URL+语义钉）、web 登录钮（已登录态断言——App.test.tsx 现仅断言 admin 页无登录链接，补 console/门户已登录态）。
- metering 教训复用：邮件渠道未配置的「显式告警一次」沿 b381fe8 的 channel-status 模式（启动/轮询时探 env，缺则告警一次）。
