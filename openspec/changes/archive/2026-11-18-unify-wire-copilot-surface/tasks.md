# 任务

## 1. 服务端：流式端点与循环回调

- [x] 1.1 `api/fd_wire_api/ai/loop.py`：`run_copilot_loop` 与 `emit()` 增加可选
      `on_event` 回调（缺省 None 时零开销），并在 `cell` 未开通、轮次截断、模型失败
      三条中止路径上同样触发。验证：`uv run pytest tests/test_ai_loop.py -q` 全绿，
      且新增一条断言「不传 on_event 时行为与改动前逐字节一致」。
- [x] 1.2 `api/fd_wire_api/ai/service.py`：`chat()` 透传 `on_event`。验证：现有
      `tests/test_ai_api.py` 全绿。
- [x] 1.3 `api/fd_wire_api/ai/llm.py`：新增 `complete_stream(messages, tools, on_delta)`
      方法，解析 OpenAI 流式 `delta.content` 与按 `index` 累积的
      `delta.tool_calls`，返回与 `complete()` 同形的 `LlmAssistantMessage`；分片解析
      失败时退回该轮非流式补全。验证：新增 `tests/test_ai_llm_stream.py`，用分片
      SSE 夹具覆盖纯文本、单工具、多工具并发三种情形，并断言行内丢字段时回退成功。
- [x] 1.4 `api/fd_wire_api/ai/routes.py`：新增
      `POST /api/v1/ai/conversations/{id}/messages/stream`，返回
      `text/event-stream`，帧类型见 design D5（`message` / `delta` / `done` /
      `error` / `: keepalive`）。验证：`tests/test_ai_stream.py` 断言帧顺序、去重后
      与阻塞端点返回等价、失败路径发出 `error` 帧。
- [x] 1.5 `api/fd_wire_api/ai/routes.py` + `llm.py`：LLM 客户端进程级复用
      （`_release` 对共享实例 no-op），`copilot_tool_schemas` 的 MCP 分支按
      `customer_id` 加 60s TTL 缓存。验证：新增单测断言同一客户两次组装只触发一次
      `list_tool_schemas`，不同客户各触发一次；`pytest -q` 全绿。

## 2. 前端：副驾去重（路由闸）

- [x] 2.1 `web/index.html`：加入路由闸脚本——`#/console*`、`#/admin*`、`#/share/*`、
      `#/showcase*`、`#/login` 上隐藏 loader 注入的 iframe，其余路由恢复；
      `hashchange` 与 `MutationObserver` 双触发（覆盖 loader 晚挂载）。验证：本地
      `npm run dev` 后手动从 `#/` 导航到 `#/console/datasets` 再返回，Network/元素
      面板确认 iframe 存在但 `display:none`、且不拦截点击。
- [x] 2.2 `web/src/App.test.tsx` 或新增 `web/src/copilotGate.test.ts`：把闸的判定抽成
      可测纯函数（路由 → 是否显示跨线副驾），断言五类路由的判定，含未知 hash 回落。
      验证：`npx vitest run` 全绿。
- [x] 2.3 e2e 断言：控制台页不存在可见的跨线副驾、公开页存在。验证：在现有
      Playwright 用例中补两条（若仓内无 e2e，先落地 2.1/2.2 并在 tasks 里记下缺口）。

## 3. 前端：浮层缩放

- [x] 3.1 `web/src/console/assistant/AssistantPanel.tsx`：外壳改 `resize: both`、
      事务区改弹性高度；新增「放大 / 还原」按钮；尺寸写
      `localStorage["wire.assistant.panel-size"]`，挂载时读取。验证：
      `AssistantPanel.test.tsx` 补一条「切换放大后 `data-testid=assistant-panel` 的
      尺寸类变化，且 `conversationId` 未重置」。
- [x] 3.2 校验放大尺寸不超出视口（`max-width: 100vw - margin`、`max-height` 同理）。
      验证：窄视口下手动检查面板不溢出，按钮仍可点。

## 4. 前端：本地回声与阶段秒表

- [x] 4.1 `AssistantConversation.tsx`：发送时以负数临时 id 立即插入客户消息，
      服务端首条 `role=user` 行到达后替换。验证：单测断言发送后同步存在一条
      `assistant-entry-user`，服务端行到达后总数不变、id 转为正数。
- [x] 4.2 `progress` 状态升级为 `{phase, startedAt}`，每 500ms 重渲染显示阶段与
      已用秒数；阶段文案进 i18n（`zh.ts` / `en.ts`）。验证：单测用假时钟断言
      秒数递增，且回合结束后阶段行消失。

## 5. 前端：流式消费与降级

- [x] 5.1 `web/src/console/api.ts`：新增 `postMessageStream(conversationId, content, context, handlers)`
      ——解析 SSE 帧并回调 `onMessage` / `onDelta` / `onDone` / `onError`；3 秒无帧或
      响应类型不符时返回「不可用」信号。验证：新增 `api.stream.test.ts`，用
      `ReadableStream` 夹具覆盖四种帧与超时分支。
- [x] 5.2 `AssistantConversation.tsx`：优先走流；收到「不可用」信号时退回原
      `postMessage` + 既有轮询（轮询代码保留不删）。验证：单测分别注入可用/不可用
      两种传输，断言事务区最终内容一致，且不可用时不出现错误提示。
- [x] 5.3 i18n：新增阶段与流相关文案（中英各一份），无未翻译键。验证：
      `npx vitest run` 全绿，`npm run build` 无 i18n 缺键告警。

## 6. 上产与实证

- [x] 6.1 后端先上；用 `curl -N` 从公网打一次流式端点，记录帧时序（是否被边缘代理
      缓冲）。验证：输出保存到 change 目录的 `evidence/`，帧间隔远小于整轮耗时即为通过。
- [x] 6.2 前端上产；浏览器实测三条：公开页只见跨线副驾、控制台只见原生助手且可缩放、
      首轮发送即时回声 + 秒数递增 + 增量文本出现。验证：三条各自截图或录屏留存。
- [x] 6.3 `openspec validate unify-wire-copilot-surface --strict` 通过，`openspec sync`
      更新 `assistant-panel` 与新增 `assistant-streaming`。
