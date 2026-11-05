# 任务：cell 开通自助化

## 1. 端点解析 DB 兜底

- [ ] 1.1 表 `customer_cell_endpoints`（customer_id 唯一/endpoint_url/state/created_at）+迁移 0053
- [ ] 1.2 `resolve_cell_endpoint` 读路径：env map 显式优先（语义与测试不变）→未命中查 DB 表→仍未命中 None；测试三源断言
- [ ] 1.3 admin 配给状态页（请求列表/状态徽标/失败原因可见）

## 2. 配给编排

- [ ] 2.1 表 `cell_provision_requests`（customer_id 幂等键/state queued|running|done|failed/steps jsonb/error/created_at）+迁移
- [ ] 2.2 升档动作挂接：admin 改档至含 cell 档位时落 queued 行+运营邮件提醒
- [ ] 2.3 内部端点 `POST /internal/cell-provision/next`（领队头任务→running，X-Internal-Token 闸）+ `POST /internal/cell-provision/{id}/result`（回写 done/failed+endpoint_url 落 DB 表）
- [ ] 2.4 cheap1 `cell-manager runner` 子命令：轮询→provision+grant→relay（socat 复用既有配方）→PATCH registry→回写；任一步失败整体标 failed 留 step 痕；幂等（同 customer 重跑先查现态）
- [ ] 2.5 cheap1 systemd timer（每 5 分钟）+ runner 审计进 cell-manager audit 面

## 3. 测试与收口

- [ ] 3.1 api 测试：三源解析/升档落队/领任务幂等/回写落 DB 表/失败回退人工链
- [ ] 3.2 cheap1 全量测试绿（runner 用例：fake driver 全链）
- [ ] 3.3 strict+归档；实弹演练：drill 客户升档→自动配给→AI 构建可用→全链零手工（沿 P1-12 演练纪律）
