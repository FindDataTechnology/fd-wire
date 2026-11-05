## 1. 档位字段落列与校验

- [x] 1.1 迁移 0050：entities/entity_relationships 各加 `tier`/`sensitivity` 两列（String nullable）+ 存量 `column_notes["_bench"]` 袋标记幂等回填（verify: 迁移自建测试——加列幂等重跑零新增；回填行数=带袋且含标记的行数；袋内容逐字保留）
- [x] 1.2 service 层词表常量单点（TIERS/SENSITIVITY_LEVELS，值域与 bench promotion.py 逐字对齐）+ PUT 校验接线（verify: 词表外值 422 指明非法值与合法词表；v0 请求（不带新键）全量既有测试逐字节等价）
- [x] 1.3 出参接线：EntityOut/RelationshipOut/GraphNodeOut/GraphEdgeOut 增两字段（null 显式）（verify: 出参形状测试；空值路径显式 null 非缺省省略）

## 2. 关系更新面

- [x] 2.1 `PUT /api/v1/entities/{id}/relationships/{rid}`：label/tier/sensitivity 白名单可写；结构键携带即 422（verify: 更新生效+出参回显；结构键变更 422 指明「删除+重声明」；rid 不存在/跨客户 404）
- [x] 2.2 更新写本体变更事件流（update 事件）+ 版本化接线（verify: 事件流出现 update 记录；manifest 关系条含新键）

## 3. 实体读面机器通道

- [x] 3.1 `/api/v1/internal/entities`（graph+list 只读 GET）：X-Internal-Token 鉴权 helper（同源 secret，entities 模块内实现）+ 客户 scope 白名单 env（verify: 白名单内返回形状与 console 面一致；无/坏 token 401；scope 外客户 404 不泄露存在性；缺配置 503 报精确缺项）
- [x] 3.2 机器面无写端点硬边界（verify: 对镜像面 POST/PUT/DELETE 全部 404/405；路由注册面断言无写方法）

## 4. 版本化纳管

- [x] 4.1 canonical manifest 实体条+关系条加 `tier`/`sensitivity` 键（恒出现）+ 归一化读取缺键按 null（verify: 新快照 digest 确定；跨键集边界对比/回滚 plan 按 null 归一；历史快照 digest 不变）
- [x] 4.2 回滚执行恢复两字段（verify: 回滚后快照 digest 与目标版本一致路径含新字段值）

## 5. 部署与收口

- [x] 5.1 部署清单加 `FD_WIRE_INTERNAL_ENTITY_CUSTOMERS=drillcust001`（verify: 部署 yaml/ConfigMap 变更在案，scope 生效探针过）
- [x] 5.2 导出/文档面注记「0050 前后导出物新增两键」（verify: 版本导出 README 或 spec 文档段落在案）
- [x] 5.3 api 全量测试 + conformance 门（verify: 全量 pytest 绿；`python3 fd-industry-data/scripts/conformance_gate.py` 无新增违规）
