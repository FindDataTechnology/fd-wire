## MODIFIED Requirements

### Requirement: 产物生产型 pack SHALL 声明其构建服务

pack manifest 的 `mcpServers` SHALL 声明该 pack 全部技能点名的服务（沿用 `pack-server-closure` 校验）。凡是技能会写入产物的 pack（产物构建、数据治理、以及任何声明「把结论沉淀为产物」的分析套件），`mcpServers` SHALL 包含产物构建服务；只读分析 pack MAY 不声明，其行为与现状一致。

> 实现态注记（2026-11-05 体检 P1-10）：本 Requirement 截至体检日在 fd-wire 仓内无实现入口（能力悬空），落地前 SHALL NOT 视为在产契约；实现落地时由后续 change 移除本注记。

#### Scenario: 产物生产型 pack 声明构建服务

- **WHEN** 一个 pack 的技能正文引用 `mcp__wire-build-mcp__wire_artifact_dashboard_create`
- **THEN** 该 pack 的 `mcpServers` 含 `wire-build-mcp` 条目，`pack-server-closure` 校验通过

#### Scenario: 只读分析 pack 行为不变

- **WHEN** 一个既有分析套件不声明产物构建服务
- **THEN** 其工具面、安装行为与计量归属逐字节不变

### Requirement: pack MAY 内嵌 fleet 段作为舰队模板

pack manifest MAY 携带 `fleet` 段（沿用壹座 `fleet-template` 契约：members/ref 树/节奏/目标位）。带 `fleet` 段的 pack 安装时 SHALL 实例化一支全暂停的舰队，由安装者显式启动；不带 `fleet` 段的 pack SHALL 行为与现状完全一致。

> 实现态注记（2026-11-05 体检 P1-10）：本 Requirement 截至体检日在 fd-wire 仓内无实现入口（能力悬空），落地前 SHALL NOT 视为在产契约；实现落地时由后续 change 移除本注记。

#### Scenario: 带舰队段的 pack 安装即出舰队

- **WHEN** 安装一个含 `fleet` 段的 pack
- **THEN** 生成一支全暂停舰队，岗位、KPI 槽位与节奏按模板落库，安装者启动后才执行

#### Scenario: 不带舰队段的 pack 行为不变

- **WHEN** 安装一个不含 `fleet` 段的 pack
- **THEN** 不产生任何舰队或岗位，安装路径与现状一致

### Requirement: 舰队节奏 SHALL 由信号驱动

无人值守舰队 SHALL 以真实业务信号作为发起依据（覆盖缺口、质量快照、需求单、使用与告警），SHALL NOT 仅凭固定 cron 无差别轮转。无信号时 SHALL 不发回合，并在报数中如实声明「本轮无信号」。

> 实现态注记（2026-11-05 体检 P1-10）：本 Requirement 截至体检日在 fd-wire 仓内无实现入口（能力悬空），落地前 SHALL NOT 视为在产契约；实现落地时由后续 change 移除本注记。

#### Scenario: 无信号不发回合

- **WHEN** 一个周期内没有新信号
- **THEN** 舰队不发执行回合，岗位报数记录「无信号」

#### Scenario: 信号到达才起回合

- **WHEN** 出现新需求单、覆盖缺口或质量异常
- **THEN** 对应岗位按信号起回合，回合 brief 携带该信号的证据

### Requirement: 产品内容自进化 SHALL 止于人工门

agent 对柏讯自有内容（技能稿、套件 manifest、示例产物）的修改 SHALL 以分支 PR 形式提交并附验证证据（`check_presets.py`、`pack-server-closure`、真校验器）。自动路径 SHALL NOT 自行 merge、SHALL NOT 点亮任何调度、SHALL NOT 改动工单目标以外的文件。

> 实现态注记（2026-11-05 体检 P1-10）：本 Requirement 截至体检日在 fd-wire 仓内无实现入口（能力悬空），落地前 SHALL NOT 视为在产契约；实现落地时由后续 change 移除本注记。

#### Scenario: 自进化产出 PR

- **WHEN** 舰队完成一轮技能稿或套件 manifest 修改
- **THEN** 提交一个带验证证据的分支 PR，等待人工 merge

#### Scenario: 越权被拒

- **WHEN** 自动路径尝试直接 merge、点亮调度或改动范围外文件
- **THEN** 该动作被拒绝并留下拒绝原因
