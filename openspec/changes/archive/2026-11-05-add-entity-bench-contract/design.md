# Design — add-entity-bench-contract

## Context

- bench-platform spec（law-bench 仓）升格契约要求 gold 回写带 `sensitivity`/`tier`；wire-connector 实查记录三个契约缺口（README「契约缺口清单」1/2/3）。
- 现状字段面：`entities` 表（models.py `Entity`）有 `column_notes: JSON` 元数据袋；`entity_relationships` 表（`EntityRelationship`）连袋都没有——关系侧连旧格式兜底都不存在，只有「拒绝假装成功」。
- 版本化（0049）：`versioning.py` canonical manifest 键集固定（`{"entities":[...],"relationships":[...]}`，每已知键恒出现、null 与缺省不混用、`json.dumps(sort_keys=True)`），digest=sha256。键集扩展会改变规范化形态。
- 内部鉴权先例：demands 模块 `_require_internal`（`X-Internal-Token`），生产已验证。
- 迁移链现役最新档 0049；本变更落 0050。

## Goals / Non-Goals

**Goals**
- 三缺口各得一个最小闭环契约面：字段一等化、关系可更新、机器可读。
- 对既有客户端与存量数据零扰动（增量可选字段、袋保留、历史快照不可变）。

**Non-Goals**
- 客户面数据面按 sensitivity 做访问控制（后续变更；本变更只供料）。
- 机器写面（回写走 console 身份——审核人归因天然在场，且写面扩权风险高收益低）。
- ACL/舰队对 sensitivity 的消费逻辑。
- 连接器侧改造（姊妹 change `close-wire-real-loop`，law-bench-internal 根）。

## Decisions

**D1 tier/sensitivity 落列，不落袋。** 两表各加两列（String, nullable）。词表校验在 service 层单点（对齐既有 strip/长度校验风格）；null=未标注，恒显式出现在出参与 manifest。备选「继续用 column_notes 袋」被否：袋无 schema 约束、无校验点、关系侧不存在，且 bench-platform spec 的「一等公民」语义就是要求可校验可索引的列。注：关系表**不加 column_notes**——连接器旧格式对关系本就拒绝，无兼容负担。

**D2 回填只升不删。** 0050 迁移解析 `column_notes["_bench"]` 中的 `tier=…; sensitivity=…` 标记升列，袋保留原样。幂等键=解析结果与列现值比对，一致即跳过。旧格式连接器读法不受扰动；新连接器直写列。备选「迁移顺带清袋」被否：回填与清理耦合会让幂等性变脆弱（第二次跑看不到标记），且破坏兼容承诺。

**D3 关系更新面白名单拒绝制，非静默忽略。** PUT body 携带任何结构键（两端/列/kind/declared_kind/junction 三键）即 422，错误信息指明「改结构须删除+重声明」。备选「忽略未知/结构键」被否：静默忽略会把「我以为改了其实没改」埋进调用方（openspec 1.12 对静默丢场景的立场同理）。声明方向纪律不变：`declared_kind` 不可变，无 1:n/n:1 归一化歧义。

**D4 机器通道 = 独立只读路由 + 同源 secret + 客户 scope 白名单。**
- 新 router 挂 `/api/v1/internal/entities`（graph/list 两个 GET），与 demands internal 平级；鉴权 helper 新写于 entities 模块内、复用同一 env secret（`FD_WIRE_INTERNAL_TOKEN`，沿用 demands 现役变量名；如部署侧另名，部署清单同步）——不 cross-import demands 模块。
- 客户 scope：env `FD_WIRE_INTERNAL_ENTITY_CUSTOMERS`（逗号分隔白名单）；请求以查询参数显式携带客户键（如 `?customer_id=…`），白名单外 404。不带 customer_id 参数 422。
- 备选 A「扩 console 依赖收 M2M JWT」被否：引入 OIDC client-credentials 校验面，工程量与攻击面都大，且 ID token 的 `sub→Customer` 映射对 M2M subject 无语义。备选 B「连接器走 MCP/wgk」被否（见提案前评估）：MCP 工具面无全图形状保证，客户端复杂化。
- 只读是硬边界：无 POST/PUT/DELETE 路由存在，不做「有路由但 405」。

**D5 版本 manifest 键集扩展，跨边界 diff 按 null 归一。** manifest 实体条与关系条各加 `tier`/`sensitivity` 两键（恒出现，null 显式）。历史快照不可变、digest 不重算；对「启用版本化前/后」跨键集边界的对比与回滚 plan，读取侧把缺失键归一为 null 再比。回滚执行恢复两字段（create/update 带 after 值）。风险：启用版本化后首个新快照与上一快照的 diff 会显示「新键出现」——属如实反映，事件折叠自检以当前态为准不受扰动。

**D6 词表常量单点。** 词表元组在 entities service 层定义一次（`TIERS`/`SENSITIVITY_LEVELS`），routes 校验与 versioning 归一化同源引用；值域与 bench 侧 `promotion.py` 的 `SENSITIVITY_LEVELS=("public","internal","confidential")` 与 bench-platform spec 四层 tier 逐字对齐（对齐检查入任务）。

## Risks / Trade-offs

- [机器令牌泄露可读全量客户实体] → scope 白名单按客户绑定（当前只放 drillcust001）；secret 走既有内部端点同源管理；只读面；出问题先删白名单条目（部署面止血，无需滚镜像）。
- [manifest 键集扩展造成跨边界 diff 噪音] → D5 null 归一；导出面注记「0050 前后导出物新增两键」。
- [回填误解析袋标记] → 解析器与连接器 writeback 的 stamp 格式互为镜像；迁移前对生产袋样本做 dry-run 计数核对（回填行数=带 `_bench` 袋且含 tier/sensitivity 标记的行数）。
- [词表未来扩展（如 sensitivity 加级）] → 校验在 service 单点，扩词表=改常量+迁移存量值，422 信息带合法词表降低排障成本。

## Migration Plan

1. 0050 迁移：加四列（entities/entity_relationships 各两列）+ 回填袋标记（幂等）。
2. 代码滚版：出参/写入/更新面/机器面/版本化同版上线（无先后窗口——旧版代码对新列无感知，列可先落）。
3. 部署清单加 `FD_WIRE_INTERNAL_ENTITY_CUSTOMERS=drillcust001`（初始 scope）。
4. 回滚：代码回滚即可（新列留库无害）；0050 不做降级档（列 nullable，旧代码零依赖）。

## Open Questions

（无——词表、scope 初始值、secret 来源均已在盘上事实中钉死。）
