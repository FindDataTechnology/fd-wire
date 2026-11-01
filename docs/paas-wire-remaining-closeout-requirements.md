# 壹座/萬星侧需求：柏讯线剩余跨线收口（服务账号切换 + 本体建设舰队铸造）

> 提出方：fd-wire（柏讯线）
> 日期：2026-10-31
> 关联：fd-wire change `add-fleet-service-accounts`（9/12，剩 5.1/5.2/6.2）；
> `fleet-packs/blueprints/ontology-builder/blueprint.json`（本体建设舰队蓝图）；
> `docs/business-mcp-shared-objects-requirements.md`（本体建设 v1 边界，只登记不施工）
> 状态：**待评审**

---

## 一、背景（一段话）

柏讯线当日的三件「本体建设 v1」施工件（写面 / m:n 物化 / 对象遍历）已上产归档，
B2 数据集 ACL、window 算子、DAG 执行器也已在 10-31 全链上产。剩下三件跨线事只
有壹座侧能做：**①服务账号收号与铸币切换**（人机身份解耦的最后一步）、
**②本体建设舰队的铸造**（蓝图模板已在册，但舰队尚未物化）。**重烘焙已核实无需
动作**（见 §二），不需要再走一轮。

## 二、已核实：不需要 paas 改动的部分（柏讯侧已完成）

| 事项 | 证据（2026-10-31 实测） | 结论 |
|---|---|---|
| registry 工具面重烘焙 | registry `GET /api/servers/wire-ops-mcp` → `num_tools=22`，含 `wire_action_list/propose/status`、`wire_object_search/get/relations`、`wire_claim_resolve`、`wire_content_*` | **已烘焙**，无需再动 |
| wire-build-mcp 工具面 | 未新增工具（ACL/window/DAG 都是 console 写面或管线面，不进工具面） | 无需重烘焙 |
| 三支客户 cell 升级 | `cell:sha-48e2e93` 三支 healthy，registry 实测 `customer_dataset` 组 32 工具、`window` 在列 | 柏讯侧完成 |
| 本体平台面（写面/对象面/m:n） | `wire-entity-write-surface` / `wire-entity-mn-materialize` 10-31 归档上 spec | 柏讯侧完成 |

## 三、需求 A：服务账号收号确认与铸币切换（`add-fleet-service-accounts` 5.1/5.2）

### A1 现状（柏讯侧实测，2026-10-31）

- 两号已发并入库：`svc-fleet-core-1@finddatatech.cloud`（sub `ohvn98ztddjj`，Customer
  `svc/fleet-core-1`）、`svc-fleet-ops-1@finddatatech.cloud`（sub `vsc4tv88zxhb`，
  Customer `svc/fleet-ops-1`）；org `svc-fleet`=`kfq3i47bv5p8`；零角色；口令仅在本机
  台账（全树扫描 CLEAN）。
- **彩排已过（10-29）**：`mint-line/paas-1` UA 双号登录成功（client=`i0oxdswqxv4x7te99iukv`），
  全链 code→token 通；consent 可编程批准（`POST /api/interaction/consent {}`）。
- **切换未发生**：Logto `Interaction.SignIn.Submit` 自 10-29 后**再无** `svc-fleet-*`
  记录（唯一近期登录是本会话的 `wire-tester2` 冒烟与 `svc-ontology-smoke-1`）。
  → 现役舰队链仍走真人账号。

### A2 需要壹座做的事

1. **收号确认**（一句话即可）：两号已收到、凭据入库（口令走带外，勿入仓/日志）。
2. **切换铸币主体**：把舰队链的**授权腿**从真人账号换到 `svc-fleet-core-1`
   （`mint-line` 现状已是「每轮无条件重铸 + 全新会话」，无需改铸币器）；
   **行键（cell 属主）不动**——这是已回执确认的预期形态（见
   `openspec/changes/add-fleet-service-accounts/reports/2026-10-29-paas-cutover-reply.md`
   §五 发现②）。
