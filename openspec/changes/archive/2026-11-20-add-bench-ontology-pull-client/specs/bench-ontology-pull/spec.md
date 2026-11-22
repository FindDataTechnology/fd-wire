# bench-ontology-pull Specification（delta）

## Purpose

wire 作为知验台发布本体的消费者（第一个，非唯一）：拉取客户端、本地快照落库（幂等）、只读投影查询面、可选定时拉取。松耦合铁律的消费端兑现——拉到、存好、可查，升级自主。总纲见 law-bench `docs/knowledge-platform-blueprint.md`（P1 判据「wire 拉到 v1 本体快照并落库」）。

## ADDED Requirements

### Requirement: 拉取客户端与凭据纪律

wire SHALL 提供对知验台分发面的拉取客户端（目标 `GET {BENCH_PULL_URL}/api/v1/distribution/{domain}/ontology`，头 `X-Consumer-Token`），支持指定版本或缺省最新；服务端 401/403/404 SHALL 如实透传（错误信息保留语义：缺凭据/未登记/已吊销/越域/无发布），网络错误 SHALL 如实报错且不误标成功；凭据 SHALL 只经 env 进入进程，永不落仓、永不进日志（值脱敏）；凭据缺失时客户端 SHALL 启动可报错（惰性，指明缺哪个 env）而不使应用崩溃。

#### Scenario: 拉取成功落库
- **WHEN** 配置了有效凭据并执行拉取
- **THEN** 快照载荷（domain/模板锚定/版本/digest/实体与关系全量）落本地快照表，拉取日志记成功与 digest

#### Scenario: 失败如实不误标
- **WHEN** 知验台返回 403（令牌已吊销）或网络不可达
- **THEN** 拉取日志记失败与错误摘要（脱敏），本地无新增快照行，无任何「已同步」误标

### Requirement: 本地快照落库幂等

拉到的快照 SHALL 以 (domain, digest) 幂等落库：同 digest 重复拉取 SHALL NOT 产生新快照行（返回既有行）；不同版本各自成行、版本与 digest 随快照冻结不可变；快照为平台级数据（不挂 wire 客户租户），仅运营面可读。

#### Scenario: 重复拉取幂等
- **WHEN** 同一版本被拉取两次
- **THEN** 第二次命中既有快照行（无新行），拉取日志仍有两条（拉取史完整）

#### Scenario: 历史版本冻结
- **WHEN** 平台发布 v2 后重新拉取 v1
- **THEN** v1 快照行内容不变（digest 逐字节校验一致）

### Requirement: 只读投影查询面

wire SHALL 暴露快照的只读查询面（按域列版本与 digest、按 kind 列实体、列关系并按结构化 from/to 与键约定 `{from_key}->{kind}:{to_key}` 重建两端身份）；投影面 SHALL NOT 提供任何写路径（不写 wire 自有 entities 表，不做本地编辑）；无快照的域查询 SHALL 返回空集而非报错。

#### Scenario: 身份重建
- **WHEN** 消费方查询某域关系列表
- **THEN** 每条关系可经键约定与 from/to 结构化字段重建两端身份，无需额外解析逻辑

#### Scenario: 空域如实
- **WHEN** 查询从未拉取过的域
- **THEN** 返回空集与「无快照」状态标记，不报错

### Requirement: 定时拉取与失败纪律

wire SHALL 支持可选的定时拉取（env 开关，沿既有 scheduler 模式）：对配置的域列表逐域拉最新版；单域失败 SHALL 不中断其余域、失败如实入拉取日志；调度器异常 SHALL 不影响应用主流程。

#### Scenario: 多域部分失败
- **WHEN** 配置两域且知验台对其中一域返回 403
- **THEN** 另一域正常落库，失败域入错误日志，调度器下一轮继续
