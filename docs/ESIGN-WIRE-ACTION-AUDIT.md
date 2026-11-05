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

### 七、母单 7.1/8.1 收口复核（2026-11-06 03:00-03:30，lex-contract-esignature）

**镜像事故与修复**：sha-31bc6ab（flush 修复首滚，源 2af908e）缺 `alembic`（migrate init `exec failed: "alembic": executable file not found in $PATH`）→ pod CrashLoopBackOff、**生产中断 ~30 分钟**（02:28-02:58）。根因=共享构建池 testaction003 变量竞态互踩；GHA 自 10-29 起账单故障全 failure（billing 边界，未硬闯）。处置：先回滚 sha-8a8df01（f11407a），主线随即以**专属快照仓 scs001/fd-lex-priv-images** 重出 sha-6ec77dc（源 1841130，含 flush 修复；ef88894）——镜像内 alembic 1.20.1 在位，`/api/version`=200，ArgoCD Synced Ready。

**flush 修复后生产 stub 窗口（03:01+0800，pod sha-6ec77dc，双任务全链）**：
- 控制台发起：actor=`e2e-esign-console`，task_created→envelope_created→**link_issued ×2**（同会话 flush 修复生效，不再 links=[] 死任务）
- H5 相对方：realname_verified→signed（甲乙各 1，STUB-SIG），intent 显式确认
- 计量：metering_records 4 行（2 任务×2 签署人，unit=signing quantity=1，caller=console-probe）
- 完成+出证：task_completed，evidence zip（manifest/events/provider_report）落 PVC lex-esign-files
- 坏账对账：31bc6ab 窗口遗留 4 个 pending 死任务（links=[]）留库待清理（零计量，不影响验收）

**收口验证窗口（03:15-03:20，GitOps 临时 stub 注入 eebc0d2 → 验证 → 撤 39ff760）**：
- 原件验证 verify_package：两任务 valid=True（content_integrity/package_anchor/signature_chain 全过）
- 篡改一字：valid=False，content_integrity 如实失败（spec「篡改文件验证失败」生产实证）
- 证据卡：evidence_cards=2/任务（SP001，evidence-card-organizer 字段表）
- 撤 stub 后：发起探针=**HTTP 503「签署腿未配置…合同可保存为草稿」**（spec Req 7 机房口径同源），探针任务零残留（任务数=0），生产常态 fail-closed

**8.1 阻断项（修复已落地未进产）**：8.1 收口审读发现两处 SHALL 标注缺口——H5 签署页原页脚虚假归属「由持牌电子签名服务商通道完成」（stub 下为假，spec Req 3 要求标注「内测环境、无司法效力」）；出证包 manifest 缺「内测假件、无司法效力」标注（spec Req 6）。修复=fd-lex b430bb9（H5 adapter 感知标注+manifest annotation，166 测试绿）。**待下张镜像（sha≥b430bb9，走 scs001/fd-lex-priv-images 专属池，同 ef88894 配方）滚动后重验，8.1 方可勾**。
