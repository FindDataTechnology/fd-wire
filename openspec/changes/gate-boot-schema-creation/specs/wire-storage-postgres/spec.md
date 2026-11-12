# wire-storage-postgres Specification（delta）

## ADDED Requirements

### Requirement: 启动期 schema 处置受开关控制

api 启动时的建表行为 SHALL 由一个总开关 `FD_WIRE_BOOT_AUTO_CREATE_TABLES` 控制，取值语义与
既有逐模块开关一致（`1/true/yes/on` 为开，`0/false/no/off` 为关），**未设置时按开启处理**
以保持开发与测试的既有行为不变。

逐模块开关（`FD_WIRE_<MODULE>_AUTO_CREATE_TABLES`）SHALL 保留，并在总开关之外独立生效：
**更具体的逐模块开关优先于总开关**——任一模块可单独开启或关闭自己的启动建表，不受总开关
限制。所有具备启动建表能力的模块 SHALL 遵守这一优先级，不存在无视开关的模块。

#### Scenario: 生产关闭总开关后启动期零 DDL
- **WHEN** 总开关为 `0` 且目标库 schema 已由迁移链建好，api 启动
- **THEN** 启动过程不发出任何建表语句，服务正常就绪

#### Scenario: 未设置开关时行为不变
- **WHEN** 总开关与逐模块开关都未设置，在空库上启动
- **THEN** 各模块照旧建表，启动成功（开发与测试的默认路径零漂移）

#### Scenario: 逐模块开关优先于总开关
- **WHEN** 总开关为 `0`，而某模块的逐模块开关为 `1`
- **THEN** 仅该模块执行启动建表，其余模块不执行

### Requirement: 关闭建表时执行一次反射校验

启动建表被关闭时，api SHALL 对每个库做**一次**表名反射，并与模型声明比对，SHALL NOT 退化为
逐表存在性查询；校验本身 SHALL NOT 发出任何 DDL。

校验强度由 `FD_WIRE_BOOT_SCHEMA_CHECK` 控制，取值为 `off` / `warn` / `strict`，缺省 `warn`：

- `off`：不做校验。
- `warn`：缺失表逐条记 WARNING 日志（含表名）后继续启动。
- `strict`：缺失表逐条记 ERROR 日志后**拒绝启动**，错误信息 MUST 列出缺失表名。

#### Scenario: strict 缺表拒绝启动并点名
- **WHEN** 总开关为 `0`、校验为 `strict`，且库中缺少某模块的表
- **THEN** 启动失败，日志与错误信息列出缺失的表名（不是只在首个请求时 500）

#### Scenario: warn 缺表仅告警
- **WHEN** 总开关为 `0`、校验为 `warn`（缺省），且库中缺少表
- **THEN** 启动成功，日志含带表名的 WARNING

#### Scenario: off 完全静默
- **WHEN** 校验为 `off` 且库中缺少表
- **THEN** 启动成功且不产生校验相关日志

### Requirement: 启动期 schema 处置可观测

api 启动 SHALL 记录启动期 schema 处置的耗时：每模块一行（模块标识 + 耗时）与总耗时一行，
使"启动变慢"可从日志读出，而不必从容器重启次数反推。日志 SHALL NOT 包含任何连接串或凭据。

#### Scenario: 启动日志可读出耗时
- **WHEN** api 启动完成
- **THEN** 日志中存在逐模块耗时行与总耗时行，且总耗时与首行到"启动完成"的时间差量级一致
