# registry 侧需求：cell 隔离与 wire 接客前配套（2026-10-08 整理）

> **交付对象**：registry 专属 session（cheap-1 `/opt/mcp-gateway-registry`，gitee
> `FindDataTechnology/mcp-gateway-registry`，分支 `fd-backend-auth-fallback`，
> HEAD dbf213e 定版）。本文档自包含：每个需求的现状证据、期望行为、验收判据
> 都已给全，不需要读本 session 的上下文。
>
> **背景**：wire（柏讯 B2B）已生产上线：客户 cell（企业隔离容器）由
> cell-manager 全自动 provision 并注册进 registry；平台服务凭据（patch key
> `wgk-`）与入口标准 MCP 形态均已闭环。**接真实客户前，registry 侧有四个
> 缺口**，按优先级排列如下。
>
> **2026-10-08 状态更新（已复验）**：R1、R2 已由另一个 session 交付
> （`add-customer-onboarding-automation`，per-customer scope + Mongo
> caller-map + `PREFLIGHT_UNMAPPED` 开关），本 session 已按生产实态复验并
> 收口，详见各节末「交付状态」。R3、R4 仍待办。



---

## R1【P0】每客户 cell 条目隔离（现在互相可见、且谁都调不通自己的 cell）

### 现状（2026-10-08 生产实查）

- 每个客户 cell 是 registry 里的一个独立 server 条目，路径约定
  `fd-wire-cell-<customer_id>`（cell-manager `registry_path`）。
- **调用面（P0 的一半）**：wire 客户组的 scope `mcp-business-wire-execute`
  （group_mappings=`["wire-customers"]`）的 `server_access` 只放行
  `fd-find-data-business-mcp`——**没有任何 cell 条目**。同时 auth-server 的
  server 名匹配 `_server_names_match`（`auth_server/server.py:2184`）只支持
  `*` 全通配或全名匹配，**没有前缀通配**——没法用一条规则放行
  `fd-wire-cell-*`。结果：**客户经入口根本调不到自己的 cell**（初始化握手
  都过不了 scope 校验）。当前演练 cell 之所以通，是因为我们全用
  `mcp-registry-admin` 组的平台凭据。
- **发现面（P0 的另一半）**：cell-manager 走控制台
  `POST /api/servers/register`，不带 `visibility`/`allowed_groups`
  （server_routes.py:4313 有这两个 Form 字段但客户端没传）→ 条目落库为
  `public`。`mcp_servers_default` 实查：**drillcust001 条目无 visibility
  字段（=public）、无 allowed_groups**——任何客户在目录/列表里能看见
  别家企业的 cell 条目（企业名就挂在 display_name 里：「柏讯 cell ·
  <customer_id>」）。

### 期望行为

1. 客户（wire-customers 组）经入口**只能**调用 `fd-wire-cell-<自己的
   customer_id>`，不能调用其他任何客户的 cell，也不能看见别人的 cell 条目。
2. scope 授权能随 cell 开通/注销自动生效——**不希望每开一个客户都手改
   scope 文档**（现状 scope 是 Mongo 手工文档）。

### 建议方案方向（三选一，session 内定）

- **A（推荐）：per-customer scope 文档 + cell-manager 注册时联动创建**。
  cell-manager 注册 cell 时顺带（经新 internal API 或直接 Mongo）创建
  `mcp-wire-cell-<customer_id>` scope 文档：`server_access=[{server:
  "fd-wire-cell-<cid>", methods:["all"], tools:["all"]}]`、
  `group_mappings=["wire-cust-<cid>"]`（Logto 每客户也建一个组/或在
  patch key 铸造时把该组快照进 key 的 groups）。缺点：Logto 组管理面
  要跟开（M2M /api/v2 曾 404，Admin Console UI 可用）。
