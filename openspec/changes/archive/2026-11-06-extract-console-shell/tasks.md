# 任务：控制台摘壳独立成壳

## 1. 壳层改造

- [x] 1.1 App.tsx：门户顶栏渲染条件排除 console（demandNew 折入 console 壳后不再单列）；门户顶栏与页脚不出现在控制台任一页
- [x] 1.2 ConsoleLayout 顶栏补语言切换（复用门户 langButton 的 i18n 机制与持久化，切换即时生效）
- [x] 1.3 ConsoleLayout 顶栏补返回门户链接（照抄 AdminLayout admin-back-portal 模式，data-testid=console-back-portal）
- [x] 1.4 demandNew 路由折入 ConsoleLayout（活跃页签=「我的需求」，aria-current 落 demands；DirectLoad/深链行为不变）

## 2. 测试

- [x] 2.1 App.test.tsx：console 页断言门户顶栏缺席（无门户页签/无登录钮/无进入控制台钮）+ demandNew 同断言
- [x] 2.2 ConsoleLayout.test.tsx：语言切换点击即切文案且持久化；返回门户链接 href=#/；demands/new 活跃页签=我的需求
- [x] 2.3 既有 landing_tab lockstep 与 console-shell 四 Requirement 测试全绿（分组/aria-current/宽度/窄屏不回归）

## 3. 校验与收口

- [x] 3.1 `openspec validate extract-console-shell --strict` 过
- [x] 3.2 web 全量 vitest + tsc 绿
- [x] 3.3 归档合入 console-shell/portal-shell 主 spec
- [x] 3.4 web 镜像出片滚动（池 003，仅 web）+ 冒烟（控制台无门户顶栏/语言切换可用/返回门户可达/demands/new 在壳内）
