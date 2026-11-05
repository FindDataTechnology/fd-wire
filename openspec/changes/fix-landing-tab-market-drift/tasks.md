# 任务：修落地页签值域漂移

## 1. api

- [x] 1.1 `LANDING_TABS` 补 `market`（十一页签）+ 注释指向可执行对拍
- [x] 1.2 `test_landing_tab_domain_cycle` 改从枚举导入 + market 回归锚
- [x] 1.3 新增 `test_landing_tab_lockstep.py`（web ConsoleTab ↔ api 枚举同集断言）

## 2. web

- [x] 2.1 页签写回失败显式提示条（state + catch + banner，fire-and-forget 保留）
- [x] 2.2 i18n zh/en 新键 `console.prefs.tabWriteFailed`
- [x] 2.3 两用例：422 → 提示条在场；成功 → 无提示条且 market PUT 被接受

## 3. spec 与验证

- [x] 3.1 personal-preferences delta（存储模型值域/读写契约口径/同步语义显式提示）
- [x] 3.2 api pytest（preferences + lockstep）过；web vitest（ConsoleView）过
- [x] 3.3 `openspec validate fix-landing-tab-market-drift --strict` 过
