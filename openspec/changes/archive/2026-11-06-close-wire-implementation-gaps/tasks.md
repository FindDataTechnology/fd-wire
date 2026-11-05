# 任务：柏讯实现缺口收口

## 1. 告警邮件通道（P1-8 邮件半边）

- [ ] 1.1 SMTP 共享模块：`_smtp_config`/`_smtp_send` 提为 `common/mail.py`，demands 薄委托改造，现有 test_demands_notifications 全绿
- [ ] 1.2 契约与校验：`alerts/spec_validate.py` 加可选 `notifyEmails`（邮箱形态+上限 10）；`alerts/models.py` 通知载荷带渠道维度
- [ ] 1.3 投递分支：`evaluator._notify` 加邮件路径（同 cooldown；失败 notify_failed 注明渠道；SMTP env 缺失跳过+结构化告警一次）
- [ ] 1.4 测试：mock SMTP——沿触发发信/冷却再发/失败不阻塞 webhook/env 缺失告警一次/双渠道并存
- [ ] 1.5 部署：`deploy/k8s/fd-wire-api.yaml` 加 SMTP_* env + secretKeyRef `wire-mail-secrets`（fd-infra-deploy 侧同步提交，值来自 secrets/crm-mail.env，不进仓）

## 2. 开户 cell 映射提醒（bcf57e3 同型痛事前卡点）

- [ ] 2.1 `admin/routes.py` create_customer：无 AI_CELL_ENDPOINT_MAP 条目时返回体带显式提醒字段+日志（不改 map 解析语义）
- [ ] 2.2 测试：无映射客户创建返回提醒；有映射不提醒；map 未配（约定派生口径）不提醒

## 3. ops-mcp 九工具单测（跨仓：wire-ops-mcp）

- [ ] 3.1 objects 三（wire_object_search/dataset_aggregate 系）+ actions 三 + content 三：bearer fixture 复用，各工具钉 URL、谓词、错误透传三断言
- [ ] 3.2 wire-ops-mcp 仓全量测试绿 + 提交推 gitee（镜像出片随下次统一滚动）

## 4. 门户登录钮 + 死代码

- [ ] 4.1 `App.tsx:345-350` 会话条件：已登录「登录」→「进入控制台」；测试补已登录态断言（门户页+console 页）
- [ ] 4.2 清死代码：ConsolePlaceholder 组件（ConsoleLayout.tsx:127-149）与 `placeholder?` 字段，全仓零引用核验后删

## 5. cell-manager OpenBAO 退役提交收口（对应 finddata 根 change 11/11）

- [ ] 5.1 工作区 cell-manager/* 10 文件跑全量 cell-manager 测试（含 test_secrets_store 10 用例）
- [ ] 5.2 显式路径提交（git add 仅 cell-manager/*），遗留 CELL_OPENBAO_* 环境变量告警语义核验

## 6. 簿记（spec Purpose 直改 + backlog 注记）

- [ ] 6.1 W 侧交叉引用直改 Purpose：metering-poll-channel、usage-transparency 加 O1 句（权威对账见 finddata 根 wire-facade-metering）；console-auth、customer-key-minting 加 O3 句（身份模型与归属见 wire-customer-identity）；cell-grant、cell-postgres-storage 加 O4 句（租户模型与生命周期见 wire-cell-tenancy）
- [ ] 6.2 backlog P1-11 三处改判结案注记（证据门/信息流=R 根 wire-analysis-console:79-113 已覆盖；舰队归调度=annotate change 已裁决不属悬空）
- [ ] 6.3 backlog P1-12 判据更新（OpenBAO 退役提交+归档、修后出片、下次真实退租零手工补完，三件齐备摘牌）
- [ ] 6.4 backlog 收尾注记更正：现网已滚 sha-b750016（1fa3959，11-05 22:30），landing-tab/metering 探针已在产（channel-status 401、bundle 含 market 实证）

## 7. 校验与收口

- [ ] 7.1 `openspec validate close-wire-implementation-gaps --strict` 过（fd-wire 根）
- [ ] 7.2 fd-wire 全量测试绿（api+web+cell-manager）
- [ ] 7.3 干净树出片一次滚齐（api/web；ops-mcp 随行核销 d5ca1dd 滞后确认），冒烟：alert 邮件 env 缺失告警日志、登录钮已登录态、create_customer 提醒字段
