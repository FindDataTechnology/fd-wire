# 一个界面只有一个副驾：控制台退掉外向副驾，浮层可缩放，首轮不再静默

## Why

柏讯线上同时挂着两个「副驾」，而且它们撞在同一个右下角：

- 右下角 = 萬星跨线副驾（`copilot.js`，`data-line="wire"`）——**产品咨询/导览**，
  身份与额度归萬星，绑定解析结果为「匿名开放」。`fd-wire/web/index.html` 全局
  加载，不分路由。
- 右下角 = 控制台原生 AI 助手（`AssistantPanel`）——**自有数据读取 + 动作闸 +
  产物草稿**，身份是客户 ID token，计量走客户档位。

登录后进入 `#/console/*`，两个都在：萬星的 iframe 以 `width:420px;bottom:0;right:0`
钉死，`z-index:2147483000`，把原生助手（`z-40`）整个压在下面。更糟的是它带着
**匿名身份**——因为 `fd-wire/web/index.html` 没有实现 `identify()` 钩子，宿主不递票，
萬星永远按匿名访客工作。所以客户看到的是「一个匿名的访客助手压住了我自己的助手」。

同一处遗漏还让浮层出现在 `#/share/*` 与 `#/showcase*` 上，违反
`assistant-panel` 能力已写下的「公开面不出现浮层」。

另外两个体验问题独立存在：

- **首轮感观卡死**：客户自己的消息要等第一次增量轮询（≥0.9s）才从服务端捞回来；
  之后的 5–15 秒里只剩一行静态斜体「正在准备…」，没有秒数也没有阶段推进——与卡死
  无法区分。
- **面板不能缩放**：外壳固定 `30rem × 24rem`，事务区再钉死 `17rem`。想认真干活的
  时候，浮层反而比整页难用。

## What Changes

**① 外向副驾按路由退场（不改萬星 loader 的发布契约）**

- `web/index.html` 增加一个路由闸：`#/console*`、`#/admin*`、`#/share/*`、
  `#/showcase*`、`#/login` 上把 loader 注入的 iframe 设为 `display:none`，
  其余路由恢复显示。机制是宿主侧改 DOM（loader 是 `appendChild` 到宿主的普通
  元素），**不新增跨站协议、不改 `copilot.js`、不需要萬星发版**。
- 闸同时覆盖 loader 异步挂载的时序（`MutationObserver` 兜住晚到的 iframe），
  并保证收起态（80px 高的透明 iframe）也一并隐藏——否则它会静默吃掉宿主角落的点击。
- 结果：公开面只有萬星外向副驾；控制台只有原生助手；分享/橱窗页两个都没有。

**② 浮层可缩放**

- 外壳开启原生缩放（`resize: both`），事务区改为弹性高度；右下角出现浏览器自带
  的缩放把手。
- 表头增加「放大 / 还原」一键切换（右侧 60vw × 85vh），尺寸写 localStorage，
  下次打开沿用。
- 「放大」SHALL NOT 通过路由跳转到 `#/console/chat`：那是另一个组件实例，
  `conversation_id` 在组件 state 里，跳过去等于丢对话另开一个。

**③ 首轮不再静默**

- 发送即在本地渲染客户气泡，不再等轮询把它捞回来。
- 等待期显示带秒数的阶段行（正在向模型提问 / 正在执行某工具 / 已用时 Ns）。

**④ 会话流式**

- 新增 SSE 端点 `POST /api/v1/ai/conversations/{id}/messages/stream`：循环每落一行
  消息就推一帧，模型侧文本增量另推 `delta` 帧。前端改用流，轮询退场。
- 保留原阻塞端点（`/messages`）作为回退路径：边缘代理若缓冲 SSE，前端自动退回
  原端点 + 轮询，行为与今天一致，不会更差。
- 服务端顺带两处提速：LLM 客户端进程级复用（现状是每请求新建并在响应后立即关闭，
  每轮重做一次到 token 网关的连接）；MCP `list_tool_schemas` 按客户加 60 秒 TTL
  缓存（现状是付费档每轮多一次网络往返）。

**⑤ 规格对齐**

- `assistant-panel`：「常驻浮层入口」改写为「入口覆盖面」并补缩放要求；
  「构建过程可见进展」补实时阶段与秒数；新增「浮层 SHALL 支持缩放」。
- 新增能力 `assistant-streaming`：定义一轮对话的流式契约与回退条件。

## Capabilities

### New Capabilities

- `assistant-streaming`: 副驾会话的流式传输契约——一轮之内逐条消息与模型文本增量
  何时对外可见、失败与回退如何如实呈现。

### Modified Capabilities

- `assistant-panel`: 「控制台 SHALL 提供常驻 AI 浮层入口」改写为按路由决定覆盖面
  （控制台内常驻、公开面与分享面缺席）；「构建过程 SHALL 可见进展」升级为实时阶段
  与用时；新增浮层缩放要求。

## Impact

- `fd-wire/web/index.html`：路由闸（新增内联脚本，约 40 行）。
- `fd-wire/web/src/console/assistant/AssistantPanel.tsx`：缩放、放大按钮、尺寸记忆。
- `fd-wire/web/src/console/assistant/AssistantConversation.tsx`：本地回声、阶段行、
  流消费取代轮询。
- `fd-wire/web/src/console/api.ts`：流式读取。
- `fd-wire/api/fd_wire_api/ai/{routes,service,loop,llm}.py`：SSE 端点、增量回调、
  流式补全、客户端复用与工具面缓存。
- `fd-wire/web/src/i18n/{zh,en}.ts`：新增文案。
- **不碰**：`fd-wanxing`（loader 与 widget 的公开契约零改动）、`ChatPage`
  （复用同一会话组件，流式同时受益）、任何 MCP / 爬虫仓。