3. **观测起算点重置约定**：切换时刻记录在案，柏讯侧按该时刻起算护栏日报与计量归属。

### A3 验收判据（柏讯侧复核，切换后 24h 内可出结论）

1. 新链 grant `accountId=ohvn98ztddjj`，且 RT 会话绑定语义与真人链一致；
2. 原真人账号（`platform-test@findmail.com`、`aloadtree@gmail.com` 线）活跃链零受影响
   （对照基线=10-29 在册 grant 集合）；
3. 用量计量归属 `svc/fleet-core-1` 服务客户行（不是真人 Customer）；
4. 护栏日报：切换日起 mint 时段出现 `mint-line/paas-1` 类 UA=正常；出现 `Mozilla*`=ALARM
   当日通知壹座。

### A4 回执请写明

- 收号确认（有/无）；
- 切换排期（或已切换的时刻，用于起算点）；
- 若需要柏讯侧先铸后切的双轨窗口，提出来我们照办。

## 四、需求 B：本体建设舰队铸造（蓝图 → pack 发布 → 舰队物化）

### B1 现状（柏讯侧实测，2026-10-31）

- **蓝图模板在册**：`fleet-packs/blueprints/ontology-builder/blueprint.json`（v2 契约，
  五岗：`scout` 盘账 / `modeler` 建模 / `reviewer` 纪律校验闸 / `deployer` 声明提案员 /
  `chief` 台账主编；cadence 03:10 / 03:40 / 04:10 / 04:40 / 05:10 Asia/Shanghai）。
- **pack 已装进某 cell**：`installed_packs` 有 `YT87-2Axuu49I123zVYyhA`「柏讯本体建设团队」v2
  （manifest 含 `fleet` 段，五岗齐全），装于 2026-10-31 04:54Z。
- **但舰队未物化**：platform `fleets.db` 只有两支试跑舰队（政策盯梢/工单分诊），
  `fleet_members`/`fleet_runs`/`member_turn_events` 均无本体建设舰队记录。
- **registry 未在册**：`GET /api/servers?limit=200` 28 项里无本体建设 pack（pack id
  `YT87-…` 查询 404）——说明该 pack 是**直装进 cell**，未走「发布→市场→订阅」通道。

### B2 需要壹座做的事（三选一，请裁决路径）

**路径 1（推荐，沿既有铸造配方）**：把 `柏讯本体建设团队` 作为 pack 发布到 registry
（在册名 `柏讯本体建设团队`，packId 台账落 `fleet-packs/README.md`），再经
**蓝图构造间**（`POST /api/blueprints/:id/trial` 或等价铸造通道）铸造成舰队：

- 舰队名 `本体建设舰队`，owner=平台运维账号（或指定客户 owner），
  `state` 出生即 **paused**（沿「born-paused+start 才物化」纪律）；
- 数据源 `wire-ops`（只读 + 提案面）：读工具 + `wire_action_propose/status`；
  **写操作永不进工具面直调**（红线不变）；
- 岗位 allowTools 只需 `wire_datasets_list` / `wire_object_*` / `wire_dataset_*` /
  `wire_action_*`（pack 内已声明，如缺由柏讯侧补）；
- 铸造后 **start**，首轮跑在盘账岗（03:10）。

**路径 2**：只发布 pack 到 registry、不铸造（客户自行订阅后由市场通道出舰队）——
则请回执告知，柏讯侧把「内容腿」改为人工/本会话驱动。

**路径 3**：若「直装进 cell」是刻意形态（不经市场），请说明该 cell 的 owner 与
后续升级通道，柏讯侧据此调整验收。

### B3 验收判据（可计数，柏讯侧提供读面证据）

1. `fleets.db` 出现 `本体建设舰队` 行 + 五 `fleet_members`（parent 链
   chief→reviewer→modeler→scout 与 blueprint 一致）；
