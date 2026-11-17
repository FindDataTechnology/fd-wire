# 设计：副驾去重、缩放与流式

## Context

现状事实（均为读码所得，见 proposal「Why」）：

- `fd-wire/web/index.html` 末尾一行 `<script src=".../copilot.js" data-line="wire" defer>`，
  不分路由；`copilot.js` 用 `document.body.appendChild(frame)` 把 iframe 挂到宿主
  DOM，并把尺寸写在内联 `style.cssText` 上（`width:420px`，开 640px / 收 80px）。
- 宿主未实现 `identify()`，所以萬星侧四条线里唯独 wire 跑在匿名层。
- `ConsoleView` 在非 `chat` 页签挂 `AssistantPanel`（`z-40`，右下角）。
- 会话请求 `POST /api/v1/ai/conversations/{id}/messages` 是阻塞式：
  `run_copilot_loop` 全部跑完才返回，前端靠 `after_id` 增量轮询看中间过程。
- `TokenGatewayLlmClient` 每个请求 new 一个 httpx client，`routes._release()` 在响应
  后 close。
- `/api` 由边缘 Caddy（cheap-1）+ SafeLine 承接；`/internal/` 才有同域 nginx，
  读超时 320s。`/api` 的 SSE 是否被缓冲未验证。

## Goals / Non-Goals

**Goals**

- 一个界面同一时刻只有一个对话入口，且它在那个界面上是「有用的那个」。
- 面板能在不丢会话的前提下变大变小。
- 首轮从点击到第一条可见反馈的时间压到一次本地渲染（<50ms），等待期能看到阶段与用时。
- 模型文本尽可能早地开始出现。

**Non-Goals**

- 不改萬星 `copilot.js` / `EmbedView` 的任何行为或发布契约。
- 不改控制台已有页签布局、不动 `ChatPage` 的内容结构。
- 不引入 WebSocket（现有控制台走的全是 HTTP，加一条长连接会多一套鉴权与重连语义，
  收益只是省掉 SSE 的一条连接）。
- 不做模型选择、多会话、历史列表等周边能力。

## Decisions

### D1 用「宿主改 DOM」实现退场，而不是新增跨站协议

**选择**：`index.html` 内的内联脚本按 `location.hash` 决定 `iframe.style.display`，
并在 `MutationObserver` 里对新挂载的 iframe 应用同一条规则。

**理由**：loader 挂的是普通的 `<iframe data-wanxing-copilot="wire">`，宿主天然拥有它。
给萬星加一个 `WanxingCopilot.visible()` 钩子要改 loader、要跨仓发布、要写兼容分支，
而收益完全相同。内联 `style.display` 后赋值即可生效，不覆盖 loader 自己的尺寸写操作
（它只改 `height`，与 `display` 正交）。

**备选**：① 萬星 loader 增加 `visible()`（跨仓发布，被否）；② 卸载 iframe 再重建
（会丢 widget 内会话与匿名 token，且每次都重新解析绑定，被否）；③ 让 ConsoleView
去和 iframe 抢 z-index（视觉压制而非移除，匿名声明的 assist 仍可被点到，被否）。

### D2 退场路由表 = 有原生对话入口或公开只读的页面

```
#/console/*  #/admin*   -> 原生 AssistantPanel 在场，萬星退场
#/share/*    #/showcase* -> 公开只读面，两个都退场（spec 既有约束）
#/login      -> 登录中转，两个都退场
其余（#/、#/pricing、#/docs、#/catalog*、#/demands/new 之外的公开面）
             -> 萬星在场，原生助手不在场（它只在 console 壳里挂载）
```

`hashchange` 是唯一触发源，因为本 app 是 hash 路由（`App.tsx` 头注即写明了）。
`pushContext()` 已在 hashchange 上挂了同一个触发器，闸的求值可以与之并排。

**风险**：首次渲染时 iframe 可能还没挂（loader 是 `defer` + 一次 fetch 解析绑定后
才 mount）。`MutationObserver` 观测 `body` 的子节点新增，命中
`iframe[data-wanxing-copilot]` 就立即应用规则；观测器在首帧建立，晚到的 iframe 也
逃不掉。这一条必须有 e2e 断言，不能只靠人工点。

### D3 缩放用原生 CSS，不用自写拖拽

**选择**：面板容器 `resize: both; overflow: hidden; min-width/min-height; max-width/max-height`，
事务区从 `h-[17rem]` 改为 `min-h-0 flex-1`。表头「放大/还原」按钮切换一个 class
（`60vw × 85vh` ↔ 上次尺寸）。

尺寸持久化：`localStorage["wire.assistant.panel-size"] = {w,h,maximized}`。**不进
`preferences` 表**——一次 API 往返换一个纯观感偏好不划算，而且 preferences 的
schema 已有明确语义（落地页、置顶看板），塞 UI 尺寸会稀释它。

**备选**：① 自写拖拽 + 四角把手（代码量十倍，浏览器原生已覆盖）；② 只做两档按钮
（用户明确要求「放大和缩小」，两档不算缩小，被否）；③ 路由跳到 `#/console/chat`
（丢会话，被否）。

### D4 本地回声 + 阶段秒表，先于流式落地

