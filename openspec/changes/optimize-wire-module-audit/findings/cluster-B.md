# 簇 B 体检卡 — 数据面/目录/数据集/实体（14 模块）

体检日 2026-11-05，fd-wire HEAD=5b782f2（git 显示 b3798ad 之后的 openspec 归档移动）。镜像 sha-1c5dfc5（deploy/k8s/fd-wire-api.yaml:46）经 `git merge-base --is-ancestor 1c5dfc5 HEAD` 确认为 HEAD 父提交链内，部署态新鲜（HEAD 相对部署镜像仅多 openspec 归档移动 5b782f2）。评级口径：A=对齐且无痛感/低剪刀差；B=有缺口或痛感集中；C=显著缺口；D=失配。

---

## 1. wire-data-plane（R 根）— A
五项齐备，无近期修复痛感；参考 BFF 已在仓交付。
- ① 对齐：key 铸/吊/校验 `api/fd_wire_api/data_plane/service.py:45,70,98`；allowlist 越界 403 `data_plane/auth.py:100`；查询上限 1000 行 `data_plane/data_routes.py:76`；批量写 ≤1000 op 单事务原子 `data_routes.py:97,352-393`；后台只读视图 `data_plane/routes.py:75-138`；平台数据显式拒绝 `routes.py:6`；参考 BFF 实物 `/Users/chengsishi/finddata/fd-wire/bff-reference/server.js`。无 CORS 中间件（grep app.py 零命中）=spec「不开放 CORS」成立。
- ② 测试：`api/tests/test_data_plane.py`（2026-10-13）、`test_data_plane_window.py`（2026-10-31）在场。
- ③ 部署态：sha-1c5dfc5 为 HEAD 祖先（merge-base 命令输出：IS ancestor）。
- ④ 痛感：`git log --oneline --since=2026-09-05 -- api/fd_wire_api/data_plane` 8 条全为 feat，零 fix。
- ⑤ 陈旧：spec mtime 2026-10-10 vs 代码 2026-10-31（e27b9ef），差 21 天 <30，不 stale；新增能力（join/filter/project）归属 transform-pipeline 等 W 根 spec，非 shadow。

## 2. wire-storage-postgres（W 根）— A
PG 配方、备份、双 URL、双方言层全在场，cutover 后稳定。
- ① 对齐：双 URL `deploy/k8s/fd-wire-api.yaml:118,226`；配方钉版/shm512m `deploy/wire-postgres/docker-compose.yml:6,21`；备份 `deploy/wire-postgres/backup.sh` + README:48；对账不过即止手册 `deploy/wire-postgres/CUTOVER-2026-10-11.md`；双方言层 `api/fd_wire_api/dbcompat.py:1-30`（strftime/to_char、count FILTER、JSON 抽象）。
- ② 测试：`tests/test_pg_dialect_smoke.py`（2026-10-11）、`test_storage_config.py` 在场。
- ③ 部署态：同上，两 env 名在活 yaml 中。
- ④ 痛感：`--since=2026-09-05 -- deploy/wire-postgres` 零 fix（最后一次 6f4f1ae 2026-10-12 为文档/脚本收尾）。
- ⑤ 陈旧：spec 2026-10-11 vs 代码 2026-10-12，差 1 天。

