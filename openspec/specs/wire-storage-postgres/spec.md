# wire-storage-postgres Specification

## Purpose
定义柏讯专用 PostgreSQL 存储：实例配方（钉版/卷/备份/恢复）、api 双 URL 语义
（元数据与数据集库分离且均可指 PG）、模型与迁移的 SQLite+PG 双方言保障，以及
生产迁移与回退手册——使 api 侧存储摆脱多 SQLite 文件与 /tmp 脆弱点，为数据
中台规模地基（含免费档 api 层行存储）就位。

## Requirements

### Requirement: 专用实例配方

柏讯提供可执行的 wire 专用 PG 实例配方：pg16-trixie 钉版、shm 512m、独立持久
卷、健康检查；元数据与数据集分属两个 database（wire_platform / wire_datasets）；
升级换版为显式变更（改 tag），不静默漂移。

#### Scenario: 配方可起
- **WHEN** 按 deploy/wire-postgres 文档在 docker 环境执行
- **THEN** 实例就绪、两库存在、健康检查通过，重跑幂等

### Requirement: 备份与恢复

每日对两库分别产出备份文件（保留策略可配），恢复手册给出恢复到任一备份点的
命令序列并经过演练验证。

#### Scenario: 备份可恢复
- **WHEN** 执行备份脚本后按恢复手册演练
- **THEN** 两库可恢复至备份点且数据完整

### Requirement: api 双 URL 语义

api 存储由 `FD_WIRE_DATABASE_URL`（元数据）与 `FD_WIRE_DATASETS_DATABASE_URL`
（数据集库）两个 URL 定义，均可指向 PostgreSQL（psycopg3 驱）；未配置时回落
SQLite 文件——开发与测试的默认行为不变。

#### Scenario: 切换后端
- **WHEN** 把两个 URL 从 SQLite 换成 PG 连接串并重启
- **THEN** 建表迁移与应用启动照常，无需代码分叉

### Requirement: 双方言保障

全部模型与迁移在 SQLite 与 PG 两方言下可建可查：JSON 列经 SQLAlchemy 抽象
（PG JSONB）、布尔聚合一律 count FILTER、时间统一 naive-UTC；双方言保障以测试
矩阵落地（有 PG 实例则真连，否则方言编译断言兜底）。

#### Scenario: 同套迁移两方言
- **WHEN** 对同一 alembic 链分别在 SQLite 与 PG 上执行 upgrade
- **THEN** 两边全部表结构建成且核心 CRUD 用例通过

### Requirement: 生产迁移与回退手册

生产 SQLite→PG 搬迁有手册：备份→建库→迁移→数据搬运（逐表计数对账+关键聚合
抽查）→切环境变量→验证清单；回退=切回旧 URL 且旧库只读保留一周期；滚动执行
为独立运维步骤。

#### Scenario: 对账不过即止
- **WHEN** 数据搬运后某表计数对账不一致
- **THEN** 手册规定中止切换、不切环境变量，旧库保持服务

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
