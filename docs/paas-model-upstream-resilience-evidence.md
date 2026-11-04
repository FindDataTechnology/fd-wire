# 递壹座：model_upstream 韧性实弹证据——降级路径零触发

> 提出方：fd-wire（柏讯线） · 2026-11-04
> 对应：`fix-fleet-model-drift` 5.2（「真机验证挂账：等中毒再次复发」）、`fix-fleet-turn-attribution` §三/§四（车道键控熔断 + 降级重试一次）
> 数据源：2026-10-31 只读重普查（platform 控制台 `/api/fleets`，8 支活跃舰队 437 条回合，按上产时刻分层；口径=非 ok 全收）
> 性质：**证据递送，不是新需求**——5.2 所候的「中毒复发」已在进行，本稿把实弹观测递到，请核验降级为何未咬合。

---

## 一、实弹观测（2026-10-28 上产后窗口）

| 事实 | 数值 |
|---|---|
| 窗口内回合 | 199 条：ok 85 / 非 ok 114（**57.3%**） |
| 头号死因 | `model_upstream` **68 条**（全部为上游 503/502：67×`Service temporarily unavailable`、1×`Upstream service temporarily unavailable`——与 token 网关 deepseek 502 窗口旧挂账同源） |
| 降级触发 | **0 条** detail 带 `degradedTo` |
| 熔断开窗 | **0 条** `skipped`（按 §四 设计「熔断开窗期回合记 skipped」，该通道整个窗口未出过一条） |
| 重灾区 | 识律政心监测舰窗口内 0/6 全非 ok；营销·官网内容舰窗口内 96 非 ok |

对照：平台侧三缺口验收全过（失败可见性/0 秒 RNR 归零/timeout 归因 35/36 带 detail），已回写
`fd-wire/docs/ROADMAP-v2.md` Wave 0.1——**平台不再假正常，但舰队仍在上游 5xx 面前成批死亡**。

补充（2026-11-04）：ops 板（paas-admin）fleet overview 24h 读数 turns/errors=1552/1417——
该板口径与普查口径不同（agent 面含 customer cell，未对齐），仅作「上游窗口在普查日之后仍在延续」的旁证。

## 二、判读与疑问

熔断+降级代码已上产（10-27 归档），但实弹零咬合。三种可能，请壹座定位：

1. **触发条件未命中**：§四 语义是「model_upstream **快速失败（<60s）**按解析链降级重试一次」——实测 503 若携带长耗时/重试尾延迟（>`60s`）或车道键（providerId|baseURL|apiKey 指纹）解析结果与设计不符，则永不触发；
2. **配置/开关未开**：代码在产但 env 或默认档位未启用；
3. **记录位遗漏**：实际降级发生了但 `degradedTo` 未落 detail（可从模型侧用量对账证伪）。

## 三、请壹座办理

1. 用 `fix-fleet-model-drift` 5.2 挂账场景收口：本窗口即「中毒复发」，按 5.2 验收走查（`modelRectified`/`modelMismatch` 生产显现）；
2. 回答「降级为何零触发」（三选一或另述）；
3. 若确认不咬合，立修复 change（验收建议：**下次上游 5xx 窗口内至少出现 `degradedTo` 记录或熔断开窗（`skipped`）证据，且政心舰不再窗口内全灭**）；
4. 台账 §15.123 若需引用本稿数据可直接取用（普查为只读，无写面）。

---

## 四、定谳回执（壹座侧 · 2026-11-04，fd-wire 代笔补记）

三假设逐一落定（取证面：代码复读 + 平台 API 分层重测 + 生产 pod 内 lane 探针）：

1. **`degradedTo` 零触发 = 假设①变体（结构性够不着，非 bug 亦非配置）**：降级腿的门槛是「解析链存在未试候选」，而生产各岗链恒为单跳——member.model（deepseek-v4.1-flash）== cell boot 默认、fallbackModel 全 null、fleet.defaultModel 全 null，`resolveModelChain` 去重后链长=1，`landedIndex+1 < candidates.length` 恒假。240h pod 日志 0 条降级 warn 实锤。**链上无下一跳=如实失败**（spec 本义），要「5xx 即换模型」是给岗位配 fallbackModel 的产品动作，非本缺陷。
2. **`skipped` 零 = 接线活着但滑窗语义对无人值守 cadence 结构性无效**：pod 探针证实 lane 解析正常（deepseek-v4.1-flash → lane-01eb3e096d91165c，buildLaneLookup 在 server.js:613 已接）。真因=10-27 实现的滑动窗（10 分钟内 5 次、开 10 分钟冷却）：回合 cadence 最小错峰 15 分钟、典型小时级——窗内攒不满阈值，攒满一次（10-30T23:38 恰好 5 条）也无下一回合落进 10 分钟冷却期。需求原句「连续失败达阈值」被实现成了挂钟窗。**修复=paas change `fix-llm-breaker-streak`（已实施）**：改连续失败 streak（与间隔无关、任一成功清零关窗、探针再败前滚 openUntil）、冷却默认 10min→2h 覆盖小时级 cadence、WINDOW_MS env 废止；测试 408 全绿含「间隔 3 小时连击仍开窗」红→绿靶心场景。
3. **`modelRectified` 零 = 自愈门死代码（新缺陷，非本稿三假设）**：e2e 补做时逮出 `normalizeModelForJob` 返回缺 `explicitChain` 字段→自愈重试自 9f4434ef 上线即恒不开。已修（透传字段+红绿双证），随 `fix-fleet-model-drift` 归档（fc46bf14），待与熔断 streak 同面出片滚产。

**请办项对账**：①=已由 drift 4.2 收口（e2e 红绿双证替代真机等待，真机显现待复发窗）；②=本段定谳；③=`fix-llm-breaker-streak` 已立（验收=上产后下个 5xx 窗内出现 skipped 或探针关窗证据）；④=数据本稿自含。
