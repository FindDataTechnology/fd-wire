# contact-intake Specification

## Purpose
定义柏讯公开商留通道的 intake 契约：访客在官网提交联系意向的公开端点行为、防灌水边界、运营通知与管理面。目标是把「联系开通」从跳出式 mailto 变成站内可审计的转化入口。

## ADDED Requirements

### Requirement: 公开提交端点与字段契约

`POST /api/v1/contact` SHALL 为无认证公开端点（同源调用），接受 name（必填 ≤80）、email（必填，邮箱形态 ≤120）、company（可选 ≤120）、message（必填 ≤2000）与 honeypot 字段 `website`（MUST 为空）。字段超界或形态非法 SHALL 400 如实定位；`website` 非空 SHALL 按 400 拒绝且不落库（机器人闸，不提示是 honeypot）。提交成功 SHALL 返回 `{received: true}`，MUST NOT 回显内部标识。

#### Scenario: 合法提交
- **WHEN** 访客提交完整合法字段且 honeypot 为空
- **THEN** 202/200 返回 {received: true}，一条记录落库（status=new）

#### Scenario: honeypot 命中不落库
- **WHEN** 提交携带非空 website 字段
- **THEN** 400 拒绝，无任何记录落库

### Requirement: 防灌水闸

同一 ip_hash 24 小时窗口内 SHALL 限 5 条、同一 email 24 小时窗口内 SHALL 限 3 条；ip SHALL 以 SHA-256 截断哈希落库，MUST NOT 存原始 IP。超限 SHALL 429 如实返回（不限流文案误导），被拒请求 MUST NOT 计入配额。

#### Scenario: 同 IP 超限
- **WHEN** 同一来源 24h 内第 6 次提交
- **THEN** 429，无新记录落库

#### Scenario: 不存原始 IP
- **WHEN** 任意记录落库
- **THEN** ip_hash 为十六进制截断哈希，库内无原始 IP 字符串

### Requirement: 运营邮件通知

提交成功后 SHALL 经平台 SMTP 直发设施通知运营邮箱（fire-and-forget 后台线程），通知含 name/email/company/message 摘要；SMTP 未配置时 SHALL 显式跳过并记结构化告警一次（沿 metering 渠道告警口径），投递失败 MUST 记日志且 MUST NOT 影响 202 返回。

#### Scenario: 提交触发运营通知
- **WHEN** 合法提交落库且 SMTP 已配置
- **THEN** 运营邮箱收到含四字段摘要的通知信；SMTP 失败时提交仍 202

### Requirement: 运营管理面

admin 面 SHALL 提供 `GET /internal/admin/contact-messages`（FD_WIRE_ADMIN_TOKEN 门——admin 面现役前缀 /internal/*，nginx 仅对该前缀注入管理令牌；时间倒序分页默认 50）与标记已读 `PATCH /internal/admin/contact-messages/{id}`（status→read）；控制台后台新增 contacts 分区承载列表与已读操作，未读数 SHALL 在分区入口可见。

#### Scenario: 运营查单
- **WHEN** 运营在后台 contacts 分区打开列表
- **THEN** 时间倒序分页呈现全部提交，可标记已读，未读数准确
