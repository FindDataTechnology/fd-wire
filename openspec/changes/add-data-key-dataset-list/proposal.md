# Proposal: add-data-key-dataset-list

## Why

`wire-ops-mcp` 的 `wire_datasets_list` 文档承诺「双轨凭据（ID token 或 wdk_ key）」，`data_plane` 设计 D6 也明确 `wdk-` 轨道不承载成员身份、不拦数据集级授权；但 `GET /api/v1/datasets` 实际只挂 `require_console_customer_actor`。结果：**持有合法数据面 key 的机器身份能按 id 读单个数据集，却无法枚举自己有哪些数据集**——`401 invalid console token: DecodeError`。

这不是理论缺口：本体建设舰队（`fleet-packs/blueprints/ontology-builder`）的盘账岗第一步就是 `wire_datasets_list`，实测连续 4 轮 401 阻断整条链路（盘账 0 画像 → 建模 0 草案），并如实升级为两条待决。同一形态也命中 `GET /api/v1/market/datasets`（`wire_market_browse` 同样宣称双轨）。

数据面 key 本是为「机器身份无浏览器会话」而造的凭据；让它能写不能列，等于把机器身份逼回交互式登录——而服务账号交互登录正是 `docs/TEST-ACCOUNTS.md` 的红线。

## What Changes

- `GET /api/v1/datasets` 接受数据面 key：`Authorization: Bearer wdk-…` 命中 key 轨道时，以该 key 的 `customer_id` 为客户、按 `allowlist` 过滤返回；console 会话轨道语义零变化。
- 数据集列表对 key 轨道不套成员维度 ACL（与 `can_access_principal` 的 D6 边界一致：key 是客户级凭据，无成员身份可判）。
- 单测覆盖：key 轨道列表只回本客户且受 allowlist 约束；console 轨道行为不变（含 restricted 过滤）。

非目标（本次不动，另行立项）：

- `GET /api/v1/market/datasets` / 市场订阅面同样只认 console——同一形态，但盘账岗不依赖，留作下一个 change。
- 不改 key 铸造/吊销语义，不改 `require_data_plane_principal` 既有分支。

## Capabilities

### New Capabilities

- `data-key-dataset-list`: 数据面 key 的数据集枚举面——双轨凭据、客户边界、allowlist 兜底、console 零漂移。

### Modified Capabilities

<!-- 无：dataset-export / free-tier-data / team-spaces 等既有 spec 语义不变 -->

## Impact

- `api/fd_wire_api/datasets/routes.py`：新增双轨 actor 依赖（key 轨道复用 `require_data_plane_principal`，不复制验签逻辑），列表按 allowlist 过滤。
- `api/tests/`：新增 key 轨道列表用例 + console 轨道回归。
- 出片：`fd-wire-api` 新镜像 + 回填 tag（ArgoCD 自动滚动）。
- 无库结构变更、无凭据面扩大（key 仍是同一把客户级凭据）。
