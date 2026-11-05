## REMOVED Requirements

### Requirement: 镜像状态平台侧不可改

**移除理由**：与 finddata 根 `wire-indicator-catalog`「Requirement: 注册目录为权威镜像」重复记账（体检 O5 证据：R spec.md:11-19 已含「每日同步反映」与「仅同步管道可写，控制台与后台均无直接编辑镜像的入口」；实现同源 `api/fd_wire_api/catalog/sync.py:110`，admin 侧无镜像写端点）。该纪律属主为 R 根，治理面不再重复记账——本面按其属主口径继续只读呈现，行为零变化。

## MODIFIED Requirements

### Requirement: 重复指标建集 SHALL 幂等拒绝并指路

同一客户对同一指标已存在活跃数据集时再次建集 SHALL 返回 409，响应携带既有数据集标识；SHALL NOT 自动覆盖、自动刷新或静默建第二集。指标状态语义（verified/registered 及其导流规则）属主为 finddata 根 `wire-indicator-catalog`——本面消费其状态语义落地建集门槛，MUST NOT 另立状态口径。

#### Scenario: 重复建集返回既有数据集
- **WHEN** 客户对已有数据集的指标再次提交相同建集
- **THEN** 返回 409，detail 携带既有数据集 key
- **AND** 不新建数据集、不改动既有数据集内容
