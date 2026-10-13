# wire-console-ux-fixes 实施报告（2026-10-13）

## 结论

六任务组 17 任务全部完成，工程侧全绿：

- **api 全量**：`pytest tests/ -q` → 1194 passed, 11 skipped（skips 为 PG 未配置的既有跳过）
- **web 全量**：`vitest run` → 684 passed（15 文件）；`tsc --noEmit` → 0 错误
- **OpenSpec**：`openspec validate wire-console-ux-fixes --strict` 绿，tasks 17/17 勾选

## 落地内容对照

### 任务组 1 白屏根治（/assets 契约回嵌套）

- `api/fd_wire_api/assets/routes.py` `list_assets`：条目改为顶层摘要字段
  （id/name/source_kind/row_count/storage_tier/created_at/updated_by/updated_at）
  + 嵌套 `asset` 段（六字段快照 + cadence_effective）。列表页 cadence_effective
  刻意只取显式 hint 不回查注册表（列表性能优先，与详情 `_meta_view` 的差异已注释）。
- `api/tests/test_assets_api.py`：形状断言改嵌套 + 顶层键集合断言防平铺回归。
- `web/src/console/DatasetsPage.tsx`：`DatasetCard` 对 `item.asset` 全部安全
  可选读法，asset 段缺失时元数据行整体不渲染（测试：目录条目缺 asset 键不白屏）。

### 任务组 2 错误边界两层

- 新组件 `web/src/components/ErrorBoundary.tsx`（class 组件，降级卡 + 重试重挂载，
  zh/en 文案）。
- `App.tsx`：`renderRoute` 外围全局一层（分享独立壳分支同样包裹）。
- `ConsoleView.tsx`：`ConsoleLayout` children 外围内容区一层——单页异常只降级
  该页签，侧栏顶栏仍在。

### 任务组 3 控制台去页脚

- `App.tsx` 页脚分发：admin/console/demandNew 一律 null，门户视图保留 SiteFooter。
- `components/ConsoleFooter.tsx` 删除，无残留 import；备案口径仍由门户全量页脚承载。

### 任务组 4 内部后台修复

- 档位下拉（`admin/CustomersPage.tsx`）：选项集 = 活跃档 ∪ 该行当前档
  （`planOptionsForRow`，当前档为禁用旧档时插回原位保持可见），禁用档 disabled +
  「（已停用）」后缀；新建表单默认不预选（占位项 disabled），未选档不能提交。
- `/internal/datasets/overview`（`datasets/connector_routes.py`）：鉴权从
  `require_internal`（X-Internal-Token，网关从不注入=上线即 401）换为 admin 双闸
  `require_admin_access`（X-Admin-Token + Bearer wire-admin 角色）；六格鉴权矩阵
  测试覆盖（双全 200 / 缺 Bearer 401 / 无角色 403 / 缺令牌 401 / 未配置 403
  fail-closed / 旧头不再被接受）。
- `deploy/README.md` 内部面段补并闸说明。

### 任务组 5 分流落地 + 后台独立壳

- `ConsoleView.tsx`：裸 #/console 会话建立后 `hasAdminRole` 分流改跳 #/admin，
  先于偏好落地序、程序跳转不回写 landing_tab；显式子路径不劫持。
- `App.tsx`：#/admin 不渲染门户站点顶栏（门户页签/登录/语言切换全部退出后台）；
  门户顶栏的「内部后台」入口随摘壳退役（管理员由分流直达，深链由门禁兜底）。
- `AdminLayout.tsx`：新增 `AdminBrandBar`（品牌字 + 「内部后台」小标 + 返回门户），
  同时挂在正常后台页与 AdminView 角色门禁拦截分支（被拦不悬空）。
- i18n：`admin.layout.backToPortal`、`admin.customers.planPlaceholder/
  planDisabledSuffix`、`common.errorBoundary.*` zh/en 对仗，i18nKeys.test 绿。

## 偏离与说明

- **越界产物处置**：web 子代理顺手实现了根仓 change `wire-dataset-marketplace`
  的任务 6.1 web 面（`DatasetVisibilitySection.tsx` 新组件、api.ts/testing.ts 的
  visibility/market 端点封装、DatasetDetail 接线）。该 change 尚未实施（0/26），
  代码完整但无测试。处置：保留不回退（回退会碰坏同文件的本 change 改动），只修其
  一个 tsc 错（TS6133）保证工程门绿；其验收归属 wire-dataset-marketplace 立项时
  补做。风险面：组件只调 console 数据面 API（Bearer 客户身份），无内部面暴露。
- **api 侧既有问题（与本次无关，未修）**：单独收集 `tests/test_datasets_connectors.py`
  会触发 datasets→ai→entities→data_plane 循环导入 ImportError（干净 HEAD 可复现；
  全量跑不受影响）。留待独立修复。
- admin 顶栏原有「返回前台」按钮（admin-exit）保留，新增品牌条不与之冲突。

## 验证留痕

- web：App.test 15 绿（含摘壳/门禁品牌条/页脚三态）、AdminPages 9 绿、
  CustomersPage 5 新用例、DatasetsPage 容错用例、ErrorBoundary 组件测试、
  i18nKeys 3 绿；全量 684 passed。
- api：test_assets_api 16 绿（嵌套形状）、双闸矩阵 + fail-closed 用例、
  全量 1194 passed。

## 部署与冒烟（待办）

api + web 双镜像同批滚动（无 env/secret/迁移变更），滚动后生产冒烟五件：
1. 真客户账号「我的数据」列表正常（有数据集客户，白屏回归）；
2. admin 改档成功且禁用档置灰、新建客户不预选档；
3. admin 本地数据页 200 出数；
4. 管理员裸登录落 #/admin（独立壳无门户顶栏）；
5. 普通账号登录仍落 #/console、无后台入口、控制台无页脚。
