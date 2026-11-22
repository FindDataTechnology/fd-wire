# wire-subject-tracking Specification

## Purpose

追踪主体（subject）：把「客户想持续跟踪的一个对象」做成柏讯的一等对象——声明其类型与引用、绑定若干信号通道（指标/公告/工商/关系网/背景）、按通道扇出读取并为每条通道标注覆盖三态，再把一次读取物化成客户数据集，从而接入既有的告警、刷新、看板与市场面。

## Requirements

### Requirement: 追踪主体的声明与kind词表

系统 SHALL 支持客户声明追踪主体（subject），含：`kind`、`ref`、`title`、可选 `description`、`channels[]`。`kind` SHALL 限于 `company`、`industry`、`chain`、`country`、`region`。`ref` SHALL 按 kind 解析到既有实体来源（见 `<ref 解析>`）。同一客户内 `title` 不要求唯一，但主体 SHALL 按客户隔离：他企主体 MUST 返回 404 且不泄露存在性。

#### Scenario: 声明企业主体

- **WHEN** 客户声明 `kind=company`、`ref={source: "stock_code", code: "600519"}` 的主体
- **THEN** 主体落库并可跨会话读取
- **AND** 其 `channels` 默认可含 announcements 与 indicators

#### Scenario: 非法 kind 拒绝

- **WHEN** 客户声明 `kind=person` 或未在词表内的类型
- **THEN** 返回 422 并指明合法 kind 集合，不落实体行

#### Scenario: 跨客户隔离

- **WHEN** 客户 A 请求客户 B 的主体
- **THEN** 返回 404，不泄露该主体存在性

### Requirement: ref 按来源解析

每个 `ref` SHALL 声明一个来源 `source` 与该来源内的标识：`stock_code`（证券代码，company/industry 成员）、`industry_code`（申万/分类体系代码）、`country_code`（ISO/世行代码）、`region_code`、`chain_spec`（`{name, segments:[industry refs]}`）、或 `custom_label`。系统 SHALL 把 `ref` 解析成通道投影器所需的标识，解析不到时 SHALL 如实标注（见覆盖三态），MUST NOT 静默替换为邻近实体。

#### Scenario: 证券代码解析

- **WHEN** `ref={source:"stock_code", code:"600519"}`
- **THEN** indicators 与 announcements 通道以 `600519` 寻址

#### Scenario: 解析不到如实体现在读面

- **WHEN** `ref` 的代码在任何上游实体均无匹配
- **THEN** 读面 `coverage=unavailable` 并给出原因，MUST NOT 返回空主体当成功

### Requirement: 通道投影器的统一形状

每个通道 SHALL 为通道类型之一：`indicators`、`announcements`、`registry`、`graph`、`context`。每个通道经一次读取 SHALL 返回统一形状：`{type, status, coverage, rows, as_of, errors?}`，其中 `status ∈ {ok, partial, unavailable}`，`coverage ∈ {available, stale, unavailable}`。系统 MUST NOT 把「上游不可用」或「该源不支持」渲染成「0 条」。

#### Scenario: 通道可用

- **WHEN** 一个 announcements 通道经 fd-info 取到该主体条目
- **THEN** 返回 `coverage=available`、`rows` 为条目列表、`as_of` 为数据截至日

#### Scenario: 上游不可用如实标注

- **WHEN** 某通道的上游服务不可达
- **THEN** 该通道 `coverage=unavailable`、`status=unavailable` 且带原因，其余通道不受影响照常返回

#### Scenario: 通道级失败隔离

- **WHEN** 主体有多个通道且其中一个失败
- **THEN** 读面照常返回其余通道结果，失败通道单独标注，整体读取不失败

### Requirement: 实时读面与对齐时间轴

系统 SHALL 提供 `wire_subject_read`（按主体 id）：扇出该主体全部通道，返回 `{subject, channels[], timeline[]}`。`timeline` SHALL 为各通道事件按时间对齐的合并视图，每条事件带来源通道与指向原通道行的引用。读面 SHALL 只读、SHALL NOT 产生计量计费、SHALL NOT 修改任何上游数据。

#### Scenario: 多通道对齐

- **WHEN** 主体同时有公告与指标通道
- **THEN** `channels` 逐通道返回，`timeline` 按日期合并两类事件并逐条标注来源通道

#### Scenario: 只读零副作用

- **WHEN** 调用一次 `wire_subject_read`
- **THEN** 不写入任何上游库、不产生行数计量记录

### Requirement: 物化为客户数据集

系统 SHALL 提供 `wire_subject_snapshot`（按主体 id）：把一次读结果落成该客户名下数据集（`source_kind="subject"`、`source_ref` 为主体标识），行形状为对齐后的时间轴扁平表。物化 SHALL 走客户凭据轨道计量的口径与既有建集一致；行数/存储闸照既有建集规则，超限整批拒绝零半写。重复物化 SHALL 幂等：同主体再次快照更新既有数据集而非新建。

**快照数据集 SHALL 可直接被既有面消费**：告警规则、刷新调度、看板面板 query、数据市场均可把它当作普通客户数据集，行为不需要为 subject 特化。

#### Scenario: 快照建立数据集

- **WHEN** 客户对某主体执行快照
- **THEN** 生成/更新一个 `source_kind="subject"` 数据集，行数为对齐时间轴条数

#### Scenario: 快照进入既有告警

- **WHEN** 客户基于该快照数据集建一条 `alert_rule`（query.dataset_id=快照集）
- **THEN** 告警按既有评估路径工作，无需 subject 专属逻辑

#### Scenario: 幂等更新

- **WHEN** 对同一主体连续快照两次
- **THEN** 第二次更新既有数据集（不新建第二个），行集按最新读结果重建

### Requirement: 通道可增删且影响如实呈现

系统 SHALL 允许对主体增删通道。删除某通道后该主体的读面 SHALL 不再包含该通道；新增通道后下一次读 SHALL 包含它。通道声明 SHALL 校验：通道类型的必备 `ref`/参数缺失时 422 如实定位，不落半写。

#### Scenario: 增删通道

- **WHEN** 客户为主体加一个 `registry` 通道再删除
- **THEN** 读面先含后不含该通道，主体其余部分不变

#### Scenario: 非法通道拒绝

- **WHEN** 声明 `indicators` 通道但缺指标标识
- **THEN** 422 指明缺字段，主体通道集合不变