- **B：`_server_names_match` 支持前缀通配**（`fd-wire-cell-*`）+ 别的机制
  挡跨客户（每客户 still 需要 per-customer 边界，前缀通配只解决「放行
  家族」，**单靠它不够**——放行了所有人的 cell）。需与 per-customer
  判定组合（如 `server_access` 支持 `"server_prefix": "fd-wire-cell-"`
  且校验请求 server 名后缀 == 调用者 username/customer_id）。实现点在
  auth_server/server.py:2184 与 scope repo。
- **C：virtual server 独立入口**：每客户发一个 virtual server
  （`virtual_servers_default` 先例：lex-legal 有
  `allowed_groups=["mcp-lex-execute","mcp-law-bench-execute"]`），cell
  作为其 backend。看 virtual 路径是否已把 group 门禁接到 /validate——
  **session 需先实证这一点**（我们只查到 virtual 文档有 allowed_groups
  字段，没验证调用面是否真门禁）。

### 验收判据

- [ ] 客户身份 A（wire-customers 组 + 其 cell 存在）经入口
      `initialize` → 200；调 `fd-wire-cell-<B 的>` → 403/404；
      目录 `GET /api/servers` 看不见 B 的 cell。
- [ ] cell-manager provision 一个新 cell 后，**无需任何手工 scope/组改动**，
      新客户的 key 即可调通自己的 cell（全自动闭环延续）。
- [ ] 平台服务凭据（wire-platform-service）不受影响（admin 组全通）。

### 交付状态（2026-10-08 复验：通过）

采纳了方案 A（per-customer scope）。生产实态：

- `mcp-wire-cell-drillcust001` scope 已建
  （`groups=["wire-cust-drillcust001"]`，
  `server_access=[{server:"fd-wire-cell-drillcust001",...}]`）
- 客户 key（代铸，groups 双组 `wire-customers` + `wire-cust-<cid>`）
  实弹：本企业 cell 200 / 共享业务面 200 / 别家 cell 不可达 /
  平台内部 server 403；
  **目录恰见 2 条**（自己的 cell + 共享业务面），无别家条目——
  「互不可见、互不可调」成立。
- 遗留小偏差：跨企业路径返回 **405**（nginx 无该 location → 控制台兜底）
  而非 403；对外文档写的是 403，需一致化（见下节 R1a）。

---

## R2【P0】预检硬停的调用者映射（现在对 99% 客户不生效）

### 现状

auth-server preflight（`auth_server/preflight_quota.py`）strict 模式已开
（`.env`: `PREFLIGHT_ENABLED=true`, `PREFLIGHT_MODE=strict`），但余额探针
的调用者映射是手工 env：`SUB2API_CALLER_MAP={"8tajhoprelg0": "56",
"lexdemocustomer": "56"}`——**只映射了两个身份**。`_resolve_target`
（preflight_quota.py:250）对**不在 map 里的调用者直接 skip→pass**（设计如此，
fail-open）。即：**除了这两个测试身份，任何客户（包括未来的付费客户）经
入口调用完全不受余额预检约束**——额度耗尽照常调用，wire 的 402 硬停
（wire-platform-v1 4.4）形同虚设。

### 期望行为

新客户开户（Logto wire-customers 组 + 铸 key）后，其入口调用自动受
sub2api 余额预检约束；映射关系随开户自动建立，不靠手工改 `.env`。

### 建议方案方向

- **A（推荐）：映射落 Mongo + 开户联动**。preflight 读
  `sub2api_caller_map` 集合（username → sub2api user id / `key:` 前缀），
  cell-manager 或 wire api 的开户流程写入；`.env` 的 `SUB2API_CALLER_MAP`
  保留为覆盖层（或退役）。注意 preflight 现有 `_caller_map` 是 env memo
  （preflight_quota.py:204），要加集合读取与短 TTL 缓存。
- **B：sub2api 用户名直查**。preflight 直接按 `sub`（= username）查
  sub2api 用户目录（wire 平台已按身份代建账户），免映射——需确认 sub2api
  admin API 有按用户名查询端点。

### 验收判据

- [ ] 新映射客户（余额>0）调用放行；余额耗尽客户调用 → 402
      INSUFFICIENT_BALANCE（且 wire 侧结算一致）。