## 3. wire-indicator-catalog（R 根）— B
公开目录面在仓对齐良好，但两条 Requirement 的实现主体在上游 business-mcp，本仓不可证实，且 spec 自记一条已知缺陷。
- ① 对齐：镜像同步 `api/fd_wire_api/catalog/sync.py:110`（scheduler.py:59-88 周期循环）；公开搜索/详情/stats `catalog/routes.py:62,81,93`；indicator_id=source_db:native_code 见 sync 落库与 `tests/test_datasets_indicator.py:18`（yearbook_catalog:39709）；法律域转介 `web/src/catalog/legal.ts:9-13`（lex.finddatatech.cloud + 前缀枚举）；DAAS 条目 `web/src/catalog/daas.ts`。**缺口**：verified 无联邦通道回落本地概念（spec:37-39，spec 自记「已知缺陷…并不成立」）与 yearbook 多区域 entity_required（spec:146-162）的实现主体在 business-mcp `indicator_series_read`（`api/fd_wire_api/datasets/indicator_fetch.py:3-28` 仅拉数对接，grep `entity_required|province_codes|no_read_channel` 本仓零命中）——未证实，属上游仓。
- ② 测试：test_catalog_* 6 文件全在（api/sync/readonly/common/client_mcp 2026-10-05~06，migrations 2026-11-05）。
- ③ 部署态：同簇基线，新鲜。
- ④ 痛感：catalog 目录 `--since=2026-09-05` 5 条全 feat，零 fix；但 spec.md:39 在案缺陷依赖上游修复。
- ⑤ 陈旧：spec mtime 2026-10-22 vs 镜像代码 2026-10-11，spec 反而新 11 天（yearbook 段为上游行为补记）。

## 4. catalog-governance（W 根）— A
小而完整：分页、只读镜像、append-only 意见三条全部有据。
- ① 对齐：镜像分页列表 `api/fd_wire_api/admin/routes.py:547`（catalog/pending）；意见追加 `admin/routes.py:602`、查询 `:643`；append-only 独立表 `admin/models.py:21`（catalog_review_notes）。
- ② 测试：`tests/test_admin_api.py` 在场（admin 面），未见独立 test_catalog_governance 文件——由 test_admin_api 承载（未证实其分页用例覆盖度）。
- ③ 部署态：同簇基线。
- ④ 痛感：admin 目录近期 8 条中 0 fix 涉目录治理（02998ee 2026-10-20 为治理分页 feat）。
- ⑤ 陈旧：spec 2026-10-20 vs admin 代码 2026-10-20，差 0 天。

## 5. indicator-to-dataset（W 根）— A
verified 建集全链在仓，错误语义逐条可指。
- ① 对齐：上游拉数 `api/fd_wire_api/datasets/indicator_fetch.py:101-129`（502 语义 :113）；建集入口 `datasets/routes.py:640-684`（409 幂等 :672-673，422 registered/范围上限 `indicator_fetch.py:76-96`）；source_kind="indicator" 落库。
- ② 测试：`tests/test_datasets_indicator.py`（2026-10-25，含 409/422/400 用例 :140-164）。
- ③ 部署态：同簇基线。
- ④ 痛感：`ce8e93a fix(datasets): indicator 注册事件 subject 补 key`（2026-10-25）1 条 fix，低。
- ⑤ 陈旧：spec 2026-10-25 vs 代码 2026-10-25，差 0 天。

## 6. wire-customer-datasets（R 根）— A-
11 条 Requirement 的平台侧实现全部有据；近期仅 1 条 fix；spec 落后代码 20 天（新增能力各自有 spec，非 shadow）。
- ① 对齐：上传 `datasets/uploads.py`；连接器 `datasets/connector_routes.py:607`；修正层 `datasets/models.py:221-251`（dangling :231、reverted_at :251）+ `data_plane/data_routes.py:352`（data-key 通道）；增量水位 `datasets/models.py:128-131`（watermark_column/value 文本存储）+ `test_datasets_incremental_sync.py`；存储配额 `datasets/service.py:156-187`；声明式建集/加列 `data_routes.py:395,513`；派生 `data_routes.py:513-570`；哈希登记 sha256 `service.py:56`。
- ② 测试：test_datasets_* 9 文件在场（common/corrections/uploads/connectors/incremental/indicator/migrations/rest_source/sync，2026-10-07~11-05）。
- ③ 部署态：同簇基线。
- ④ 痛感：datasets 目录 21 条 commit 仅 1 fix（ce8e93a），痛感低。
- ⑤ 陈旧：spec mtime 2026-10-11 vs 代码 2026-10-31（87d03bf），差 20 天 <30；ACL 新增归属 W 根 team-spaces（archive 2026-10-31-wire-dataset-acl），非 shadow。

