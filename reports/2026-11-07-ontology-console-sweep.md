# 本体控制台全量扫验收报告（2026-11-07，polish-wire-ontology-console）

 impeccable 有界流程：brief 立面 → 3 组件并行打磨（W1 EntitiesPage+DomainActionsPanel / W2 EntityObjectBrowser / W3 OntologyVersionSection）→ 中央归并（i18n 27 键落库 + t() 迁移 + 测试机械更新）→ vitest + build 验证。

## 逐组件七项清单结论

| 组件 | 结果 | 要点 |
|------|------|------|
| EntitiesPage（含 DomainActionsPanel） | 通过 | loading min-height 占位不闪跳；**0 实体真空态双路径引导**（手动声明 / 本体建设舰队提案，零摆拍）；**ACL 403 三型分型卡**（档位闸 PLAN_TIER_REQUIRED 带升档指引 / 受限集 NEED_WRITE 找 owner / 读拒绝——按 API 已返回类别渲染，不重判 ACL）；**物化两步确认**（后果摘要卡：连接键 mono、junction 展开/orphan 如实计数、缺省命名「{左}×{右} 连接」冲突追加 _2/_3、成功名以 API 回传为准）；**提案 pending 明示「待人工确认——owner 确认后才生效（提案 ≠ 已生效）」**；面板主钮统一 slate-900（rose 只留破坏性） |
| EntityObjectBrowser | 通过 | 加载占位不塌跳；筛选空/真空拆分（原 empty 键两义）；ACL 三型分型（局部纯函数→归并共享口径）；对象行/键值 mono；窄屏值列收缩+横滚兜底 |
| OntologyVersionSection | 通过 | 空版本态虚线卡+发布引导；无 diff=amber 如实；diff 三色 token（增 emerald/删 rose/改 amber——brief 权威，任务草稿的 indigo 说法被 brief 驳回）；回滚卡 rose 系+两步确认+「历史只增不减」危险提示；宽 diff 横滚 |

## 中央归并（i18n）

- 27 个新键 zh/en 双侧同落（`console.entities.*` / `.objects.*` / `.version.*` / `.actions.*` / `console.acl.*`）；**额外修复既有缺键** `console.entities.actions.disable`（原样裸显键名）。
- 四张组件级局部映射（LOCAL_COPY / STATUS_LABELS / OBJECTS_NEW_I18N / LOCAL_TEXT）全部删除、切换回 `t()`（插值改 i18next 原生 vars）；「未知状态值透传 API 原文」兜底保留。
- DomainActionsPanel `jsonRequest` 修复 detail 对象被 `String()` 成 `[object Object]` 的纪律违规（detail 原样进 ConsoleApiError，403 分型因此可用）。

## 验证

- `npx vitest run`：**70 文件 / 1101 用例全过**。EntitiesPage.test.tsx 更新：4 个物化流用例补两步确认二次点击；新增两步确认+取消零 POST 用例；403 分型卡断言；空态双路径断言；pending hint 断言。
- `npm run build`（tsc --noEmit && vite build）通过。
- testid 既有全部保留，新增 `-summary/-confirm/-cancel/-acl`、`acl-notice`、`domain-action-pending-hint`、`entities-empty-create`。

## 行为无关复核

- API 调用形态、ACL 判序（404→403→ACL）、动作闸端点与风险语义、版本化接口零变更。
- 缺口如实：console 截图检视需客户登录态 + 真实 API（本轮以 1101 组件测试 + 类型检查 + build 替代视觉轮；视觉轮挂账至内容面首个域就绪时一并做）。
