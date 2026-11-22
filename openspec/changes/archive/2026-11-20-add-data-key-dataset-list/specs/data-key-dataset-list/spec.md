# data-key-dataset-list Specification（delta）

## Purpose

让持有数据面 key（`wdk-`）的机器身份能够枚举自己客户名下的数据集——补齐「双轨凭据」在列表面的缺口，使无浏览器会话的岗位（本体建设舰队的盘账岗等）拿得到数据集清单，而不是被迫回到交互式登录。凭据边界不扩大：仍是同一把客户级 key，只是把它的可读范围从「点子数据集」补到「列出本客户数据集」。

## ADDED Requirements

### Requirement: 列表接受双轨凭据

`GET /api/v1/datasets` SHALL 接受两种凭据：console 会话（Logto ID token）与数据面 key（`Authorization: Bearer wdk-…`）。key 轨道的验签、吊销与限流 SHALL 复用数据面既有实现（`require_data_plane_principal`），SHALL NOT 另写一份验签逻辑。

#### Scenario: key 轨道列出本客户数据集
- **WHEN** 以某客户的 active 数据面 key 请求数据集列表
- **THEN** 返回该客户名下的数据集，不含其他客户任何数据集

#### Scenario: console 轨道零漂移
- **WHEN** 以 console 会话请求数据集列表
- **THEN** 行为与改动前完全一致（含受限数据集按成员授权过滤）

### Requirement: key 轨道受 allowlist 约束

key 的 `allowlist_json` 非空时，列表 SHALL 只返回其列出的数据集；为空时 SHALL 返回本客户全部数据集。列表 SHALL NOT 因 `acl_mode=restricted` 隐藏数据集（key 不承载成员身份，与数据面授权边界 D6 一致）。

#### Scenario: 非空 allowlist 收窄
- **WHEN** key 的 allowlist 只列数据集 A，客户另有 B
- **THEN** 列表只含 A；直接读 B 仍走数据面既有 403 语义（不受本次改动影响）

### Requirement: 凭据错误如实区分

无凭据或坏凭据 SHALL 返回 401 且语义可读（SHALL NOT 伪装成 200 空列表）；已吊销 key SHALL 返回 401 并指明已吊销。

#### Scenario: 空列表不等于无凭据
- **WHEN** 请求未带任何 Bearer
- **THEN** 返回 401，而非 200 空数组

### Requirement: 行读面接受双轨凭据

`GET /api/v1/datasets/{id}/rows` SHALL 与列表面同源接受两种凭据：console 会话与数据面 key（`Authorization: Bearer wdk-…`）。key 轨道的验签、吊销与限流 SHALL 复用 `require_data_plane_principal`（经 `require_dataset_actor_dual`），SHALL NOT 另写一份验签逻辑。既有只读面（query/aggregate）本就只挂数据面 principal，行读面补齐后三个只读端点口径一致。

#### Scenario: key 轨道读本客户数据集的行
- **WHEN** 以某客户 active 数据面 key 读取本客户某数据集的行
- **THEN** 返回该数据集的行页（`rows` 字段），不触达引擎的成员维度判定

#### Scenario: key 轨道越出允许清单
- **WHEN** key 的 `allowlist_json` 非空且不含目标数据集
- **THEN** 返回 403 并指明「允许清单不含 <id>」，SHALL NOT 返回 404 或空行集

#### Scenario: console 轨道零漂移
- **WHEN** 以 console 会话读取行
- **THEN** 行为与改动前完全一致（restricted 数据集仍按成员授权判定）

#### Scenario: 无凭据
- **WHEN** 请求未带任何凭据
- **THEN** 返回 401，SHALL NOT 返回空行集