## 7. dataset-export（W 根）— A
- ① 对齐：`GET /api/v1/datasets/{id}/export` `api/fd_wire_api/datasets/routes.py:1459`；截断头 `routes.py:1497`（X-Export-Truncated）；cell 分页循环 `_export_cell_rows` :1407-1414；模块头注释 :16-18 与 spec 逐条对应。
- ② 测试：`tests/test_dataset_export.py`（2026-10-11）。
- ③ 部署态：同簇基线。
- ④ 痛感：零 fix。
- ⑤ 陈旧：spec 2026-10-11 vs export 代码 2026-10-11（aa7e751），差 0 天。Purpose 仍是「TBD - created by archiving…」未回填（文档债，非能力缺口）。

## 8. dataset-form-editing（W 根）— A
- ① 对齐：三修正端点 `datasets/routes.py:1147,1299,1339`（corrections/list/revert）；api 档本地覆盖层 `datasets/api_store.py:605-774`（dangling :700-774）；有效视图统一由 api_store 合并逻辑承载；web 编辑器 `web/src/console/DatasetDetail.tsx`（未逐行证实脏队列提示——未证实）。
- ② 测试：`test_datasets_corrections.py`（2026-10-07）、`test_local_corrections.py`（2026-10-11）。
- ③ 部署态：同簇基线。
- ④ 痛感：零 fix（corrections 近史 58c6539 为实施 feat）。
- ⑤ 陈旧：spec 2026-10-11 vs 代码 2026-10-07~11，差 0 天。Purpose 未回填同上。

## 9. record-view（W 根）— A
- ① 对齐：公开端点 `api/fd_wire_api/share/routes.py:687`；限流 240/h+Retry-After `share/rate_limit.py:37-39,116`；60 秒短缓存 `share/routes.py:36`；spec 校验体 `artifacts/record_view_spec.py`；运行时组装 `artifacts/record_view_runtime.py`；构建器 web `web/src/console/recordview/RecordViewEditor.tsx`。
- ② 测试：`tests/test_record_view.py`（2026-10-15）、`web/src/console/recordview/recordViewSpec.test.ts`。
- ③ 部署态：同簇基线。
- ④ 痛感：share/artifacts 近史 66e1ac0、458822f（2026-10-27）均为 feat，零 fix。
- ⑤ 陈旧：spec 2026-10-15 vs 代码 2026-10-27，差 12 天。

## 10. wire-dataset-link（R 根）— B+
wire 侧对接面、血缘与物化端点在仓；引擎侧实现（cell engine）在本仓外，本卡按「对接面+测试」给据。
- ① 对齐：工具常量 `api/fd_wire_api/datasets/ingest.py:67`（TOOL_LINK="customer_dataset_link"）；一键物化端点 `entities/routes.py:528-542`；血缘/重放经 materialization specs（未逐行）——引擎侧 LEFT JOIN/junction 展开本体在 cell engine 仓（commit 913024c 注明「引擎侧 internal-main 2d11efe」），本仓未证实。
- ② 测试：`tests/test_entities_link.py`（2026-10-31）、`test_datasets_common.py`。
- ③ 部署态：同簇基线。
- ④ 痛感：link 相关 fix 为 entities 面 dict 行解析双修复（见模块 14），link 本体零 fix。
- ⑤ 陈旧：spec 2026-10-13 vs 对接代码 2026-10-31，差 18 天 <30。

## 11. wire-dataset-quality（R 根）— A-
快照指标集、触发时机、平台不直读三条在仓有据；引擎计算体在仓外。
- ① 对齐：引擎调用 `api/fd_wire_api/quality/service.py:54`（TOOL_QUALITY="customer_dataset_quality"，只收聚合 :7）；自动触发三时机——创建后 `datasets/routes.py:634`、同步后 `datasets/connector_routes.py:607`（notify_dataset_changed `quality/service.py:385`）；手动刷新端点 `quality/routes.py:99`；白名单净化器与引擎 payload 对齐（service.py 头注）。
- ② 测试：`tests/test_dataset_quality.py`（2026-10-13）。
- ③ 部署态：同簇基线。
- ④ 痛感：quality 目录零 fix（87d03bf 为 ACL/window feat 顺带）。
- ⑤ 陈旧：spec 2026-10-13 vs 代码 2026-10-31，差 18 天 <30。

