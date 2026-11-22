# Tasks: polish-wire-ontology-console

## 0. brief 立面

- [x] 0.1 写 `.impeccable/surfaces/wire-ontology-console.md`：Mode=Operate、Direction contract（承接 console-shell token）、管辖组件清单、Facts 边界（API/ACL/动作闸语义不动）
- [x] 0.2 清点 console 既有设计 token 与组件底座，确定空态/错误卡/确认卡的复用底座

## 1. 组件全量扫（每组件四步：检视 → 清单评分 → 批量修 → 确认；可按组件分片并发）

- [x] 1.1 `EntitiesPage.tsx`（含内嵌 DomainActionsPanel）：实体卡、创建表单、关系管理、一键物化、SVG 迷你图、提案状态呈现、空态
- [x] 1.2 `EntityObjectBrowser.tsx`：对象/行/关系浏览、ACL 拒绝文案、空态
- [x] 1.3 `OntologyVersionSection.tsx`：版本列表/diff 高亮/回滚计划/完整性、空版本态

## 2. 低容量时刻专项

- [x] 2.1 0 实体真空态 + 舰队提案引导组件（三处复用）
- [x] 2.2 ACL 403 分型文案（free-tier 闸 / NEED_WRITE 受限端点 / 对象读拒绝）落 brief 并接线
- [x] 2.3 动作闸确认面：提案 pending 状态明示、物化前后果摘要卡（连接键/junction/衍生数据集缺省命名「{左}×{右} 连接」冲突追加序号，成功名以 API 回传为准）

## 3. 跨组件复核

- [x] 3.1 全局一致性终审：token、间距、状态色、空态/错误卡复用一致
- [x] 3.2 行为无关复核：无 API/ACL/动作闸语义变更混入

## 4. 收尾

- [x] 4.1 验收报告 `reports/<date>-ontology-console-sweep.md`：逐组件逐项计数
- [x] 4.2 `openspec validate polish-wire-ontology-console --strict` 过绿
