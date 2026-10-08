# Tasks: add-customer-onboarding-automation

## 1. 切片一 · cell-manager 开户自动化（fd-wire 仓，无 registry 发版）

- [x] 1.1 secrets map 扩展：`CELL_CUSTOMER_CREDENTIAL_MAP` 同级新增 `CELL_CUSTOMER_IDENTITY_MAP`（`customer_id → {username, sub2api_user_id}`）；验证：单测覆盖 map 解析 + 缺项报错（test_grant.py 7 形状用例）
- [x] 1.2 注册调用补隔离字段：register 表单带 `visibility=group-restricted` + `allowed_groups=wire-cust-<cid>`（registry 既有 Form 字段）；验证：单测断言表单字段存在且值正确（test_registry_http.py）
- [x] 1.3 授权文档铸造子步骤：调 `POST /api/servers/groups/import`（`create_in_idp:false`），幂等 upsert；验证：mock registry 断言 payload（含 create_in_idp:false）+ Fake 幂等重放
- [ ] 1.4 铸 key 子步骤（第一步通道）：cheap-1 本机读 SECRET_KEY → 自签短命 JWT → `POST /api/patch-keys`，明文只走返回值（审计只落 key_id）；验证：单测已绿（claims 形状/明文纪律/簿记），**生产真实验证绑在 2.1 drillcust001 重铸内做**
- [ ] 1.5 预检映射写入子步骤：调 registry caller-map admin API（`CELL_PREFLIGHT_MAP_PATH`）；验证：写入后 `db.sub2api_caller_map` 可查到该行。**实施偏差（2026-10-08）**：不做「直写 Mongo 过渡实现」——破坏 cell-manager 零第三方依赖纪律且引入一次性凭据面；改为 API 路径未配置时显式 skipped+审计留痕，切片一验收走 registry 侧 env 覆盖层（行为不变），3.1 落地后配置路径即激活
- [x] 1.6 退租子命令：吊销 key → 删授权文档 → 注销条目 → deprovision（D6 序）；幂等可重跑、无宽限；验证：连续执行两遍无报错、无授权面残留（test_grant.py 三个退租用例 + CLI fake 冒烟）

## 2. 切片一 · 存量补正与演练验收

- [x] 2.1 drillcust001 重铸：按新约定重注册（带 visibility 字段，overwrite）+ 补授权文档 + 换组快照正确的 key + 写预检映射（env 覆盖层）；验证：条目 `visibility=group-restricted`、`allowed_groups=["wire-cust-drillcust001"]`（生产 Mongo 实查通过；期间发现 drill cell 容器丢失，已按 provision 同规格重建并顺带完成客户 key 注入）
- [x] 2.2 验收判据跑批：initialize 自己 cell → **200**（含完整 MCP 握手 tools/list 真工具）；非授权 server → **403**；目录只见业务面（不见任何别家 cell）；平台凭据全量 12 不受影响；余额 10→调用 **200**、余额 0→**402 INSUFFICIENT_BALANCE**（preflight 日志具名 drillcust001）、恢复→**200**。遗留记录：①「自己 cell 不进 listing」——单条视图 200、调用面全通，仅列表管道缺它（根因在部署链的 accessible_servers 管道，判据未覆盖，挂切片二查）；②business-mcp 上游自身 401（预存在，与本次无关）；③不存在路径落兜底 405（无泄露，形状待切片二顺手改 404）

## 3. 切片二 · registry 预检映射（gitee/main @ dbf213e 新分支，跨仓）

- [ ] 3.1 caller-map admin API：registry app 新端点（`nginx_proxied_auth` + `_require_admin` + audit，对齐 `/iam/groups` 模式）读写 `sub2api_caller_map` 集合（username → sub2api_user_id）；验证：admin wgk- 可写可读、非 admin 403，单测随迁
- [ ] 3.2 preflight 读集合：`_caller_map` 改为集合读取 + 30-60s TTL 缓存，env `SUB2API_CALLER_MAP` 降为覆盖层（env 优先）；验证：单测覆盖「集合写入→TTL 过期→生效」「env 覆盖集合」「集合不可达时行为」
- [ ] 3.3 `PREFLIGHT_UNMAPPED` 开关（pass|warn|deny，默认 pass）：deny 下未映射非 admin 调用者拒绝、admin scope 保持 skip-pass；验证：单测三分支 + 生产切 deny 后漏配身份即时 402/deny
- [ ] 3.4 gitee 线交付：cherry-pick 纪律（同 lex-legal da4c6cf7 先例）、CN 镜像配方重建、cheap-1 ff + `up -d --no-deps --no-build`、合并 gitee main；验证：容器内冒烟（venv python 配方）+ 生产探针复跑 2.2

## 4. 切片二 · registry 代铸与代吊（同分支同船）

- [ ] 4.1 `POST /api/patch-keys` 增 admin-only 可选字段 `{username?, groups?}`（成对语义：代铸即指定归属与组快照；非 admin 传字段 → 403 忽略拒绝）；验证：单测覆盖代铸归属正确、非 admin 拒绝、特权组写防护（wire-cust-* 不得映 admin scope）
- [ ] 4.2 DELETE 加 admin 旁路：admin 可吊任意 key（owner 校验对 admin 放行），重复吊销仍 409；验证：单测 + 真实退租演练（drillcust001 旧 key 代吊）
- [ ] 4.3 与 3.4 同船交付；验证：`cell-manager` 铸 key 子步骤切换到代铸 API（1.4 的 TODO 收口），探针复跑

## 5. 切片二 · infra 直读通道（探针闸门）

- [ ] 5.1 cheap-1 mongo 只读账号：仅 `mcp_registry.audit_events_default` 读权限、authSource=admin；验证：该账号读集合成功、写/读他集合被拒
- [ ] 5.2 compose 端口发布到 tailnet IP（单滚 mongo，`--no-deps --no-build`，预告短停）；验证：cheap-1 本机 + tailnet 另一主机可达、公网不可达
- [ ] 5.3 **闸门探针**：cheap 集群临时 pod（`kubectl --context cheap -n fd-prod run`）对 cheap-1 tailnet IP:27017 真实出站探测；验证：探针结果留档——**通过 → 5.4；失败 → 直读挂起、推送口径另立 change（本 change 到此收口）**
- [ ] 5.4 开闸：Secret `fd-wire-env` 填 `REGISTRY_MONGO_URI/DB` → 滚动 fd-wire-api；验证：真实客户调用后 10 分钟内 wire `metering_records` 出现对应行、来源标注正确

## 6. 终验

- [ ] 6.1 全量验收判据复跑（specs 四能力逐 Scenario）+ fd-wire/docs/service-credentials.md §5 ceremony 更新为「一条命令」口径；验证：探针脚本全绿 + 文档 PR
