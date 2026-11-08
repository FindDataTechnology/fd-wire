# add-evidence-gate-kind-split — Tasks

- [x] 1.1 `EvidenceGateSettings` 增 `kind_overrides`（`EVIDENCE_GATE_KIND_OVERRIDES`，JSON 字符串或 dict）+ `mode_for(kind)`；坏值忽略并记告警
  - 证据：`api/fd_wire_api/artifacts/evidence.py`（含「为什么纯数据看板不该被 info-stream 门拦」的注释）
- [x] 1.2 `publish_artifact` 改用 `mode_for(artifact.kind)` 取生效模式（显式 `gate_mode` 优先级最高，测试注入行为不变）
  - 证据：`api/fd_wire_api/artifacts/service.py`
- [x] 2.1 测试三条：默认不覆盖（零回归）/ 只降指定 kind（doc 仍 enforce）/ 坏 JSON 与非法模式忽略
  - 证据：`api/tests/test_artifact_evidence.py` 新增 3 条；artifact 相关 165 项全绿
- [x] 3.1 部署清单显式开 `{"dashboard":"warn"}`
  - 证据：`deploy/k8s/fd-wire-api.yaml`（附裁决理由注释）
- [x] 3.2 出片上产 + in-pod 实证
  - 证据：快照仓 `law-ai-official/fd-wire-images` 出片 `sha-e76fd47`；ccr 落地经 skopeo 硬门（digest `sha256:ba2bb6eb…`，10 层）；ArgoCD 滚版 `deployment "fd-wire-api" successfully rolled out`；in-pod 读回 `mode=enforce / kind_overrides={'dashboard':'warn'} / dashboard→warn / doc→enforce`
- [x] 3.3 真实发布验证（不传 gate_mode）
  - 证据：重新发布花卉三块板（id 194/195/196）成功，日志出现 `evidence_gate warn {artifact_id:196, claim_count:1}` —— 只告警不阻断
