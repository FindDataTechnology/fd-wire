# 本体版本（ontology versioning）

本体（实体 + 关系）是客户域最核心的语义资产。本文说清**版本语义、写面纪律、导出格式
与两条恢复线**——机制实现在 `api/fd_wire_api/entities/`（`versioning.py` / `snapshots.py`
/ `service.py`），端点挂在 `/api/v1/ontology/*`，控制台在实体页「版本区」。

## 一、版本语义

| 概念 | 定义 |
|---|---|
| **进一版（版本号）** | 打一份**快照**：版本号 = 客户内 max+1（从 1 起） |
| **未发布变更** | 最近快照之后落下的**事件条数**（不是 net diff 条数） |
| **事件** | 每一次本体写一条 append-only 记录（create/update/delete + before/after 全量） |
| **digest** | 规范 manifest 的 sha256，既是版本指纹也是导出物完整性校验值 |

**这两件事不要混**：

- 「进一版」不是「每次改都进一版」——版本是**发布决策**（日快照=时间线，手动版=发布点）；
- 两次改同一条实体 = 2 条未发布变更，但 diff（当前 vs 最近快照）只显示 1 条净改动。
  计数口径以事件流为准，diff 口径以净变化为准，两者都对，问的问题不同。

### 快照何时产生

- **日快照**：每日 `ONTOLOGY_SNAPSHOT_HOUR_UTC`（默认 `03:30` UTC，与既有 `pg_dump`
  同刻）。当日该客户无新事件 → **静默跳过**（不产生一串相同 digest 的噪声）；
  当日已有日版 → 跳过（每客户每天至多一份日版）。**存量客户首次出的是基线 v1**
  （manifest = 那一刻的当前态；系统不虚构启用前的历史事件）。
- **手动发布版**：owner（或任一非 viewer 成员）随时可打，可带 label（≤80 字）。
  同日已有日版仍照打——语义不同：日版是时间线，手动版是发布决策。
- **同 digest 不重复落**：当前态与最近快照内容一致时不新增版本，接口如实回
  「与 vN 内容一致」（`unchanged: true`）。所以「回滚到 v2 再打版」通常拿回的
  就是 v2 本身，而不是 v3。
- **无本体不出快照**：客户没有任何实体与关系时不落空快照（手动版 422 如实）。

### 保留

- 手动版：永久。
- 日版：最近 `ONTOLOGY_SNAPSHOT_DAILY_KEEP` 份（默认 30）。
- 事件：永久（本体变更量级小，留作完整审计）。

## 二、写面纪律（硬约定）

**本体的唯一写入口是 `api/fd_wire_api/entities/service.py`。**

三条写路径全部经此收口，且都在**同一数据库事务**内追加事件：

| 路径 | via | actor |
|---|---|---|
| 控制台 CRUD（`/api/v1/entities`） | `console` | 调用成员 sub |
| 动作闸执行器（内置 `entity-declare` / `entity-relation-declare`） | `action_gate` | `domain-action:{type}:{instance}`，并带 `source_ref` / `source_instance_id` |
| 回滚执行器（`POST /api/v1/ontology/versions/{n}/rollback`） | `rollback` | owner sub |

事件写失败 = 本体写失败（不吞异常）——不存在「本体变了但没有事件」的窗口。

### 绕过 service 的直改（裸 SQL）

**禁止用于常规运维；这类改动不进事件流。** 后果与兜底：

- 事件折叠回放看不到它 → `GET /api/v1/ontology/integrity` 会报「当前态与事件流不一致」
  并指出差异条目（这是唯一落地检测手段）；
- 真要改只能靠库级备份恢复（见下文「四条恢复线」之 2）。

事故运维确需直改时，改完**应立即打一份手动发布版**并把事实写入变更记录——快照会把
新状态收进版本历史，完整性自检的基线也随之推进（基线 = 最早快照；见下）。

### 完整性自检的基线口径

`integrity` 比对的是「事件折叠结果」与「当前态」：

- 有快照：基线 = **最早那份快照**的 manifest（= 机制启用时刻的当前态），只折叠它
  `created_at` 之后的事件——启用前存量不当变更双算；
- 无快照：从空基线折叠全部事件。
- 任一方向的不一致都会列在 `differences`（`entities` / `relationships` 的
  added/removed/changed 三组）。

## 三、导出格式

`GET /api/v1/ontology/export?version=current|<n>&format=json|yaml&provenance=true|false`

```json
{
  "schema_version": 1,
  "exported_at": "2026-11-01T10:00:00",
  "customer_id": "cust-x",
  "version": "current",
  "digest": "<sha256 hex>",
  "entities": [
    {"id": 1, "name": "订单", "dataset_id": "…", "pk_columns": ["order_id"],
     "description": null, "display_column": "order_id", "column_notes": null}
  ],
  "relationships": [
    {"id": 3, "from_entity_id": 1, "from_column": "customer_id",
     "to_entity_id": 2, "to_column": "customer_id", "kind": "n:1",
     "declared_kind": null, "label": "下单客户",
     "junction_dataset_id": null, "junction_source_column": null,
     "junction_target_column": null}
  ]
}
```

