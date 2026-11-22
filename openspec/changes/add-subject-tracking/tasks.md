# Tasks

## 1. subjects slice 骨架与模型

- [x] 1.1 新建 `api/fd_wire_api/subjects/`（`__init__.py`/`db.py`/`models.py`/`service.py`/`routes.py`/`schemas.py`），`Subject`（id/customer_id/kind/ref_json/title/description/created_at/updated_at）与 `SubjectChannel`（id/subject_id/type/spec_json/滞后容忍）。验证：`alembic`/建表脚本在测试库建出两表，`python -c "import fd_wire_api.subjects.models"` 通过。
- [x] 1.2 `ref_json` 与 `spec_json` 的形状校验（kind 词表、ref.source 词表、通道必备参数），非法 422 定位到字段零半写。验证：单测覆盖非法 kind、缺 ref、非法通道 spec 三类 422。

## 2. 通道投影器（5 个，纯适配 + 可注入 client）

- [x] 2.1 `indicators` projector：经 `NativeMcpClient` 调 business-mcp `indicator_series_read`，返回统一形状。验证：注入假 MCP client 单测，断言命中与 `unavailable` 两态。
- [x] 2.2 `announcements` projector：经 fd-info `InfoClient.list_since(source_codes=[...])`（复用 `artifacts/info_contract.py` 的 client），撞 `sources_lack_entity_attribution` 时给 `unavailable`+原因。验证：假 client 单测三态。
- [x] 2.3 `registry` projector：经 business-mcp `ia35_company_search`（credit_code 优先）。验证：假 client 单测命中/无匹配/`domain_unavailable`。
- [x] 2.4 `graph` projector：经 business-mcp `graph_search`（`belongs_to` 展开成分/上下游，deep=1）。验证：假 client 单测返回节点/边并按 day 归一。
- [x] 2.5 `context` projector：经 business-mcp 取行业/国家背景指标序列。验证：假 client 单测。
- [x] 2.6 投影器失败隔离：一个 projector 抛错不影响其余，读面照常返回其余通道。验证：把其中一个 client 设为抛错，断言其余通道 `ok`、该通道 `unavailable`。

## 3. 实时读面与时间轴

- [x] 3.1 `service.read(subject)` 扇出全部通道、逐个 try 包裹，合并 `timeline`（按 date DESC，事件带 `channel`+`ref`）。验证：单测断言 timeline 跨两类通道按日期有序、每条带来源。
- [x] 3.2 `GET /api/v1/subjects/{id}/read` 路由：客户隔离（他企 404）、只读零副作用。验证：路由单测 + 隔离用例。

## 4. 物化为客户数据集

- [x] 4.1 `service.snapshot(subject)`：读结果扁平化成时间轴行，登记 `source_kind="subject"`、`source_ref=subject_id`、**显式 `storage_tier=TIER_API`**；幂等（查既有更新行不新建）；行数/存储闸；失败回滚零半写。验证：单测断言同主体两次快照只一个数据集、行集重建、超闸整批拒绝。
- [x] 4.2 `POST /api/v1/subjects/{id}/snapshot` 路由。验证：路由单测，返回 dataset_id 与行数。
- [x] 4.3 快照进既有面的冒烟：用快照 dataset_id 建一条 `alert_rule` 与一条 dashboard `panel.query`，确认走既有执行路径无需特化（api 档 query 走 api_store）。验证：集成单测断言 alert 评估与 panel 刷新对快照集出一行。

## 5. 刷新调度第三类目标

- [x] 5.1 `refresh_schedules.target_type` 词表加 `subject`；`service._validate_target` 认 subject；间隔地板 60 分钟。验证：单测建 subject 调度成功、非 subject/dataset/artifact 类型被拒。
- [x] 5.2 `executor.execute_subject` 调 `subjects.service.snapshot`（手动/定时同实现）；主体删除抛 `TargetGone` 触发清理。验证：单测断言到点物化、主体删除自动移除调度行。

## 6. workbench 与 MCP 工具面

- [x] 6.1 `workbench.py` 加 subjects section（总数/按 kind 计数/最近列表，客户隔离）。验证：workbench 单测断言七段返回、空态、隔离。
- [x] 6.2 `wire-ops-mcp/wire_ops_mcp/tools_console.py` 加 `wire_subject_create/list/get/read/snapshot/archive` + `wire_subject_channels`；`tool-surface.json` 同步（工具数断言）。验证：`surface_report` 工具数断言绿；单测各工具转发正确。

## 7. 集成校验

- [x] 7.1 端到端（本地/测试环境）：声明一个 `company` 主体（stock_code=600519）→ 加 announcements+indicators 通道 → `read` 返回两通道且 timeline 有序 → `snapshot` 出数据集 → 建 alert 与 panel 各一 → 触发调度到点重跑一致。验证：一条 e2e 脚本/测试全绿。
- [x] 7.2 降级演练：拔掉 fd-info（或 Change 1 未上产），announcements 通道 `unavailable`、其余通道照常、整体读不失败。验证：集成单测模拟上游缺位。

## Workflow follow-up

- 归档前需 Change 1 `add-info-entity-filter` 先 archive（announcements 通道依赖）。
- 上产后留一条真库查询与一次 MCP 实调结果在 PR/报告。
