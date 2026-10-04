# cell-manager（v1 仅骨架）

企业 **cell**（隔离单元：独立进程 + 独立数据根，见 [ADR-0002](../docs/adr/0002-cell-is-the-enterprise.md)）的生命周期管理面。

## 职责（v1 目标形态）

- **开通**：为签约企业起一个 cell 容器 + 独立 SQLite WAL 卷（daas.db），并注册进 registry（wire 入口同门计量）
- **暂停 / 恢复**：欠费或客户请求时停容器、保数据；恢复即重启，数据不丢
- **注销**：容器停转，卷进入保留期（默认 30 天，后台可配），到期清除留档、registry 摘除条目
- **升级**：滚动替换 cell 容器镜像（与謙面本地产品同源引擎）

## 边界

- 编排形态参照 agent-runner compose 模式（cheap 集群）；具体实现随任务 5.1 落地
- 平台侧**永不直读**租户 daas.db；跨租户数据一律住平台库
- 对 registry / 计量面只经 HTTP 借用契约（`REGISTRY_URL` 等，见 `api/fd_wire_api/config.py`）