## 12. wire-quality-rules（R 根）— A
封闭枚举、编译闸、count_only、pandera 批量、诚实降级全部在仓。
- ① 对齐：规则 CRUD/run/历史 `quality/routes.py:168,207,255,289,315,352`；封闭枚举+正则编译闸（嵌套量词 `quality/rules.py:83 _PATTERN_NESTED_QUANT`、长度校验 :210）；count_only 结构化 filter（:297-302「平台只见计数，红线 2」）；内容代经 `customer_dataset_check`（TOOL_CHECK :71）+ 分批（:651）；旧镜像诚实 error（:450）；key_uniqueness 复用快照（:364）。
- ② 测试：`tests/test_quality_rules.py`（2026-10-14，v2 落地同批 fdd4458）。
- ③ 部署态：同簇基线。
- ④ 痛感：quality 目录零 fix。
- ⑤ 陈旧：spec 2026-10-14 vs rules 代码 2026-10-14（fdd4458），差 0 天；目录后续 feat 落后 17 天但属他 spec。注：spec 内「每数据集 ≤20 条/owner-editor 可写」两行重复出现（spec:32-36）——排版瑕疵。

## 13. wire-provenance-ledger（R 根）— A
账本、封存锚定、双后端、导出、自检全链在仓，7 个测试文件。
- ① 对齐：信封 `provenance/envelope.py`；追加账本 `provenance/ledger.py`；周期封存 `provenance/sealing.py`（app.py:90 启动循环）；锚定双后端 `provenance/anchors.py:134`（CustomerBackend 自持检查点）+ `:303`（OtsBackend 公链）；转发重试 `provenance/forwarder.py`；导出核验 `provenance/export.py`；每日自检 `provenance/selfcheck.py`（app.py:91）。
- ② 测试：test_provenance_{ledger,sealing,export,forwarder,selfcheck,routes,e2e_private}.py 7 文件（2026-10-07~10-10）。
- ③ 部署态：同簇基线。
- ④ 痛感：1 fix（51cab59 2026-10-09「overview/status 锚定进度由最新回执推导——回填账本核心留的占位」），低。
- ⑤ 陈旧：spec 2026-10-07 vs 代码 2026-10-09，差 2 天。

## 14. entity-layer（W 根）— B
spec/代码最新鲜（当日归档 add-entity-bench-contract，迁移 0050），但也是全簇痛感最高点：5 天内 4 条 fix，含一次生产实锤缺陷与一次误扫半成品的双修复。
- ① 对齐：实体/关系 CRUD+图谱 `entities/routes.py:220-431`；m:n 物化 `routes.py:528-542`；对象浏览三端点 `routes.py:766,848,908`；属性元数据+袋键 `entities/service.py:143-175`；本体事件流/版本 `entities/versioning.py`（迁移 0049）；机器只读通道 `entities/internal.py:1-12`；tier/sensitivity 一等字段迁移 `alembic/versions/20261105_0050_entity_tier_sensitivity.py`。
- ② 测试：8 文件在场且极新——test_entities.py、test_entity_bench_contract.py（2026-11-05）、test_entities_link.py、test_entity_objects.py（2026-10-31）、test_entity_write_surface*.py（2026-10-31）、test_ontology_versioning.py（2026-11-05）。
- ③ 部署态：镜像 sha-1c5dfc5 恰含袋键修复（b3798ad「bag-key validation fix live」），部署态为全簇最新。
- ④ 痛感：**高**。`--since=2026-09-05`：1c5dfc5 fix 袋键绕过列快照校验（live e2e 实锤，生产缺陷）；5975db1+50a986c 同一 dict 行解析缺陷修两次（50a986c 自述「前提交 5975db1 误扫入并发会话未提交的 entities/console 半成品已由本提交剔除」——流程痛感）；442dd59 fix 对象面 ACL 闸回归；ed287e7 生产冒烟抓裸数组漂移。
- ⑤ 陈旧：spec 2026-11-05 vs 代码 2026-11-05，差 0 天（当夜随 add-entity-bench-contract 归档刷新）。

