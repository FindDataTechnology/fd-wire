# 任务：商留通道表单化

## 1. API 面

- [x] 1.1 模型+迁移 0051：contact_messages 表（id/name/email/company/message/ip_hash/status/created_at；ip_hash 建索引）；Alembic revision 链在 0050 之后
- [x] 1.2 `POST /api/v1/contact`：字段校验（name≤80/email 形态≤120/company≤120 可选/message≤2000）+ honeypot website 空闸（非空 400 不落库）+ 防灌水（ip_hash 24h≤5 / email 24h≤3，超限 429，被拒不计配额）+ ip SHA-256 截断哈希（不存原 IP）+ 202 {received: true}
- [x] 1.3 运营通知：common/mail.py 复用（fire-and-forget 后台线程，收件=运营邮箱；SMTP 未配置显式告警一次；失败仅日志不影响 202）
- [x] 1.4 admin 面：GET /api/v1/admin/contact-messages（FD_WIRE_ADMIN_TOKEN，倒序分页 50）+ PATCH {id} 标已读；AdminView 加 contacts 分区（未读数入口可见）
- [x] 1.5 测试：合法提交/honeypot 拒/IP 超限 429/email 超限/字段 400 定位/通知 mock（成功信+SMTP 缺失告警一次+失败不影响 202）/admin 列表鉴权与标记已读

## 2. 前端

- [x] 2.1 HomeView 联系开通 CTA 改站内表单卡（name/email/company/message，成功态如实反馈；CONTACT_MAILTO 常量退役，全仓引用核验）
- [x] 2.2 测试：表单提交成功态/honeypot 字段带上无痕/422-400 回显/成功后清表单

## 3. 校验收口

- [x] 3.1 `openspec validate add-contact-intake --strict` 过
- [x] 3.2 api+web 全量测试绿 + tsc 0
- [x] 3.3 归档合入 contact-intake 主 spec
- [x] 3.4 api+web 出片滚动（池 001；api 有迁移 0051 一次性 Pod 应用）+ 冒烟（公开提交落库+运营通知在产/后台 contacts 分区）
