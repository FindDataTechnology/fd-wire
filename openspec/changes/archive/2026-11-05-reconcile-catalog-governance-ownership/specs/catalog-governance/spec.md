## REMOVED Requirements

### Requirement: 镜像状态平台侧不可改

**移除理由**：与 finddata 根 `wire-indicator-catalog`「Requirement: 注册目录为权威镜像」重复记账（体检 O5 证据：R spec.md:11-19 已含「每日同步反映」与「仅同步管道可写，控制台与后台均无直接编辑镜像的入口」；实现同源 `api/fd_wire_api/catalog/sync.py:110`，admin 侧无镜像写端点）。该纪律属主为 R 根，治理面不再重复记账——本面按其属主口径继续只读呈现，行为零变化。
