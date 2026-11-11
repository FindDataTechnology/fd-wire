# Tasks — add-data-key-dataset-list

## 1. 实现

- [x] 1.1 `datasets/routes.py`：新增双轨 actor 依赖（key 轨道复用 `require_data_plane_principal`；console 轨道沿用 `require_dataset_actor` 原路径）
- [x] 1.2 `list_datasets` 接受该依赖；key 轨道按 `allowlist` 过滤、不套成员 ACL；console 轨道行为不变
- [x] 1.3 401 语义：无凭据/坏凭据/已吊销均如实（不返回空数组）

## 2. 测试

- [x] 2.1 key 轨道：只回本客户数据集
- [x] 2.2 key 轨道：非空 allowlist 收窄
- [x] 2.3 key 轨道：restricted 数据集不被隐藏（D6 边界）
- [x] 2.4 console 轨道回归：restricted 仍按成员授权过滤
- [x] 2.5 无凭据 → 401（不是 200 空列表）

## 3. 出片与验收

- [x] 3.1 `openspec validate add-data-key-dataset-list --strict` 通过
- [x] 3.2 单测全绿（本 change 相关文件）
- [ ] 3.3 出片 fd-wire-api 新 sha → 回填 tag → 线上实测：`wdk-` 打 `GET /api/v1/datasets` 返回本客户数据集
- [ ] 3.4 端到端：本体舰队盘账岗回合 `datasets_profiled` 从 0 抬起

## 4. 行读面补双轨（rows）

- [x] 4.1 `preview_rows` 改挂 `require_dataset_actor_dual`；key 轨道按 allowlist 收窄（`_require_key_allows`），console 轨道零漂移
- [x] 4.2 单测：key 读本客户行 200 / allowlist 越界 403（文案含「允许清单」）/ 空 allowlist 全量 / console 零漂移 / 无凭据 401（5 条，`tests/test_dataset_list_data_key.py`）
- [ ] 4.3 出片 fd-wire-api 新 sha → 线上实测：`wdk-` 打 `GET /api/v1/datasets/{id}/rows` 200，`wire_dataset_rows` 不再 401
- [ ] 4.4 端到端：盘账岗下一回合真取到列快照与逐列证据（`datasets_profiled` > 0）