**选择**：`submit()` 里立刻把用户消息以临时 id 插进 `entries`（负 id，避免与
服务端 id 冲突），服务端行到达后按内容与位置收敛（首条 `role=user` 且本地还有
临时行时替换）。阶段行由前端计时器驱动：`progress` 状态从字符串升级为
`{phase, startedAt}`，每 500ms 重渲染一次显示「… 已用 6s」。

**理由**：这一层的收益是即时的，且零后端依赖——即使 SSE 被边缘代理缓冲必须回退，
「点了就有反应、等的时候看得见秒数」这条体验也成立。先做它，再做流式。

### D5 SSE 用「消息级 + 增量级」两种帧

帧契约（`text/event-stream`）：

| 帧 | 时机 | 载荷 |
|---|---|---|
| `event: message` | 循环每落库一行（user / 中间 assistant / tool_trace / 动作卡） | `{id, role, content}`，形状同 `/messages` 单项 |
| `event: delta` | 模型流式产出的文本增量 | `{text}`（累加后的全文，非片段——与萬星 `parseTurnStream` 同口径，前端可直接替换） |
| `event: done` | 本轮结束 | `{conversation_id, messages: [...]}`（权威集合，与阻塞端点返回同形） |
| `event: error` | 本轮失败 | `{message}` |
| `: keepalive` | 每 15s | 空注释行，防边缘代理掐空闲连接 |

`delta` 累加而非片段，是因为前端只需要「当前应该显示什么」。片段拼接要在客户端维护
缓冲区与补丁顺序，收益为零。

**服务端实现落点**：`run_copilot_loop` 增一个可选 `on_event` 回调，`emit()` 与
`llm.complete_stream()` 的 `on_delta` 都调它；回调为 `None` 时不产生任何额外开销
（阻塞端点与本轮未改的测试路径零漂移）。`service.chat()` 透传。

### D6 流式补全做成可选能力，而非新接口

**选择**：`TokenGatewayLlmClient` 增加 `complete_stream(messages, tools, on_delta)`
方法，返回与 `complete()` 同形的 `LlmAssistantMessage`。循环侧用
`getattr(llm, "complete_stream", None) or llm.complete` 取实现。

**理由**：`LlmClient` 是 `protocols.py` 里冻结的契约，测试全部注入 mock。加一个
*可选* 方法，mock 不需要改一行，也不破坏任何现有调用方。tool_calls 的流式形态需要
按 `index` 累积（OpenAI 契约里 `delta.tool_calls[i].function.arguments` 是分片的
JSON 字符串），这段解析放在 `llm.py` 内部，对外仍是完整 `ToolCall`。

**风险**：token 网关（`glm-4.7` 等）对 `stream: true` 的 tool_calls 分片支持未经实测。
缓解：累积失败或字段缺失时退回非流式补全该轮（一次内部重试），只损失这一轮的
打字效果，不影响正确性。

### D7 回退路径是「同一个按钮」，不是错误提示

前端先探测流端点：请求发出后若 3 秒内没有任何帧到达，或响应 `Content-Type` 不是
`text/event-stream`，则中止流并改走原 `/messages` + 现有轮询逻辑。用户看到的是
「慢了一点」，不是「出错了」。轮询代码保留，不删。

### D8 两处服务端提速

- **LLM 客户端复用**：`TokenGatewayLlmClient` 改为模块级单例（httpx client 线程安全
  足够本场景），`_release()` 对它变成 no-op（用 `owns_http=False` 标记）。测试注入
  的 mock 不受影响——`_release` 只在真客户端上有 `close()`。
- **工具面 TTL 缓存**：`copilot_tool_schemas` 的 MCP 分支按 `customer_id` 缓 60 秒
  （进程内 dict + 时间戳）。工具面在分钟级是稳定的；免费档本来就走不到这条分支。

## Risks / Trade-offs

- **SSE 被边缘代理缓冲** → 上产第一步用 `curl -N` 从公网打一次看帧是否逐帧到达。
  被缓冲则 D7 回退生效，功能不受损，只是没有打字效果。届时再评估换 `/internal/`
  同域 nginx 通道。
- **隐藏 iframe 仍持有连接** → `display:none` 不卸载，萬星 widget 的匿名 token 与
  已建立的会话都保留（这是优点：公开面 ↔ 控制台来回切不掉状态）。代价是控制台里
  仍有一条到萬星的 iframe 在内存里，但它不渲染、不收点击、不发请求（widget 只在
  用户发消息时请求）。
- **路由闸漏路由** → 白名单式判断写成「以 `#/console` 或 `#/admin` 开头即隐藏」，
  新增 console 页签无需改闸。分享/橱窗同理按前缀匹配。
- **本地回声与真实行重复** → 收敛规则以「服务端行 id 单调递增 + 首条 user 行替换
  本地临时行」为准，并有一条单测钉住。

## Migration Plan

单仓、单镜像（`fd-wire-web` + `fd-wire-api`），无数据迁移。

1. 后端 SSE + 可选流式补全先上（前端不用它也不受影响）。
2. 前端路由闸 + 缩放 + 回声一起上。
3. 前端切流并保留回退；观察一轮公网 `curl -N` 与浏览器 Network 面板的帧时序。
4. 回滚：前端镜像回滚即恢复原状；后端端点新增，旧前端不受影响。

## Open Questions

- SSE 在 SafeLine 下是否被缓冲（D7 已设计回退，不阻塞实现）。
- token 网关的 tool_calls 流式分片是否完整（D6 已有退回路径）。