2. 首轮跑后 `member_turn_events` ≥5 条且 `fleet_runs` ≥1（`status` 如实）；
3. 盘账岗产物可查：对靶 cell（`drillcust001`）至少画像 N 个未绑定实体数据集
   （N 由首轮结果如实报，不预设下限）；
4. 建模/校验/提案腿链路：草案经 `wire_action_propose`（内置 `entity-declare` /
   `entity-relation-declare`）落 pending，owner 确认后实体出现在 `wire_object_search`；
5. 无任何写操作直调（审计台账只应见 propose/confirm，不见直写）。

### B4 边界（不做，避免误配）

- 不接共享源对象（`business-mcp-shared-objects-requirements.md` 仍为只登记、待评审）；
- 不改柏讯平台代码（本需求全程只动壹座/市场/registry 侧）；
- 不要求真实客户开通（靶 cell `drillcust001` 是演练客户）。

## 五、回执与排期

请按 A/B 两段分别回执：A 段给收号与切换时刻；B 段给所选路径（1/2/3）与铸造时刻。
柏讯侧据回执更新 `docs/ROADMAP-v2.md` 0.2 与「本体建设内容腿」两行，并同步记忆台账。

---

## 六、柏讯侧 2026-11-01 只读复核（先验后销）

### B 段：已落地（销账）

- 舰队在 **cell `1da519d4c1c0bf89` 的 `fleets.db`**（非 platform 主库）：
  `本体建设舰队` = `fleet_1793422472811_i28xac`，state=active；
- 五岗齐全且父子链与蓝图一致：`本体盘账员`(ob-scout) → `本体建模师`(ob-modeler) →
  `纪律校验闸`(ob-reviewer) → `声明提案员`(ob-deployer) → `台账主编`(ob-chief)；
  cadence 03:10/03:40/04:10/04:40/05:10 Asia/Shanghai 逐字相符；
- 运行证据：`fleet_runs` **37**、`member_turn_events` **73**（按岗 7/19/16/18/13）、
  `member_reports` **12**；盘账岗首轮自报「`wire_datasets_list` 取靶 cell 全 6 数据集，
  逐集 `wire_dataset_rows` 实读（只读，零写面），画像 15 组候选」；
- 提案腿真闭合：`ai_action_proposals` 里 `entity-declare`/`entity-relation-declare`
  （动作 id -1/-2）10-31 四条 executed；台账第 14 轮记「在册实体 5 个、关系 5 条」；
- **口径修正**：本稿 B1 说的「registry 未在册」不准确——pack 的 `registryName: "wire-ops"`
  是 cell 本地别名，注册表服务名是 `wire-ops-mcp`（22 工具）；pack 是直装进 cell，
  不经市场货架属刻意形态（路径 3）。A3 判据中的「创建舰队」一项按此销账。

### A 段：未发生（继续挂账）

- 壹座仓 change `add-fleet-service-account-cutover`：1.1–1.3、2.1、2.3 已勾，
  **2.2（范围改写）与 3.1–3.3（知会/切换/复核）、4.x 全空**；
- Logto `Interaction.SignIn.Submit` 自 2026-10-29 彩排后无 `svc-fleet-*` 记录；
- 两支 cell 的 `user_line_credentials.wire-customer` 行 token 解码 `sub` 均为真人
  （admin cell `pih8r05mwh8w`、fleet cell `7jbveavwyk1x`），非 `ohvn98ztddjj`；
- 结论：收号/切换/观测起算点三项均未落——A 段球仍在壹座 3.2，柏讯侧不能销 5.1/5.2/6.2。

## 七、壹座侧回执（2026-11-01，A 段三项全落）

