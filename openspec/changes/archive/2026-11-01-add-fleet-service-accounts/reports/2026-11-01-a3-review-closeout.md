# 柏讯（wire）侧 A3 复核回执 + 5.1/5.2/6.2 销账

日期：2026-11-01　复核方：柏讯侧　针对：壹座 §七 回执（切换时刻 2026-11-01 19:34:11 CST，观测起算点）
复核方式：**只读实证**（cell 行读 + Logto 审计日志 + wire 平台库），未触碰任何链。

## 一、A3 四点逐条复核

### ① 新链 grant 授权腿 = `ohvn98ztddjj` —— **过**

- fleet cell `3fdc7b8e8ac03b68` `user_line_credentials` 行读（cheap3 `/opt/platform/cells/<id>/data/data/app.db`）：
  `wire-customer` 行 `updated_at=2026-11-01T11:34:11.930Z`（=19:34:11 CST，与 §七 时刻逐毫秒一致）、
  `stale=0`、`refresh_token` 在（len=43 → hasRefresh=1）、行键 `platform-test@findmail.com` 未动；
  ID token 解码 `sub=ohvn98ztddjj`（svc-fleet-core-1）。
- Logto 佐证（`Interaction.SignIn.Submit`，`userId=ohvn98ztddjj`，近 24h）：**恰好 1 条，Success，
  2026-11-01 19:34:07.282836 CST**——先于行写 4 秒、单发无重试，与「全新上下文一次铸币」路径自洽；
  当日无第二次 svc 登录（无人为交互触碰）。
- 说明：Logto v1.42 无可直查的 `grants` 表（grant 在 `oidc_model_instances` 内部模型），
  「RT 会话绑定语义与真人链一致」以同形替代实证：同 client（`i0oxdswqxv4x7te99iukv`）、
  同行结构、同 offline_access RT 形态、hasRefresh=1。

### ② 其余活跃链零受影响 —— **过**

- admin cell `1da519d4c1c0bf89`（aloadtree 真人行）：`lex` / `wire-customer` 于切换后
  19:50:10 / 19:54:07 CST 自然重铸成功，`sub=pih8r05mwh8w`（真人）、`stale=0`——真人链轮换未被打断。
- fleet cell `lex` 行：10-23 至今未动、`stale=0`。
- 10-29 基线对照：两 cell 现存 4 行全部在册，无消失、无意外换主体。

### ③ 用量归属 `svc/fleet-core-1` 服务客户行 —— **挂起待 4.2，不阻塞销账**

- 切换后尚无舰队自然回合：cell `3fdc7b8e` `pack_usage_events` 最新 5 行仍为
  `platform-test@findmail.com`（ts≈10-30 旧数据）。
- 该判据的本体是「切换后第一轮自然回合的归属」，与壹座 4.2（巡线自然回合取证）同源同刻——
  按 §七 约定**随 4.2 证据补录后回填本报告**；①②④ 已过，不阻塞 5.1/5.2/6.2 销账。

### ④ 护栏 UA 分类 —— **认可壹座自报，列入后续日报观察**

- 壹座 §七 自报：铸币窗 19:33–19:35 CST 全程 UA=`mint-line/paas-1`（tool 类 → 按 A3-4 记 ok 不 ALARM），
  无 `Mozilla*` 会话触碰 svc 双号；护栏面在壹座侧，柏讯无独立 UA 日志源，按回执采信，
  起算点 19:34:11 起纳入每日对表。

## 二、事实修正接受（对 §六 A 段）

壹座基线实测成立，我方 §六 误读订正：该行 `stale=1`（行写 2026-10-31T02:16:22Z）时 ID token 早已过期——
**行 `token_exp` 列存 ID token 自身 exp（mint+1h），14d 墙在 RT 侧**；即旧链断供自 10-31 起，
§六「token sub 仍真人」实为「旧链已失效」的残留快照。本次切换同时是断供修复。
**观测起算点 = 2026-11-01 19:34:11 CST，接受。**

## 三、已知边界（记录，不阻塞）

切换范围 = fleet cell `3fdc7b8e8ac03b68` 的 `wire-customer` 行（壹座 change 2.2 约定面）。
**本体建设舰队所在 admin cell（`1da519d4c1c0bf89`）的授权腿仍为真人链**（壹座设计内：
admin cell 归其每 12 天无条件重铸自动化管）。若后续要求本体舰队链也切 svc，需壹座扩 2.2 覆盖行——
柏讯侧不视其为 A 段验收缺口（A3 判据未含）。

**2026-11-04 补记**：上述边界已消除——壹座当日 07:05 CST 将 admin cell 两行（wire-customer/lex）
授权腿同切 `svc-fleet-ops-1`（行读 sub=vsc4tv88zxhb 双行、stale=0、hasRefresh=1；Logto
`SignIn.Submit` vsc4tv88zxhb 07:05:13 CST Success）。全外科线授权腿服务账号化、真人链零在役
（壹座台账 §15.123 续记、跨线文档 §九追记 85e9cfc）。

## 四、销账

- 柏讯 `add-fleet-service-accounts` **5.1 / 5.2 / 6.2 据此销**（6.2 随本单归档落账）；
- 壹座 `add-fleet-service-account-cutover` **3.1（收到切换时刻）、3.3（①②④ 复核回填）可销**；
  3.3-③ 与 4.2 同源，随巡线自然回合证据双向补录。
- 后续对表：起算点 19:34:11；`mint-line/paas-1` 类 UA=ok；`Mozilla*`=ALARM 当日通知壹座。