- [ ] 未映射客户（新开户漏配）的行为明确：要么 fail-closed（推荐，
      加 `PREFLIGHT_UNMAPPED=deny` 开关），要么至少告警——**现状是静默
      放行，必须改**。

### 交付状态（2026-10-08 复验：通过，且已收口为 deny）

采纳了方案 A（Mongo 集合 `sub2api_caller_map` + admin API
`PUT/GET/DELETE /api/sub2api-caller-map`），并新增
`PREFLIGHT_UNMAPPED=pass|warn|deny` 开关。

本 session 复验 + 收口：

- 交付后生产默认仍是 `pass`（未映射放行）；本 session 已切 **`deny`**
  并重载 auth-server（备份 `.env.bak-unmapped-20261008`；prebuilt 形态用
  `docker compose -f docker-compose.prebuilt.yml up -d auth-server
  --no-deps --no-build`）
- 实弹：摘掉 drillcust001 映射 → 真实客户 key 调共享面
  **402 CALLER_NOT_MAPPED**（带中文说明「未完成计费开户映射」）；
  恢复映射后 cell/共享面均回 200（TTL 30-60s 内生效）
- admin 语义（平台服务凭据）豁免直通不受 deny 影响——符合双轨设计
- 调用顺序正确：scope 授权先于计费判定（403 不会被 402 掩盖）

---

## R3【P1】客户凭据自助铸造与吊销（免人工 ceremony）

### 现状

- patch key 铸造 `POST /api/patch-keys` 已可用（无浏览器通道：自签短命
  JWT → 铸造 API，配方已落 `fd-wire/docs/service-credentials.md` 2.1 节），
  但铸造身份是**调用者本人**——平台管理员替客户铸造时，key 的 groups
  快照取的是**管理员**的组（mcp-registry-admin），**没有 per-customer
  限定**：现在客户 key 若由管理员代铸，key 与管理员同权（能看见全部
  server）。
- 客户自助铸 key 需要控制台会话（浏览器 OAuth2 登录）。wire 控制台
  尚无「API keys」页（wire 侧 backlog）。

### 期望行为

客户 key 的权限恰为该客户应得的（business-mcp + 自己的 cell），铸造/
吊销不需要管理员手工操作；最好客户在 wire 控制台自助。

### 建议方案方向

1. **铸 key 时支持指定 groups**：`POST /api/patch-keys` 加可选 body 字段
   （仅 admin 可用，如 `groups: ["wire-customers"]` 或 per-customer 组），
   mint_key 快照指定的组而非调用者组（patch_key_service.mint_key 现有
   `groups` 参数来自调用者 ctx，server_routes.py:77-83）。
2. wire api 侧把「铸造客户 key」接进开户流程（调 registry 新通道），客户
   key 明文经安全信道给客户。

### 验收判据

- [ ] 能以平台服务身份铸出一把「groups=wire-cust-<cid>」的客户 key，
      该 key 只能看见/调用 business-mcp + 自己的 cell。
- [ ] 吊销即时（`DELETE /api/patch-keys/{key_id}` 已有，验证即可）。

---

## R4【P1】metering 归集面：registry Mongo 直读的稳定性

### 现状（信息同步，非急缺）

wire api 的计量入账驱动（`fd-wire/api/fd_wire_api/metering/driver.py`，
ecosystem-bridge 3.1）按 `REGISTRY_MONGO_URI` 直读 registry 的
`audit_events_default` 集合（300s 轮询）。**该 Secret 键当前为空**——
驱动 poll 段自动跳过（HTTP 推送路径喂同表，目前由其他会话验证）。接客后
计量靠这条链入账本，需要确认。

### 期望

决定一个正式口径：a) 配 `REGISTRY_MONGO_URI`（从 cheap-1 mongo 凭据生成
只读账号 + `mongodb://<user>:<pass>@<host>:27017/mcp_registry?authSource=admin`
——注意 mongo 端口只绑 cheap-1 本机/内网，需要经 k8s 可达路径，可能要走
NodePort 或 tailscale IP）或 b) registry 侧加 HTTP 推送（audit 流 → wire
internal endpoint）。**session 里拍板并落地**。

