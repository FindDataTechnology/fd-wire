# Tasks

## 1. api（自动出单核心）

- [ ] 1.1 `demands/auto_export.py` 新模块：`auto_export_after_accept(db, demand)`
      钩子（in_progress 才动作；调 `export_workorder_service`；成功事件已由
      service 落档，仅补 `trigger=auto` 标注——在钩子层把标注写回末条导出
      事件；被拒落 `auto_export_failed`（reason/status_code）；意外异常兜住
      落 `auto_export_failed` 不抛出）+ `EVENT_AUTO_EXPORT_FAILED` 常量
- [ ] 1.2 补扫循环：`sweep_missing_exports(db)`（in_progress 且无任何出单
      尝试留档〔无 workorder_exported 且无 auto_export_failed〕的单逐单
      调钩子逻辑；失败单不重试防刷屏）+ `start_auto_export_sweeper`
      / `stop_auto_export_sweeper`（照 orchestration_sync 的 tick 范式：
      async 循环、to_thread、异常只记日志；`DEMAND_AUTO_EXPORT_ENABLED`
      缺省开、`DEMAND_AUTO_EXPORT_INTERVAL_SECONDS` 缺省 300）
- [ ] 1.3 接线：`demands/routes.py` 内部端点 transition（in_progress 分支）+
      `admin/routes.py` 管理台 transition（同分支）补调钩子；`app.py` lifespan
      挂补扫循环启动/停止
- [ ] 1.4 测试 `api/tests/test_demand_auto_export.py`：
      受理即出单（trigger=auto 标注+入 pending）/ 无源地址拒留痕（迁移成功）/
      slug 占用拒留痕 / 钩子意外异常不打断 / 两迁移面 parity / 补扫漏网补出 /
      补扫幂等（已出单零新事件）/ 关闭开关零动作 / 非 in_progress 迁移不触发出单
- [ ] 1.5 既有测试回归修正（transition 响应现在多出单事件——受影响用例逐个
      核对，非回归即更新预期）

## 2. web（进度面）

- [ ] 2.1 `admin/DemandsPage.tsx`：PROGRESS_STAGES 增 `auto_export_failed`
      （红色圆点）；`workorder_exported` 事件 trigger=auto 时渲染自动标注；
      「尚未出单」占位判定改为「无任何导出与失败事件」
- [ ] 2.2 i18n 双语（zh/en）：`progress.stages.auto_export_failed`、
      `progress.autoTrigger` 标注、失败原因呈现（reason 字段）
- [ ] 2.3 测试：失败阶段渲染+原因、自动标注渲染、占位语义（有失败即不占位）、
      既有进度面用例零回归

## 3. 门禁与发布

- [ ] 3.1 api pytest 全量绿 + web vitest 全绿 + tsc 零错
- [ ] 3.2 reconcile：逐条对 spec delta 核对实现（含边界：非 in_progress 零
      动作、补扫幂等、关闭开关）
- [ ] 3.3 发布：快照→CI→relay→滚版（api+web；零迁移）
- [ ] 3.4 生产冒烟：真单受理验自动出单（pipeline_events 见 trigger=auto+
      pending 端点可见）+ 无源地址单受理验 auto_export_failed 留痕 +
      管理台进度面渲染
- [ ] 3.5 归档+ROADMAP（方向 C 触发自动化落地上产标注）/记忆更新
