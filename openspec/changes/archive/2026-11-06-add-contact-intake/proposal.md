# 商留通道表单化（add-contact-intake）

## Why

官网首页「联系开通」CTA 至今是 mailto 占位（HomeView.tsx:9 `CONTACT_MAILTO`，注释自证「正式商留通道后续接入」）——商留是转化路径，访客必须跳出页面开邮件客户端。11-06 O3 裁决已登记「充值走人工通道属有意设计，产品触点为商留通道」——把触点做实是收口动作。且今日上产的 SMTP 共享设施（`common/mail.py`，close-wire-implementation-gaps 1.1）正好复用做运营通知：表单落库+邮件提醒运营，无需新邮件设施。

## What Changes

- **公开联系表单端点**：`POST /api/v1/contact`（无认证公开面）——字段 name（≤80）/email（形态校验 ≤120）/company（可选 ≤120）/message（≤2000）；honeypot 字段 `website` 必须为空（机器人闸）；无 CORS 放开（同源）。
- **防灌水闸**：按 ip_hash（SHA-256 截断，不存原 IP）24h ≤5 条 + 按 email 24h ≤3 条，DB 计数检查，超出 429 如实；表单提交后返回 `{received: true}`，不回显敏感信息。
- **落库**：新表 `contact_messages`（id/name/email/company/message/ip_hash/status new|read/created_at），Alembic 迁移 0051。
- **运营通知**：提交成功后经 `common/mail.py` 发信到 SMTP_FROM 同址运营邮箱（fire-and-forget 后台线程、失败仅日志不影响 202 返回——沿 demands/notifications 模式）。
- **运营可见面**：admin 新增 contacts 分区（`GET /api/v1/admin/contact-messages`，FD_WIRE_ADMIN_TOKEN 门，分页倒序+标记已读 PATCH）——沿现有 admin 六分区模式。
- **前端**：HomeView「联系开通」CTA 改开表单卡（内嵌在首页的卡片式表单，非跳页）；提交成功态如实反馈；mailto 常量退役（CONTACT_MAILTO 删除，测试同步）。
- **spec**：新能力 `contact-intake`（公开提交契约/防灌水闸/运营通知/管理面四条 Requirement）。
- 非目标：不做反垃圾第三方案（无 redis/waf 规则）；不做多语言表单外的一码多站；不接 CRM（chatwoot）自动化工单。

## Capabilities

### New Capabilities

- `contact-intake`: 公开商留表单 intake 契约——字段与校验、防灌水闸、运营邮件通知、admin 管理面。

### Modified Capabilities

（无）

## Impact

- **代码**：api（contact 路由+模型+迁移 0051+admin 分区+测试）、web（HomeView 表单卡+测试）。
- **外部接口**：新增公开 POST /api/v1/contact 与 admin GET/PATCH 两个内部端点；生产无需新 env（复用 SMTP_* 与 FD_WIRE_ADMIN_TOKEN）。
- **下游**：HomeView mailto 占位退役（DocsView 无引用核验后同步）；O3 商留触点闭环；admin 第七分区。
