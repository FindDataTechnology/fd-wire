# Spec Delta

## MODIFIED Requirements

### Requirement: 工作台聚合端点

平台 SHALL 提供工作台聚合端点 `GET /api/v1/workbench`（登录客户身份）：单次
往返返回本客户的数据集（总数、api/cell 分层计数、最近列表）、免费档真实配额
（付费档为 null）、源包订阅（计数与最近订阅）、产物（活跃总数、按类计数、
最近列表）、告警面（alert_rule 计数、firing 中计数、近 24h 事件数）、需求单
（进行中计数、最新一单摘要）与**追踪主体**（subject 总数、按 kind 分类计数、
最近列表）。端点只读、免费档可用、读取不产生行数计量。

#### Scenario: 聚合一次返回

- **WHEN** 已登录客户请求 `GET /api/v1/workbench`
- **THEN** 七个 section（datasets/packs/artifacts/alerts/demands/subjects 及配额）在单次响应中如实返回，数字与各业务面一致

#### Scenario: 无主体时如实空态

- **WHEN** 客户尚未声明任何追踪主体
- **THEN** subjects section 返回计数 0 与空列表，不呈现虚构主体

#### Scenario: 未登录拒绝

- **WHEN** 无有效登录会话请求该端点
- **THEN** 返回 401，不产生任何数据库读副作用以外的响应内容

### Requirement: 工作台跨客户隔离

工作台聚合响应 SHALL 仅含请求客户自己的数据：数据集、订阅、产物、告警事件、
需求单、追踪主体均按 customer_id 过滤；其他客户的任何标识不出现在响应体中。

#### Scenario: 隔离

- **WHEN** 客户 A 请求工作台而库中存在客户 B 的数据集/产物/订阅/需求/主体
- **THEN** 响应各 section 仅统计与呈现 A 的条目，B 的名称/标识/计数零出现
