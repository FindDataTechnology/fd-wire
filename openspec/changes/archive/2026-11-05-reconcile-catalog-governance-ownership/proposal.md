# 治理面/建集面归属去重（reconcile-catalog-governance-ownership）

## Why

体检 P1-6（O5）姊妹单（R 根属主声明已由 finddata 根 `clarify-catalog-ownership` 归档落地）：W 根 `catalog-governance` 的「镜像状态平台侧不可改」（含「经每日同步反映」）与 R 根 `wire-indicator-catalog`「注册目录为权威镜像」（平台侧不可篡改镜像+每日同步，spec.md:11-19）重复记账，实现同源（镜像写路径唯一在 `api/fd_wire_api/catalog/sync.py:110`，admin 侧 grep 无镜像写端点）；W 根 `indicator-to-dataset` 的 registered 拒建集导流与 R 侧状态语义两见（实现同点 `datasets/routes.py:640-684`）。

**与体检 backlog 措辞的偏差（如实记）**：簇 B 建议写「删两条只留审核意见」，但其证据链只坐实「镜像状态平台侧不可改」一条与 R 重复——「镜像列表 SHALL 分页返回」是后台独有契约（R 侧无对应物，公开搜索分页不覆盖后台治理列表），删之会失去真实契约覆盖。故本单只移除证据坐实的一条，分页与审核意见保留。

## What Changes

- 移除 `catalog-governance`「Requirement: 镜像状态平台侧不可改」——镜像只读/每日同步纪律属主=R 根「注册目录为权威镜像」，治理面不再重复记账。
- 保留「镜像列表 SHALL 分页返回」（后台独有契约，上限对齐公开目录的引用保留）与「审核意见 SHALL append-only 留档」（治理面独有能力）。
- `indicator-to-dataset`「重复指标建集 SHALL 幂等拒绝并指路」增状态语义属主交叉引用句（verified/registered 语义属主=R 根 wire-indicator-catalog），Requirements 行为不变。
- 非目标：不动 R 根；不改代码。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无——catalog-governance 为 REMOVED（一条退役）+保留条不动；indicator-to-dataset 的交叉引用句走 REMOVED+ADDED 同文？不走：为最小 delta，用 MODIFIED）

- `catalog-governance`: 移除镜像只读/每日同步重复 Requirement（其余两条不动）。
- `indicator-to-dataset`: 「重复指标建集 SHALL 幂等拒绝并指路」增状态语义属主交叉引用句。

## Impact

- **代码**：零改动（治理面本就无镜像写端点，纯 spec 对账）。
- **下游**：目录域主从关系=R 根属主（镜像/状态/导流语义）+治理面（分页/审核意见）+建集面（建集生命周期）；体检 backlog P1-6 销账。
