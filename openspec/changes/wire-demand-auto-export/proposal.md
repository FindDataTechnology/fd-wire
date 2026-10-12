# Proposal: wire-demand-auto-export — 受理即自动出单（方向 C 触发自动化）

## Why

ROADMAP 方向 C 的定论是：**中间段编排已在役**（工单 YAML→舰队拉取→萬星生成
→PR→回流→时间线，DE-20261011-99 生产全链实证过），**纯手工的只剩「触发出单」
这一步**。此前它等两个前置：合规门（已落：禁爬清单双闸 + 公开数据声明硬勾 +
源地址形态校验）与萬星凭据（已被拉取架构消解：wire 零外部凭据）。前置齐了，
最后一个手工环节——操作员受理后手动点「转生成工单」——现在可以自动化。

收益：客户提单 → 操作员受理（submitted→in_progress）即自动出单入拉取队列，
「客户提单到 agent 开工」之间零人工点击；出单失败（slug 占用/无源地址/禁爬
复检）如实留痕，操作员在进度面看到失败原因再人工处置——自动化与人工兜底
并存，绝不静默。

## What Changes

1. **受理钩子自动出单**（api）：`submitted→in_progress` 迁移成功后补调
   `export_workorder_service` 自动出单——与 delivered 补调 `maybe_auto_deliver`
   同款钩子纪律（失败绝不打断迁移响应）。**两个迁移面同步接**：内部端点
   `POST /internal/demands/{id}/transition` 与管理台
   `POST /internal/admin/demands/{id}/transition`（上一轮的教训：管理台漏钩子
   是真缺陷，本次从设计上双面同语义）。
2. **出单失败留痕**（api）：自动出单被拒（无源地址 422 / slug 占用 409 /
   禁爬复检 409）时落 `auto_export_failed` pipeline 事件（reason + status_code
   如实留档），迁移照常成功；成功则走既有 `workorder_exported` 留档——
   语义与人工出单逐字一致，事件多一个 `trigger: "auto"` 标注（人工出单
   不带此键，历史零漂移）。
3. **补扫循环**（api）：lifespan 后台 tick（照 workorder_sync 范式），定期
   扫描「in_progress 且无任何 workorder_exported 留档」的单补出单——兜住
   钩子执行失败（进程崩溃/瞬时异常）的漏网；已出单的单绝不重出（幂等）。
   `DEMAND_AUTO_EXPORT_ENABLED=false` 可关。
4. **进度面呈现自动失败**（web+api）：admin 进度面新增 `auto_export_failed`
   阶段渲染（含失败原因），操作员可见「自动出单被拒→需人工处置」；未出单
   占位逻辑不变。
5. **操作员出单入口保留**：`WorkorderSection` 人工「转生成工单」不动——
   自动失败后操作员仍可人工重试（如换 slug override）。

### 边界（显式不做）

- 不自动做「受理」动作本身（submitted→in_progress 仍是操作员动作——受理=
  人工合规审查点，本 change 只消掉受理之后的点击）；
- 不自动流转 delivered（既有 spec 红线：终态交付由操作员执行，不变）；
- 不做存量 in_progress 单的一次性补扫迁移（补扫循环天然覆盖，无迁移）；
- 不改工单 YAML 契约/slug 探测/脱敏红线（复用 `export_workorder_service`
  逐字语义）。

## Impact

api：`demands/auto_export.py`（新模块：钩子+补扫循环+事件常量）、
`demands/routes.py` + `admin/routes.py`（transition 后补调钩子）、
`app.py`（lifespan 挂补扫循环）、测试新增；web：admin DemandsPage 进度面
加一阶段+i18n 双语；零迁移（无表变更）；发布 api+web 滚版；引擎/cell 零改动。
