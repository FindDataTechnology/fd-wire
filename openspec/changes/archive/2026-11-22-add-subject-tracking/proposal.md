# Proposal

## Why

柏讯今天能「查一次」，不能「追踪一个东西」。查一次 = `ai_search` 找指标 → `indicator_series_read` 拉数 → dashboard 出图；追踪一个东西 = 定义「我要持续盯住茅台 / 这条产业链 / 这个国家」，把它的多条信号通道（指标、公告、工商登记、关系网）挂在一起，看最新 + 覆盖状态，定期刷新、越线告警。

缺口是中间那一层「追踪主体」对象。今天它的缺失在每个 kind 上形状不同，且都有实测依据：

- **企业资讯**：`fd-info` 信息流是唯一带 `entities` 归属字段的源，可直接用（Change 1 `add-info-entity-filter` 补齐 cninfo 0% 填充率 + 加主体过滤）。
- **企业工商登记**：business-mcp 的 `ia35_company_search`（信用代码精确查 / 企业名前缀）已存在，wire 从未调用过。
- **行业 / 产业链**：`fd_open_data.entity_relationships` 已铺 `belongs_to` 5,202 条（stock→申万 L1），business-mcp 的 `graph_search`（bfs/ego/shortest_path）已存在，wire 从未调用过。
- **国家 / 地区**：`country` 56、`region` 60 实体 + wb/gta 指标标识齐全。

每条通道都是一个已存在的工具。缺的是「声明一个主体 + 绑定若干通道 + 一次扇出读全」。

## What Changes

- **新增追踪主体对象**（fd-wire 一等对象，客户/团队隔离）：`Subject {kind, ref, channels[], title, description}`；`kind ∈ {company, industry, chain, country, region}`。
- **新增 5 个通道投影器**（全部走已存在端点，零新数据路径）：
  - `indicators` → business-mcp `indicator_series_read`
  - `announcements` → fd-info `list_since(source_codes=[...])`（依赖 Change 1）
  - `registry` → business-mcp `ia35_company_search`
  - `graph` → business-mcp `graph_search`（展开 `belongs_to` 成分/上下游）
  - `context` → business-mcp `read_series`/`indicator_series_read`（行业或国家级背景指标）
- **新增读面**：`wire_subject_read(id)` 实时扇出所有通道 → 统一形状（每通道带 `coverage` 三态）+ 对齐时间轴 `timeline`。**服务端不做统计推断**（相关性/领先滞后归 pack 层 `chain-transmission` 技能）。
- **新增物化**：`wire_subject_snapshot(id)` 把一次读结果落成客户数据集（`source_kind="subject"`），**由此接入现有面零改动**：`alert_rule` / `refresh_schedule` / dashboard `panel.query` / market 全部直接吃这个数据集。
- **新增刷新**：`refresh_schedule` 新增 `target_type="subject"`——一个 executor 分支，到点重跑 `wire_subject_snapshot`（复用既有 tick 循环，不新建调度器）。
- **workbench 增一段**：subjects 计数 + 最近列表。
- **wire-ops-mcp 增 7 个工具**：`wire_subject_create/list/get/read/snapshot/archive` + `wire_subject_channels`。

## Capabilities

### New Capabilities

- `wire-subject-tracking`: 追踪主体的一等对象契约——kind 词表与 ref 解析、通道投影器的统一形状（含 `coverage` 三态与 `as_of`）、实时读与物化快照、以及「快照即数据集」接入既有告警/刷新/看板/市场面的契约。

### Modified Capabilities

- `personal-workbench`: 「工作台聚合端点」的 section 集合由六段扩为七段（新增 subjects 计数与最近列表）。
- `refresh-scheduler`: 调度目标类型由「派生数据集 / dashboard 产物」扩为第三类「subject」，subject 到点执行物化快照。

## Impact

- `fd-wire/api/fd_wire_api/subjects/`（新 slice）：models / service / routes / projectors（5 个通道）。
- `fd-wire/api/fd_wire_api/app.py`：挂载 subjects router。
- `fd-wire/api/fd_wire_api/schedules/`：`service.py`（目标类型校验）、`executor.py`（`execute_subject` 分支）、`models.py`（target_type 词表）。
- `fd-wire/api/fd_wire_api/workbench.py`：新增 subjects section。
- `fd-wire/api/fd_wire_api/datasets/`：新增 `source_kind="subject"` 的数据集登记（复用 `api_store.ingest` / 既有列快照机制，无引擎依赖）；`service.py` 的 `source_kind` 词表注释更新。
- `wire-ops-mcp/wire_ops_mcp/tools_console.py` + `tool-surface.json`：7 个新工具。
- **依赖**：Change 1 `add-info-entity-filter` 必须先上产（announcements 通道依赖 `list_since(source_codes=...)`；否则该通道如实返回 `unavailable`）。
- **借用契约不变**：business-mcp / fd-info / registry 全经原生 MCP client（`fd_mcp_client` + `NativeMcpClient`），env 可重指，与 `indicator_fetch.py` 同款。
- **不碰**：cell 引擎的 `derive_refresh`（配方住引擎、不认识 fd-info/ia35，故 Subject 快照**不是**引擎派生集，而是 wire-api 侧扇出后落 api 层行存储——见 design D2）；不新增 web 页面（现有 builder/alert/refresh UI 直接吃快照数据集）。
