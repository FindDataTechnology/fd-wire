# 电子签动作可达面核查记录（evidence）

> change：`add-esignature-wire-actions`（任务 3.1，对应 `lex-contract-esignature` 6.2）
> spec：`wire-esignature-actions`「不代签机器红线」「可达面核查留痕」
> 日期：2026-11-05 ｜ 性质：**离线核查（本地测试实证）**，生产部署后按任务 5.1 复核一行

## 一、agent 可见动作清单（propose 闸，REGISTRY 全集 16 条）

新增三条（均 write→inline 确认档）：

| 动作 id | 风险 | 出网目标 | 触达面 |
|---|---|---|---|
| `wire.esignature.initiate` | write | POST fd-lex /api/admin/esignature/tasks | 建档+发起（原子，闸门预检零残留） |
| `wire.esignature.nudge` | write | POST …/tasks/{id}/nudge | 台账催签事件（不外发链接） |
| `wire.esignature.archive` | write | POST …/tasks/{id}/archive | 幂等出证聚合+证据摘要 |

只读工具（不进闸，直执行零提议）：`esignature_status`（reads.py READ_TOOL_SCHEMAS）
→ GET …/tasks/{id}?customer_id=。

**闸内不存在**（tests/test_ai_actions.py::test_v1_roster_and_tier_mapping banned 断言）：
`wire.esignature.sign` / `wire.esignature.complete` / `wire.key.mint` 等一律未注册。

## 二、机器通道路由全集（fd-lex 侧）

`fd_lex_api/admin_api/esignature_routes.py`（/api/admin/esignature 前缀，require_admin）：

```
POST /api/admin/esignature/tasks                    # 原子建档+发起
GET  /api/admin/esignature/tasks/{task_id}          # 查状态
POST /api/admin/esignature/tasks/{task_id}/nudge    # 催签
POST /api/admin/esignature/tasks/{task_id}/archive  # 归档
```

**openapi 路径全集断言**（tests/test_admin_esignature.py::test_admin_surface_route_set_is_exactly_four）：
上述四条之外零路径；`realname / intent / sign / /s/ / /p/` 路径段逐一排除。

## 三、「不存在非人类可调用签署路径」逐端点核查

| 端点（fd-lex） | 鉴权 | 机器凭证可达？ | 证据 |
|---|---|---|---|
| POST /api/esignature/s/{token}/realname | 链接 token+x-esign-session 短会话 | **否**（只认会话头；X-Admin-Token/internal bearer 无意义） | test_admin_token_means_nothing_on_signer_surface |
| POST /api/esignature/s/{token}/sign（落签） | 同上 | **否**（同上；链接不可复用+实名前置） | 同上 |
| GET /s/{token}、/p/{token}、/s/{token}/preview | 链接 token（人面） | 否（机器通道响应不回显 link token——test_initiate_happy_path_returns_task_view 断言响应无 links；nudge 响应无 link 字段） | test_nudge_pending_only_and_no_link_token_leak |
| wire 侧客户端路径全集 | — | 仅四操作（MACHINE_PATHS frozenset + 源码扫描双锁） | fd-wire test_machine_paths_contain_no_signer_surface |

结论：落签链路（实名→意愿→签署）**不存在任何 agent/系统账号/内部令牌可调用路径**；
机器面四操作的最终权限边界=「建档发起、催签提醒、查状态、归档出证」，
「完成签署」只发生在签署人 H5 面（唯一人类确认面）。

## 四、失败如实性核查（通道未配置）

- fd-lex：INTERNAL_API_TOKEN 未配置 → 四端点一律 403（test_fail_closed_without_internal_token）；
  ESIGN_PROVIDER 未配置 → 发起 4xx 且零残留（test_initiate_provider_unconfigured_no_residue）。
- fd-wire：LEX_ESIGN_* env 缺失 → nudge/archive 提议即拒（PreflightError「未配置」）；
  initiate 提议过（形状预检）但 approve 执行期 state=failed（test_channel_unconfigured_honest_everywhere）；
  读工具如实回错误 dict（不假成功、不静默排队）。

## 五、留痕与复核点

- 本文件由 `add-esignature-wire-actions` apply 生成；测试全绿时间 2026-11-05
  （fd-lex 165 passed / fd-wire 全量见任务台账）。
- ~~生产复核（部署后补一行）~~ **已补（2026-11-06，任务 5.1 上产后）**：

### 六、生产复核记录（2026-11-06，5.1 上产后）

| 项 | 结果 |
|---|---|
| fd-lex-api 镜像 | `sha-8a8df01`（源 04954f0；池 testaction003，BUILD_CONTEXT=server 补丁后出片）ArgoCD Synced，pod Ready |
| fd-wire-api 镜像 | `sha-c5113c2`（源 2b6844a；同池 BUILD_CONTEXT=api）ArgoCD Synced，pod Ready |
| 凭据注入 | `fd-wire-env` secret 注入 LEX_ESIGN_BASE_URL（集群内 svc）+ LEX_ESIGN_INTERNAL_TOKEN（与 fd-lex INTERNAL_API_TOKEN 同值，secret 传输不入 git） |
| 机器面鉴权探针（生产 in-pod） | 无令牌 POST tasks=401；错令牌=401；`INTERNAL_API_TOKEN` 已在 fd-lex-env ✓ |
| **红线复核（生产实证）** | X-Admin-Token 触 /realname 与 /sign=**404**（签署人面无路径+只认会话头）；wire 镜像内 MACHINE_PATHS 段级断言通过；wire ACTION_TO_TOOL_NAME 无 esignature 条目（无新增 MCP 工具） |
| 跨服务真链（stub 窗口） | wire pod → HttpLexEsignClient → fd-lex 真拉：initiate（建+发起 pending）→status→nudge（reminded=true）全过；归档腿经 lex service 全链（completed + evidence_ready + cards=2）后，wire 跨服务 get_status=completed、archive_task 幂等（同 evidence_ready=true, cards=2） |
| fail-closed 复核（撤 stub 后） | ESIGN_PROVIDER 移除 → wire 发起如实报「签署腿未配置：请配置 ESIGN_PROVIDER…」+**零残留**（e2e-esign-probe 任务数=0 实证）；生产常态=fail-closed |
| 壹座 registry 快照 | **无需重烘**：新动作为 wire 内部闸动作（ACTION_TO_TOOL_NAME 无映射、esignature_status 为副驾内部读工具），不进 wire MCP tool_list；wire-ops-mcp 薄包未变 |
| stub 局限备忘 | stub adapter 信封为**进程内存态**：kubectl exec 每次独立进程+pod 滚动重启都会丢信封（fetch_report 404）——跨进程全链必须在单进程内完成（离线测试形态即正确形态）；生产厂商 adapter 无此局限（状态在厂商侧） |

**留尾**：壹座 pack allowTools 扩容（承接单 4.2，paas 侧姊妹单）到位后重跑一次真 agent 路径（合同岗 propose→owner 柏讯确认→执行）。
