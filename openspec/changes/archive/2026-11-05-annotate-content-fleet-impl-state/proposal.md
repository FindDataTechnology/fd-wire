# 给 wire-content-fleet 悬空 Requirement 加实现态注记（annotate-content-fleet-impl-state）

## Why

体检 backlog P1-10（openspec/changes/optimize-wire-module-audit/findings/cluster-F.md 第 4 节 + 簇摘要#3）：wire-content-fleet 评级 C——spec 的舰队核心机制在 fd-wire 仓库内无实现（packs 模块 grep 零 fleet 引用；fleet 编排本体在壹座/paas 侧且跨仓验证未证实），同域配置漂移已咬过生产（bcf57e3 AI_CELL_ENDPOINT_MAP）。spec 现状「半在册」：读者易把未落地条目误读为已交付的在产契约。

本次在 fd-wire 仓内逐条实查（grep api/ web/ 及全仓代码，非转抄体检结论）后，对确认无实现入口的 Requirement 追加实现态注记，声明其在落地前 SHALL NOT 视为在产契约；有实现落点的条目不动。

## What Changes

- **spec（W 根 wire-content-fleet）**：对以下 4 条 Requirement 以 MODIFIED delta 在正文末尾追加一行实现态注记（不改动原正文与任何 Scenario）：
  1. 「产物生产型 pack SHALL 声明其构建服务」——全仓代码 grep `mcpServers`/`pack-server-closure` 零命中（仅 openspec 文档提及）；pack manifest 机制不在 fd-wire，校验器属 R-root 跨账引用（体检 O9 已核验）。
  2. 「pack MAY 内嵌 fleet 段作为舰队模板」——`api/fd_wire_api/packs/` 为 source-packs 语义（definitions.py 静态 filter、service.py 订阅），无 pack 安装/fleet 段实例化入口；全仓 `fleet` 命中仅为 source_ref 生产来源指针（artifacts/models.py:123、schemas.py:56/81，D6 已在产）与 demand fleet-puller 文案。
  3. 「舰队节奏 SHALL 由信号驱动」——fd-wire 无任何舰队回合/岗位节奏机制（grep 岗位/回合 仅命中 source_ref 文档串、ai/loop.py 的 AI 对话回合、domain_actions 的壹座归因注释）。
  4. 「产品内容自进化 SHALL 止于人工门」——全仓 grep `自进化`/`check_presets`/`技能稿` 零命中；证据校验器（check_presets.py）不在本仓；wire-action-gate 的人工门覆盖实体声明域，不覆盖内容自进化。
- **明确不标注（有实现落点，实查证据）**：
  - 「同一 pack 支持内部与外部两种安装上下文」——产物契约共用一路：artifacts/service.py:90 `validate_kind_spec` 按 kind 分派校验；客户 cell 接线 datasets/ingest.py:8（AI_CELL_ENDPOINT_MAP 显式 customer→cell 映射）。
  - 「凭据轨决定计量归属」——双凭据边界在产：materialization/runner.py:3-17（物化携客户凭据→客户计量；AI 探索轨固定平台凭据；缺客户凭据 fail-closed，runner.py:58 `STATUS_FAILED_NO_CREDENTIAL`）、metering/models.py:41（credential_track 列）、materialization/quota.py:97（客户配额按 credential_track='customer'）。舰队回合本体在壹座侧，但其 SHALL 遵循的「既有双凭据计量归属判定」正是本仓在产机制。
  - 「周期物化归刷新调度，舰队不得重复」——refresh-scheduler 在产：schedules/service.py:9-11（间隔地板 dataset≥60/artifact≥360 分钟 + 每客户调度配额，与 requirement 括号内「含间隔地板与客户配额」逐字对应）、app.py:97-156（lifespan 起停）、schedules/executor.py:14（与 materialization.runner 同链）。舰队侧「重复节奏被拒」因舰队不在本仓而无对象，但 requirement 的委托半边已由本仓承担，不属悬空。
- **不改任何代码**——纯 spec 注记任务（体检 P1-10）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `wire-content-fleet`: 4 条无 fd-wire 实现入口的 Requirement 各追加一行实现态注记（MODIFIED delta，全文复制原块，Scenario 零丢失）。

## Impact

- 仅 `openspec/specs/wire-content-fleet/spec.md`（经 archive 合入）与本 change 目录；零代码、零测试改动。
- 注记声明「落地前 SHALL NOT 视为在产契约；实现落地时由后续 change 移除本注记」——为后续 fleet 落地 change 预留明确的摘除动作。