---

## 簇摘要 — 最严重三件事

1. **entity-layer 近 5 天 4 条 fix、含一次双修复事故**（5975db1→50a986c，首次修复误扫入并发会话未提交半成品；另有 442dd59 ACL 闸回归、1c5dfc5 `_bench` 袋键绕过列快照校验的生产缺陷）。能力面在快速扩张（本体 v2/写面/机器通道/bench 合同），fix 密度与「修复自身引入回归」模式表明该域处于高变动不稳定期，建议接下来 1-2 周冻结非必要扩展、补并发会话纪律。
2. **wire-indicator-catalog 两条 Requirement 的实现主体在上游 business-mcp，本仓审计盲区**：verified 无通道回落本地概念（spec.md:37-39，spec 自己在案「已知缺陷…并不成立」）与 yearbook 多区域 entity_required（spec.md:146-162）；grep `entity_required|province_codes|no_read_channel` 于 fd-wire 零命中，仅 `datasets/indicator_fetch.py:3-28` 拉数对接。需要对上游仓做同等体检才能闭环。
3. **跨仓引擎契约只靠 fixture 对锁**：wire-dataset-link、wire-dataset-quality、wire-quality-rules 的引擎半边（customer_dataset_link/quality/check 工具）在 cell engine 仓（913024c 注明 internal-main 2d11efe），fd-wire 侧仅有工具常量+调用+白名单净化器；契约漂移风险由 `test_datasets_indicator.py` 等双侧锁定 fixture 缓解，但引擎仓不在本次体检范围——建议纳入下轮簇外体检。

（其余：dataset-export/dataset-form-editing 两本 W 根 spec 的 Purpose 仍为「TBD」占位——文档债两处，非能力问题。）

## O5 重叠裁决建议（目录三 spec：wire-indicator-catalog(R) vs catalog-governance(W)+indicator-to-dataset(W)）

证据链：
- 同一镜像只读纪律被两本 spec 各写一遍：R wire-indicator-catalog/spec.md:17-19（「平台侧不可篡改镜像：仅同步管道可写」）vs W catalog-governance/spec.md:28-38（「镜像状态平台侧不可改」+「状态变更经同步反映」）；每日同步口径同样两见（R spec.md:11-15 / W spec.md:36-38）。实现同源（镜像写路径唯一在 `api/fd_wire_api/catalog/sync.py:110`，admin/routes.py 无镜像写端点——grep governance/mirror-write 零写入口）。
- registered 不伪装可直读/需求单导流也是两见：R spec.md:35,41-47 vs W indicator-to-dataset/spec.md:19-22（「registered 拒建集并导流」）。实现同点：`datasets/routes.py:640-684`（422 导流）+ `web/src/catalog/`。
- 差异面真实存在：catalog-governance 的 append-only 审核意见（admin/models.py:21）是 R spec 完全没有的独立能力；indicator-to-dataset 的建集生命周期（409 幂等/502 上游/配额）是独立于目录呈现面的写行为。
建议（供拍板，不改 spec）：三本不必合并成一，但应**确立单一属主 + 去重**——(a) wire-indicator-catalog(R) 定为目录权威 spec（镜像写路径、状态分级、导流语义的属主）；(b) catalog-governance(W) 保留为「内部治理面」附属 spec，删去与 R 重复的「镜像只读/每日同步」两条 Requirement（或改为引用），只保留审核意见这一独有要求；(c) indicator-to-dataset(W) 保留独立，但在 registered/verified 语义处加一句「状态语义属主=wire-indicator-catalog」交叉引用，避免两处口径漂移。若嫌三本管理成本高，最小收敛方案是把 catalog-governance 并入 wire-indicator-catalog 作一条「内部治理面」Requirement，indicator-to-dataset 独立不动。
