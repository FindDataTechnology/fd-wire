# 控制台摘壳独立成壳（extract-console-shell）

## Why

控制台所有页面被门户站点顶栏包裹，同屏两条功能异构横栏（门户顶栏 App.tsx:324 只排除 admin；ConsoleLayout 顶栏 252-303 自带 org/plan/identity/登出）——11-05 体检 P2 体验裁决项+UX 调研头号感知债第二位。内部后台（#/admin）已有独立成壳先例（portal-shell「内部后台 SHALL 无页脚」Requirement 明文），控制台应同一形态。摘壳有两个必须先补的 parity（UX 调研实锤）：①全仓唯一手动语言切换入口在门户顶栏（App.tsx:351-354），摘壳不搬=控制台丢失中英切换；②ConsoleLayout 无返回门户入口（登出才跳 #/）。登录钮会话条件已由 close-wire-implementation-gaps 4.x 完成（第一步），本 change 是第二步。

## What Changes

- **App.tsx 门户顶栏渲染面收窄**：`route.name !== "admin"` 扩为同时排除 `console`（demandNew 折入 console 壳，见下）——门户顶栏与页脚不再出现在控制台任一页。
- **ConsoleLayout 顶栏补 parity**：新增语言切换按钮（复用门户 langButton 同款 i18n 机制与持久化）+ 返回门户链接（照抄 AdminLayout admin-back-portal 模式，data-testid=console-back-portal）；既有 org/plan/identity/队徽标/登出不动。
- **demandNew 折入控制台壳**：`#/console/demands/new` 由 ConsoleLayout 承载（活跃页签=「我的需求」），不再独立路由受门户顶栏包裹——表单进控制台 chrome，与「从控制台发起需求」的用户心智一致。
- **spec 口径**：console-shell 加「独立成壳」Requirement（自有顶栏：品牌字/返回门户/语言切换/org/plan/identity/登出；门户站点顶栏 MUST NOT 包裹；窄屏横向条不变）；portal-shell 的「控制台紧凑页脚」Requirement 补「且 MUST NOT 被门户站点顶栏包裹」句（比照 admin 条款措辞）。
- 非目标：不动侧栏四组/宽度基线/窄屏横向条（console-shell 其余三条 Requirement 语义不变）；不动 admin 壳；不动门户页本体。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `console-shell`: 新增「独立成壳」Requirement（自有顶栏+门户顶栏禁入+parity 两件）。
- `portal-shell`: 「控制台 SHALL 展示紧凑页脚」Requirement 扩一句——控制台 MUST NOT 被门户站点顶栏包裹。

## Impact

- **代码**：web/src/App.tsx（渲染条件+demandNew 折入）、web/src/console/ConsoleLayout.tsx（顶栏 parity）、测试（App.test.tsx 摘壳断言、ConsoleLayout.test.tsx parity 断言）。
- **外部接口**：无 API 变化，纯前端壳层。
- **下游**：11-05 体检 P2「console 页双横栏」销账；portal-shell/console-shell 两本 spec 与页面一致；出片仅 web 镜像。