### 验收判据

- [ ] 一次真实客户调用后 10 分钟内，wire 的 `metering_records` 出现对应行
      （来源标注正确）。

---

## 附：已解决、不需要动的（防重复劳动）

- **patch key 通道已可用**：`PATCH_KEY_AUTH_ENABLED` 默认开；无浏览器铸造
  配方在 fd-wire/docs/service-credentials.md；`/api/servers/toggle` 接受
  patch key（`/api/toggle/<path>` 不接受——那是 enhanced_auth 会话专用）。
- **控制台注册默认 disabled**：cell-manager 已带 register→toggle 启用步
  （fd-wire 30ba42d），registry 侧无需改。
- **SSRF 白名单**：`.env` 的 `SSRF_ALLOWED_CIDRS` 已合并为
  `100.64.0.0/10,192.168.32.0/20` 单行（10-07 曾因重复行 last-wins 覆盖丢
  mesh 网段）；`EGRESS_REGISTRY_INTERNAL_URL=http://registry:8080` 已修正。
  别动这两行。
- **cn 镜像重建**：dbf213e 已含（apt/gitee/ghfast.top 三镜像持久化 +
  OPTIONS preflight 双模板变体）。

## 附：环境事实速查

- registry 栈：cheap-1 `/opt/mcp-gateway-registry`（compose），registry
  app=127.0.0.1:7860（nginx 8080 唯一对外 7860 路径 =
  `/_egress_internal/egress-token`）、auth-server:8888、mongo
  `mcp-mongodb`（root 凭据在容器 env `MONGO_INITDB_ROOT_*`）。
- 审计/计费数据：`mcp_registry` 库，`audit_events_default`（TTL 7 天
  ——**R4 若选直读要考虑 TTL 窗口**，300s 轮询足够）、`mcp_scopes_default`
  （scope 文档）、`mcp_servers_default`（server 条目）、
  `virtual_servers_default`（虚拟入口）。
- 平台服务凭据：`wire-platform-service`（两把 wgk-，明文 cheap-1
  `/opt/cell-manager/secrets/`，0600）。
- cell 条目约定：`fd-wire-cell-<customer_id>`（cell-manager
  `CELL_NAME_PREFIX`）；演练 cell `fd-wire-cell-drillcust001` 在跑（可作
  R1 验收对象）。
- 提交纪律：registry 改动走 gitee 分支（当前 `fd-backend-auth-fallback`），
  cheap-1 /opt 是 ff 部署；重建镜像参考 dbf213e 的 CN 镜像配方；compose
  操作 `docker compose up -d --no-deps --no-build`（alpine 依赖镜像国内
  拉不到，禁 --build）。

---

## R1a【P2】跨企业路径的错误码一致化（新增，复验发现）

### 现状

客户 key 请求一个**不存在/未授权**的 cell 路径（如
`/fd-wire-cell-cust999/mcp`）→ **405 Method Not Allowed**
（nginx 无该 server 的 location，落到控制台兜底路由 `location /`，
FastAPI 对 POST /mcp 无该方法）。而对外文档
`docs/customer-onboarding-integration.md` 第 4 节承诺的是 **403**。

### 期望

跨企业（或不存在）的 cell 路径返回 403（授权语义），不要返回 405
（路由语义）——agent 侧按文档把 403 当「越权/写错路径」，405 会被误判为
「端点不支持」从而重试。

### 方案方向

registry 生成的 per-server location 之外，加一条通配/默认 MCP 前缀路由
（`/fd-wire-cell-*`）返回 403，或让控制台兜底对 `/mcp` 后缀路径返回 403。
注意不要影响 business-mcp 等既有条目的路由。

### 验收判据

- [ ] 客户 key 请求别家 cell 路径 → 403（且 body 带授权语义说明）
- [ ] 本企业 cell 与共享业务面仍 200；未注册路径的控制台其他路由不受影响
