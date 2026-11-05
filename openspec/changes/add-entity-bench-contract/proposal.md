## Why

知验台（law-bench bench-platform，2026-11-03 归档）P2「柏讯贯通」在 wire 侧撞出三个契约缺口（wire-connector 实查记录，见 law-bench-internal `wire-connector/README.md`）：gold 回写的 `tier`/`sensitivity` 无一等公民可写字段（连接器只能塞 `column_notes["_bench"]` 元数据袋）；关系只有 POST/DELETE 无更新面（gold 关系回写只能「删除+重声明」，连接器如实拒绝假装成功）；实体读面只收 console Logto ID token、无机器通道（持续同步无法自动化——唯一造号脚本要写生产 Logto 用户库，明令禁止）。bench-platform spec 的升格契约「gold 回写 wire 时 SHALL 附带 sensitivity/tier 标记供其 ACL 与舰队消费」因此对关系无法闭环、对自动化无法兑现。

## What Changes

- 实体与关系增一等公民 `tier`（`raw/bronze/silver/gold`/null，词表对齐 bench-platform 互斥四层）与 `sensitivity`（`public/internal/confidential`/null，对齐知验台 `SENSITIVITY_LEVELS`）字段：可写（实体 PUT 增量可选字段、关系更新面）、可读（EntityOut/RelationshipOut/GraphNodeOut/GraphEdgeOut 增量出参）、入库（迁移 0050）、纳入本体版本 canonical manifest。
- 存量回填：迁移把 `column_notes["_bench"]` 袋中已回写的 tier/sensitivity 标记解析升为一等字段（幂等；袋保留不删，连接器旧格式读法不受扰动）。
- 关系更新面：新增 `PUT /api/v1/entities/{id}/relationships/{rid}`——label/tier/sensitivity 白名单可写；结构性字段（两端/列/kind/junction 三键）不可变，改结构走删除+重声明。
- 实体读面机器通道：新增 `/api/v1/internal/entities` 只读镜像（graph+list），鉴权沿用 demands 内部端点的 `X-Internal-Token` 先例，token 绑定客户 scope（env 白名单，越界 404 如实）。
- 非目标：客户面（对象浏览/console）不按 sensitivity 做访问控制变更，现网客户行为零变化；机器面只读，回写仍走 console 身份（审核人归因天然在场）；ACL/舰队对 sensitivity 的实际消费逻辑属后续变更。

## Capabilities

### New Capabilities

（无——全部落在既有 entity-layer 能力面上）

### Modified Capabilities

- `entity-layer`: 增三条 requirement——知识档位一等字段（tier/sensitivity 语义、回填、版本纳管）、关系更新面（白名单可写+结构不可变）、实体读面机器通道（X-Internal-Token+客户 scope 只读）。

## Impact

- **代码**：`api/fd_wire_api/entities/`（models/routes/service/versioning）、`api/migrations`（0050 一档）、`demands` 的 `_require_internal` 模式复用（同级 helper，不交叉 import 需求模块）。
- **外部接口**：响应模型增字段（增量，旧客户端兼容）；EntityCreateIn 增可选字段（不带新键的 v0 请求行为逐字不变）；新增 1 个内部只读路由面。
- **版本化**：versioning canonical manifest 键集扩展（tier/sensitivity 恒出现）——历史快照不可变不受扰动，但跨键集边界的新旧导出对比须按 null 归一（design 记录策略）；回滚执行需写新字段。
- **下游**：law-bench-internal wire-connector 切一等字段+关系更新面+机器通道（姊妹 change `close-wire-real-loop`）；本体舰队对 sensitivity 的 ACL 消费后续另立。