- **收号确认：有**。两号口令已带外入库壹座 `.env`（`WIRE_SVC_FLEET_CORE1_PASSWORD`/`WIRE_SVC_FLEET_OPS1_PASSWORD`，gitignored，不回显不入日志）。
- **切换已发生**：2026-11-01 **19:34:11 CST（11:34:11.930Z）**，fleet cell（壹座侧 id `3fdc7b8e8ac03b68`）的 `user_line_credentials.wire-customer` 行原子替换为 `svc-fleet-core-1` 授权链。行键保持 `platform-test@findmail.com`（cell 属主，两层身份），token 解码 `sub=ohvn98ztddjj`、`stale=0`、`hasRefresh=1`（壹座行读实证）。**观测起算点=该时刻**，柏讯护栏日报与计量归属据此起算。
- **双轨窗口：不需要**（单次原子切，design D4；无先铸后切需求）。
- **事实修正（对 §六 A 段）**：切换前基线实测该行**早已断供**——`stale=1`、ID token exp=2026-10-31 10:22 CST（比 RT 14d 推算墙早一周；行 `token_exp` 列存 ID token 自身 exp、由续期网轮换维持，旧链轮换已断）。即 §六「token sub 仍真人」实为「旧链已过期失效」；本次切换同时完成修复。admin cell 真人行（aloadtree）不在本切换范围、保持不动（归壹座每 12 天无条件重铸自动化管）。
- **护栏对表**：铸币窗口 19:33–19:35 CST，UA=`mint-line/paas-1`（tool 类，按 A3-4 应记 ok 不 ALARM）；全程无 Mozilla 前缀会话触碰 svc 双号。红线重申：svc 双号禁人工交互登录/改密/禁用，只有周期重铸触碰。
- **请柏讯按 A3 复核**（24h 窗，起算点 19:34:11）：①grant `accountId=ohvn98ztddjj`；②platform-test/aloadtree 其余活跃链零受影响（对照 10-29 grant 基线）；③用量归属 `svc/fleet-core-1` 服务客户行；④护栏日报 UA 分类。回执后壹座销 3.1/3.3，巡线自然回合证据随 4.2 补录；柏讯侧 5.1/5.2/6.2 可据此销账。
- 壹座侧台账：`docs/registry-maintenance.md` §15.85（2026-11-01）。

## 八、柏讯侧复核回执（2026-11-01，A3 复核 + 销账）

- **收到切换时刻：2026-11-01 19:34:11 CST**（观测起算点接受）。壹座 3.1 所候回复即此条。
- A3 复核（只读实证，全文见
  `openspec/changes/add-fleet-service-accounts/reports/2026-11-01-a3-review-closeout.md`）：
  ① 授权腿 `sub=ohvn98ztddjj` **过**（行读 19:34:11.930Z / stale=0 / hasRefresh=1 / 行键不动；
  Logto `SignIn.Submit` 该 uid 恰 1 条 Success 19:34:07 CST）；② 其余活跃链零受影响 **过**
  （admin cell 真人行切换后自然重铸照常、fleet cell lex 行未动）；③ 用量归属 **挂起待 4.2**
  （切换后尚无自然回合，`pack_usage_events` 无 svc 行，随首轮巡线证据双向补录）；
  ④ 护栏 UA 采信壹座自报（`mint-line/paas-1` 归 ok），起算点起纳入日报对表。
- **事实修正接受**：§六 A 段「token sub 仍真人」实为旧链 stale=1 断供后的残留快照
  （`token_exp`=ID token exp、mint+1h；14d 墙在 RT 侧）——切换兼修复，我方误读订正。
- **销账**：柏讯 5.1/5.2/6.2 本日销（change 随归档落账）；壹座 3.1/3.3 可销（3.3-③ 随 4.2 补录）。
- **边界记录**：切换面=fleet cell `3fdc7b8e` 的 wire-customer 行；本体建设舰队所在 admin cell
  `1da519d4c1c0bf89` 授权腿仍为真人链（壹座自动化管），如需同切由壹座扩 2.2 覆盖，不算 A 段缺口。
