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

- [x] 3.1 caller-map admin API（PUT/GET/DELETE /api/sub2api-caller-map，生产实锤 admin 200/非 admin 403）：registry app 新端点（`nginx_proxied_auth` + `_require_admin` + audit，对齐 `/iam/groups` 模式）读写 `sub2api_caller_map` 集合（username → sub2api_user_id）；验证：admin wgk- 可写可读、非 admin 403，单测随迁
- [x] 3.2 preflight 读集合（两层+TTL+2s 有界读+fail-open；生产实锤 drill 仅 Mongo 映射 200）：`_caller_map` 改为集合读取 + 30-60s TTL 缓存，env `SUB2API_CALLER_MAP` 降为覆盖层（env 优先）；验证：单测覆盖「集合写入→TTL 过期→生效」「env 覆盖集合」「集合不可达时行为」
- [x] 3.3 `PREFLIGHT_UNMAPPED` 开关（生产 deny：未映射非 admin 402 CALLER_NOT_MAPPED 具名留痕、admin 豁免直通）（pass|warn|deny，默认 pass）：deny 下未映射非 admin 调用者拒绝、admin scope 保持 skip-pass；验证：单测三分支 + 生产切 deny 后漏配身份即时 402/deny
- [ ] 3.4 **部分完成（2026-10-08）**：代码在 github 线 wire-onboarding@1ffa7cb（基座=部署镜像 63126fe），镜像经 scs001 仓 GHA→hkccr→ccr 中继线构建 sha-1ffa7cb，cheap-1 prebuilt 已滚、五项冒烟绿；**gitee 线同步遗留**（两线谱系无关，cherry-pick 需理 4 文件冲突——运行时以 github 线为准，/opt 树仅簿记）：cherry-pick 纪律（同 lex-legal da4c6cf7 先例）、CN 镜像配方重建、cheap-1 ff + `up -d --no-deps --no-build`、合并 gitee main；验证：容器内冒烟（venv python 配方）+ 生产探针复跑 2.2

## 4. 切片二 · registry 代铸与代吊（同分支同船）

- [x] 4.1 代铸字段（生产实锤：admin 代铸归属/组精确、非 admin 403、半对 schema 拒绝） `{username?, groups?}`（成对语义：代铸即指定归属与组快照；非 admin 传字段 → 403 忽略拒绝）；验证：单测覆盖代铸归属正确、非 admin 拒绝、特权组写防护（wire-cust-* 不得映 admin scope）
- [x] 4.2 admin 旁路（生产实锤：代吊外属 key 200 → 即时 401；非 admin 仍 404）admin 可吊任意 key（owner 校验对 admin 放行），重复吊销仍 409；验证：单测 + 真实退租演练（drillcust001 旧 key 代吊）
- [x] 4.3 cell-manager 收口（AdminMintChannel 代铸+put_caller_map 写映射；生产 grant preflight_map=written；116 测试绿）：验证：`cell-manager` 铸 key 子步骤切换到代铸 API（1.4 的 TODO 收口），探针复跑

## 5. 切片二 · infra 直读通道（探针闸门）

- [x] 5.1 只读账号（集合级角色 wireMeteringRO：audit_events_default find-only，写/他集合 Unauthorized 实证）：仅 `mcp_registry.audit_events_default` 读权限、authSource=admin；验证：该账号读集合成功、写/读他集合被拒
- [x] 5.2 tailnet 绑定（HOST_BIND_IP=100.64.0.11 逃生口，零 compose 改动；mongo healthy）：（单滚 mongo，`--no-deps --no-build`，预告短停）；验证：cheap-1 本机 + tailnet 另一主机可达、公网不可达
- [x] 5.3 闸门探针 **PASS**（fd-prod 临时 pod → 100.64.0.11:27017 出站 OK）：cheap 集群临时 pod（`kubectl --context cheap -n fd-prod run`）对 cheap-1 tailnet IP:27017 真实出站探测；验证：探针结果留档——**通过 → 5.4；失败 → 直读挂起、推送口径另立 change（本 change 到此收口）**
- [x] 5.4 开闸（三层坑连环修：Secret 键名小写 registry_mongo_uri、镜像缺 pymongo→api 镜像装 .[mongo] 经 scs001+hkccr→ccr 线 sha-5d3c2fa、poller 集合名 audit_events_default 显式 env；**14:56 起实拉入账**，7 天水位回填中——追平后满足「10 分钟入账」判据）：Secret `fd-wire-env` 填 `REGISTRY_MONGO_URI/DB` → 滚动 fd-wire-api；验证：真实客户调用后 10 分钟内 wire `metering_records` 出现对应行、来源标注正确

## 6. 终验

- [x] 6.1 全量验收（2026-10-08/09 生产实证归档）：cell-grant 四 Scenario ✓（铸造幂等/跨客户 403+目录恰见 2/回收宽幂等/平台 12 无恙——**含 listing 根因修复**：import 默认空 list_service 的 fail-closed 覆盖，per-scope 发现面声明已固化进 upsert）；caller-preflight-map ✓（API 自动建立/402 三态/deny 具名/30s 内生效）；customer-key-minting ✓（代铸归属精确/快照即所铸组/admin 代吊即时/集群侧仅 admin 凭据无根信任材料）；metering-poll-channel ✓（水位追平后事件→入账 7 秒/闸门探针 PASS/直读通道即 spec 正道）。ceremony 文档 §5 已改「一条命令」口径；遗留④ business-mcp 上游 401 修复（942705ac 两半移植 github 线，双 key 200+注入日志）