- `schema_version` 是**格式版本单一真源**（`versioning.SCHEMA_VERSION`）；后续不兼容
  变更必须递增，消费方据此分支。
- `digest` 只覆盖内容（`entities` + `relationships` 的规范形态），**不含**
  `exported_at` / `version` / `customer_id`——同一内容在任何时刻导出 digest 恒一致，
  可与快照行直接对账。
- 关系条是**存储方向**（`1:n` 声明已归一化为反向 `n:1`，`declared_kind: "1:n"`
  记录声明方向）；消费方按 `declared_kind ?? kind` 呈现声明方向。
- `provenance=true` 时，每条实体/关系附最近一次 create/update 事件的 `source_ref`
  （舰队血缘）。**无经闸血缘的条目不写这个键**（不是空串）——键缺席即「最后一次
  变更不是经闸来的」。
- 导出是纯读：不触发本体写入或快照创建。跨企业版本与不存在版本一律 404。

## 四、diff 与回滚

- **diff**：`GET /api/v1/ontology/versions/{n}/diff?against=current|<m>`
  —— base=该版本，target=`current` 或另一版本。输出实体/关系三组（added / removed /
  changed，changed 带字段级 `before → after`）。「当前 vs 最近快照」=
  `/versions/{latest}/diff?against=current`。
- **回滚预览**：`POST /api/v1/ontology/versions/{n}/rollback/plan`（只读计算）。
- **回滚执行**：`POST /api/v1/ontology/versions/{n}/rollback`（**owner-only**）。

回滚**不是**直接覆盖表，而是「按 plan 再写一遍」：删关系 → 删实体 → 改实体 → 建实体 →
建关系，每步经 service 并落 `via=rollback` 事件。因此：

- 历史只增不减，**回滚本身可再回滚**；
- 回滚执行前逐条重走既有校验器（业务名唯一、主键列 ⊆ 列快照、目标列 ∈ 目标实体主键），
  任一失败**如实停**（422 带已执行条目），已执行部分留事件、可再回滚修正；
- 建实体/关系时**沿用 manifest 的 id**（digest 才能与目标版本对齐）；极端情形下 id 被
  占用会退回自增，响应 `identity_changed` 如实记录，此时 `digest_match` 为 false。

## 五、四条恢复线（别混）

| 场景 | 用什么 | 粒度 | 覆盖范围 |
|---|---|---|---|
| 想回到某个**语义版本** | 回滚（`/rollback`）或导出物重灌 | 本体语义（实体/关系） | 只覆盖本体；数据集/产物/计费不动 |
| 库损坏 / 误删一切 | `pg_dump` 每日 03:30 UTC（保留 14 天） | 整库二进制 | 全库；恢复到某个时间点 |
| 要看「谁在什么时候改了什么」 | 事件流（`ontology_events`，永久） | 字段级 before/after | 只覆盖经 service 的写；裸 SQL 不在内 |
| 要检测「有没有人绕过写面」 | 完整性自检（`GET /integrity`） | 差异条目 | 同上（这正是它的用处） |

**语义版本不能替代 pg_dump**（版本机制只懂本体，不懂数据行与其它表）；
**pg_dump 也不能替代语义版本**（它给不了「这版和上版差了什么」与「回滚到 v2」）。

## 六、端点速查

| 方法 | 路径 | 身份 | 说明 |
|---|---|---|---|
| GET | `/api/v1/ontology/versions` | console | 时间线（倒序）+ 未发布变更计数 |
| POST | `/api/v1/ontology/versions` | console（非 viewer） | 打发布版（body `{label?}`） |
| GET | `/api/v1/ontology/versions/{n}/diff` | console | `?against=current\|<m>` |
| GET | `/api/v1/ontology/export` | console | `?version=current\|<n>&format=json\|yaml&provenance=` |
| POST | `/api/v1/ontology/versions/{n}/rollback/plan` | console | 回滚预览（不执行） |
| POST | `/api/v1/ontology/versions/{n}/rollback` | **owner** | 执行回滚 |
| GET | `/api/v1/ontology/integrity` | console | 逃逸写自检 |

事件表**没有任何改/删端点**——append-only，只读与追加。

## 七、环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `ONTOLOGY_SNAPSHOT_ENABLED` | `1` | 日快照循环开关（`0`/`false` 关） |
| `ONTOLOGY_SNAPSHOT_HOUR_UTC` | `03:30` | 日快照时刻（UTC，`HH:MM`） |
| `ONTOLOGY_SNAPSHOT_DAILY_KEEP` | `30` | 日版保留份数（手动版永久） |
