# 平台服务凭据发放约定（wire-platform-v1 · 8.2 缺口修复 G2）

壹座 / 萬星生态与 wire 平台内部服务要经 **wire 入口**（registry wire 门，
`mcp.finddatatech.cloud`）调用 MCP 工具时，一律持**平台服务凭据**（服务身份的
长命 key）——这类调用在计量上走 `credential_track=platform`（归集不结算），
并按服务身份前缀落到 `source=yizuo / wanxing / platform-internal` 桶
（`GET /api/admin/usage/overview` 双维可查）。本文约定这类身份怎么命名、
发放、轮换，以及发放后必须回填 wire 集群的联动步骤。

与客户凭据（per-customer 长命 key，计费到客户账单）互斥：客户身份**不得**
进入下述平台名单；两轨凭据在 cell 内的注入机制见文末。

## 1. 服务身份命名规范：`<line>-<service>`

| 前缀 | 归属 | 示例 |
|---|---|---|
| `yizuo-` | 壹座生态服务 | `yizuo-market`（壹座市场）、`yizuo-agent-01`（壹座 agent 池） |
| `wanxing-` | 萬星生态服务 | `wanxing-fleet`（萬星调度） |
| `platform-` | wire 平台内部 | `platform-agent`（wire AI 探索，即 api 侧 `AI_PLATFORM_CREDENTIAL` 的身份） |

规则：

- 形态 `<line>-<service>`，全小写、`[a-z0-9-]`；`<service>` 用途语义化（服务名 / agent 池编号）。
- **前缀即计量来源**：`PLATFORM_IDENTITY_SOURCE_MAP` 按前缀通配归桶
  （`yizuo-*=yizuo,wanxing-*=wanxing,platform-agent=platform-internal`），
  新增生态线 = 新前缀 + 映射条目，不改代码。
- 一个服务一个身份：不共用、不复用客户身份；服务下线即吊销并从名单摘除。

## 2. 发放通道（v1：registry 控制台 UI）

registry（mcp-gateway-registry fork，cheap-1 compose，基址
`https://mcp.finddatatech.cloud`）的 wire 门只认 header 凭据：
`Authorization: Bearer <per-user 长命 key>`（auth_server `/validate` 子请求
校验；不支持 URL query 传 key）。

发放步骤：

1. 管理员在 registry 控制台以 OAuth2 流登入，为服务建用户 / 选用既有服务账号，
   username 按第 1 节规范（如 `yizuo-market`）。
2. 控制台 `POST /api/tokens/generate`（UI 表单）铸 key：**JWT**（默认 8h、
   上限 7d，到期需人工重铸）或 **PAT 长命 key**（服务形态推荐）。
   ——控制台操作细节见 `cell-manager/README.md`「registry 真实 API」节。
3. **patch-key 通道**（`registry/api/patch_key_routes.py`，机器友好的
   铸造/吊销 API）**未部署在 cheap-1**——v1 一律控制台 UI 人工铸造，
   不假设 patch-key 存在；其上线后服务身份优先切 patch-key 并更新本文。
4. 台账登记：`~/finddata/secrets` 记录（服务名、username、key 形态、铸造
   日期、到期、责任人、用途）；**凭据明文永不入 git**。

## 3. 轮换流程

- **JWT（≤7d）**：到期前在控制台重铸 → 先把新 key 配到消费端（生态侧
  env）→ 打一次 wire 入口验证 → 控制台吊销旧 token。建议运维日历提醒
  （同 `CELL_REGISTRY_TOKEN` 重铸纪律）。
- **PAT（建议 90d 周期）**：铸新 key → 消费端切换 → 吊销旧 key；吊销前
  确认 `usage/overview` 已无旧 key 的在途调用。
- **username 不变时**，wire 集群侧 Secret **无需改动**——轨道判定按
  username 名单（`platform_identities`），不按 key 值；只有身份新增 /
  摘除才触发第 4 节回填。

## 4. 发放后回填 wire 集群（联动步骤，缺一步计量归属就错）

1. **追加 `platform_identities`**（Secret `fd-wire-env`，cheap 集群 fd-prod
   命名空间）：逗号分隔 username 名单，把新身份追加进去：

   ```bash
   kubectl --context cheap -n fd-prod create secret generic fd-wire-env \
     --from-literal=platform_identities='platform-agent,yizuo-market,yizuo-agent-01' \
     ...（其余 13 键原样重申，键清单见 deploy/README.md 键名表） \
     --dry-run=client -o yaml | kubectl apply -f -
   ```

   **名单不可留空**：空名单 = 一切调用判 customer 轨，壹座/萬星调用会错落
   客户账单（结算 SQL 硬过滤 `credential_track=customer`，错轨即错结算）。
2. **维护来源映射**（区分壹座 / 萬星 / 平台内部）：
   - `metering_source_map`（customer 轨 server → 来源，已在 Secret 键清单内）
     与本节无关，勿动。
   - `PLATFORM_IDENTITY_SOURCE_MAP`（platform 轨「身份前缀 → 来源」，
     api 侧已支持）按前缀通配维护
     `yizuo-*=yizuo,wanxing-*=wanxing,platform-agent=platform-internal`。
     **注意**：该 env 尚未接入 `deploy/k8s/fd-wire-api.yaml`（见
     deploy/README.md 键名表附注）——接入 manifest 前维持
     `platform-internal` 合桶，接入时同步 Secret 键与本表。
3. **滚动生效**：回填后重启 / 滚动 `fd-wire-api`（env 经 secretKeyRef 注入）。
4. **验证**：用新凭据打一次 wire 入口工具调用，然后
   `GET /api/admin/usage/overview?credential_track=platform`（或
   `GET /internal/metering/usage?credential_track=platform`，后者需
   `METERING_INGEST_TOKEN`）——应出现该 username，且 source 落在对应桶
   （映射接入前为 `platform-internal`）。
5. 台账登记回填完成（谁、何时、改了哪些键）。

## 5. cell 内双轨凭据（发放物的另一处消费）

cell（企业隔离单元）内的回环代理 `wire_auth_proxy`（见
`cell-image/wire_auth_proxy.py`）按路径路由双轨：`/mcp` →
`WIRE_CUSTOMER_KEY`（客户轨）、`/mcp-platform` → `WIRE_PLATFORM_KEY`
（平台轨；未设 503 fail-closed）。这两个 key 由 cell-manager provision
时从 `CELL_CUSTOMER_CREDENTIAL_MAP` / `CELL_PLATFORM_CREDENTIAL` 注入——
**生产必须配置，未配置则对应轨道 fail-closed**（机制与注意见
`cell-manager/README.md`「配置」节）。平台轨 key 同样按本文第 2 节在
registry 铸造（platform- 前缀身份）。
