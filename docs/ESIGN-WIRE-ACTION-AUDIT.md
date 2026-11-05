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
- **生产复核（部署后补一行）**：按任务 5.1 上产后，重跑两侧测试套件版本=上线镜像
  sha，并在生产 openapi（/api/admin 面需令牌）抽查四路径与签署人面 401 形态。
