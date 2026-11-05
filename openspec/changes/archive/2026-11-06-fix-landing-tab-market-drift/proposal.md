# 修落地页签值域漂移（fix-landing-tab-market-drift）

## Why

体检 P1-1（复发型缺陷）：`landing_tab` 值域三层漂移——spec 九页签 ⊂ api `LANDING_TABS` 十值（无 `market`）⊂ web `ConsoleTab` 十一页签（有 `market`）。客户切「数据市场」页签时写回被 422 静默吞（`ConsoleView.tsx:267` catch 空处理），market 永远成不了落地候选；workbench 同型缺陷曾有生产前科（`preferences.py:45` 注释自证），market 属复发。另：写回失败静默无提示，用户无从知道偏好没存上。

## What Changes

- **api**：`LANDING_TABS` 补 `market`（十一页签），注释改为指向可执行对拍。
- **api 测试**：值域环测改从 `LANDING_TABS` 导入（不再手抄清单）；新增 `test_landing_tab_lockstep.py`——读 web `ConsoleTab` 类型字面量与 api 枚举做同集断言，把「冻结对表」变成可执行。
- **web**：页签写回失败从静默 catch 改为用户可见提示条（amber，`console-prefs-tab-sync-error`，双语 i18n），下一次写回成功自动消除；fire-and-forget 语义保留（不阻塞切页签）。
- **web 测试**：切 market 写回 422 → 提示条在场；写回成功 → 无提示条且 PUT landing_tab=market 被接受。
- **spec**（W 根 personal-preferences）：值域改十一页签；422 定位文案口径同步；新增「landing_tab 写回失败 MUST 显式提示」requirement 语义。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `personal-preferences`: 偏好存储模型值域九→十一页签（workbench/market）；读写契约 422 定位口径同步；控制台同步语义增「写回失败显式提示」。

## Impact

- **代码**：`api/fd_wire_api/console/preferences.py`（枚举+注释）、`api/tests/test_preferences.py`、`api/tests/test_landing_tab_lockstep.py`（新）、`web/src/views/ConsoleView.tsx`（提示条）、`web/src/i18n/{zh,en}.ts`（新键）、`web/src/views/ConsoleView.test.tsx`（两用例）。
- **外部接口**：PUT 偏好对 `landing_tab: "market"` 从 422 变 200（缺陷修复，非破坏——旧客户端不发送 market 值，行为不变）。
- **存量数据**：无迁移（DB 无 CHECK，值域是应用层）。
