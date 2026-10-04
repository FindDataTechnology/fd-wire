# cell-manager（v1 已落地：任务 5.1）

企业 **cell**（隔离单元：独立容器进程 + 独立数据根，见 [ADR-0002](../docs/adr/0002-cell-is-the-enterprise.md)）的生命周期管理面。

- cell = 企业：一个容器实例 + 一个独立 SQLite WAL 数据卷（`daas.db`）+ 一条 registry server 条目（`fd-wire-cell-<customer_id>`，wire 入口同门计量）
- 平台侧**永不直读**租户 daas.db；跨租户数据一律住平台库
- 对 registry / 计量面只经 HTTP 借用契约（`CELL_REGISTRY_URL` 等，参照 `api/fd_wire_api/config.py` 纪律）

## 状态机

```
(不存在) --provision--> ACTIVE
ACTIVE   --pause------> PAUSED        （容器停，卷保留）
PAUSED   --resume-----> ACTIVE        （原卷重启）
ACTIVE|PAUSED --deprovision--> RETENTION（purge_at = now + CELL_RETENTION_DAYS，默认 30 天）
RETENTION --cancel-deprovision--> ACTIVE（保留期内反悔，卷未动）
RETENTION --到期 purge--> (不存在)    （删容器 + 删卷 + 摘 registry 条目；审计留档不可逆）
```

- `provision` 幂等：已 ACTIVE 重入为 no-op 返回现状；PAUSED / RETENTION 重入给明确指引错误
- `status`：`not_found` / `active` / `paused` / `retention`（含 `days_remaining` 剩余天数）
- 全部变更操作（含失败）追加 JSONL 审计：`<home>/audit/audit.log`，字段 `ts / action / customer_id / result(ok|error) / detail`
- 升级（滚动替换镜像）沿既有形态：deprovision 之外后续以镜像重指 + recreate 增量落地，不在 5.1 范围

## 包结构

```
cell-manager/
├── pyproject.toml            # 零运行时依赖（stdlib only）；docker 为可选 extra
├── cell_manager/
│   ├── __init__.py           # 公共 API + 与 CLI 同名的库函数
│   ├── __main__.py           # CLI（python -m cell_manager ...）
│   ├── config.py             # env 配置（全部 CELL_* 可覆盖）
│   ├── manager.py            # CellManager 状态机
│   ├── state.py              # cells.json 簿记（原子写）
│   ├── audit.py              # JSONL 审计日志
│   ├── db.py                 # 空库 + WAL 模式初始化（平台侧唯一触碰点）
│   ├── drivers/              # ContainerDriver 协议
│   │   ├── base.py           #   协议 + ContainerSpec/Info/BindMount
│   │   ├── docker.py         #   DockerDriver（docker SDK 惰性导入）
│   │   └── fake.py           #   FakeDriver（内存态，可落盘，测试/演示）
│   └── registry/             # RegistryClient 协议
│       ├── base.py           #   协议 + ServerEntry
│       ├── http.py           #   HttpRegistryClient（urllib，契约占位、任务 5.2 对齐）
│       └── fake.py           #   FakeRegistryClient
└── tests/                    # 全 Fake，不打真 docker / registry
```

## 驱动抽象

- **ContainerDriver 协议**（`drivers/base.py`）：`create(spec) / start(name) / stop(name) / remove(name, force) / exists(name) / inspect(name)`
  - `DockerDriver`：docker SDK **惰性导入**——未装 SDK 时 `import` 本包不炸、实例化才报 `DriverError`（带安装指引）；daemon 不可达同样在实例化期包装报错
  - `FakeDriver`：内存容器表（create 重名报错 / start-stop 幂等 / remove 运行中须 force / inspect 暴露 env+mounts 供隔离断言）；`persist_path` 可选落盘，CLI 跨进程演示用
- **RegistryClient 协议**（`registry/base.py`）：`register(entry)` / `unregister(path) -> bool`（不存在宽松返回 False）
  - `HttpRegistryClient`：stdlib urllib；端点 env 可重指，**契约占位**（`POST {CELL_REGISTRY_URL}/api/servers`、`DELETE .../api/servers/{path}`），真实 fork API 由任务 5.2 联调对齐
  - `FakeRegistryClient`：内存条目表 + 调用记录
- 工厂：`build_driver(config)` / `build_registry_client(config)` 按 `CELL_DRIVER` / `CELL_REGISTRY_MODE` 选择形态

## 使用

### CLI

```bash
python -m cell_manager provision  <customer_id>   # 开通（幂等）
python -m cell_manager pause      <customer_id>   # 暂停（数据保留）
python -m cell_manager resume     <customer_id>   # 恢复
python -m cell_manager deprovision <customer_id>  # 申请注销 → 保留期
python -m cell_manager cancel-deprovision <customer_id>  # 保留期内恢复
python -m cell_manager status     <customer_id>   # 状态查询
python -m cell_manager purge-expired              # 清除到期 retention cell（定时任务）
```

输出一律 JSON；成功 exit 0，失败 exit 1 且 `{"ok": false, "error": {"type", "message"}}`。

### 库

```python
from cell_manager import provision, pause, resume, deprovision, cancel_deprovision, status, purge_expired
# 或注入式：
from cell_manager import CellManager, CellManagerConfig, FakeDriver, FakeRegistryClient
manager = CellManager(driver=..., registry=..., config=CellManagerConfig.from_env(), clock=...)
```

### 本机无 docker 的全生命周期演示

```bash
export CELL_DRIVER=fake CELL_REGISTRY_MODE=fake CELL_MANAGER_HOME=/tmp/cell-demo
python -m cell_manager provision acme && python -m cell_manager status acme
```

## 配置（env）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CELL_MANAGER_HOME` | `~/.fd-wire/cell-manager` | 管理面根（卷/簿记/审计都在其下） |
| `CELL_DATA_ROOT` | `<home>/volumes` | 数据卷根；每 cell 一个 `<data_root>/<customer_id>/daas.db` |
| `CELL_STATE_FILE` | `<home>/state/cells.json` | 生命周期簿记（原子写） |
| `CELL_AUDIT_LOG` | `<home>/audit/audit.log` | JSONL 审计留档 |
| `CELL_IMAGE` | 占位镜像名 | cell 容器镜像（部署时指 TCR 真实镜像） |
| `CELL_GATEWAY_URL` | wire 占位 | 注入容器 `WIRE_GATEWAY_URL`（同门计量入口） |
| `CELL_REGISTRY_URL` | registry 占位 | registry 借用契约地址 |
| `CELL_REGISTRY_MODE` | `http` | `http` \| `fake` |
| `CELL_TARGET_URL_TEMPLATE` | `http://{container_name}:8000/mcp` | registry 条目 target 模板 |
| `CELL_RETENTION_DAYS` | `30` | 注销保留期（0=立即到期） |
| `CELL_DRIVER` | `docker` | `docker` \| `fake` |
| `CELL_REGISTRY_SERVERS_PATH` / `CELL_REGISTRY_TOKEN` | - | HTTP registry 契约微调 |

容器 env 隔离注入：`DAAS_DATABASE_URL=sqlite:////data/daas.db`（指向本 cell 卷挂载）+ `WIRE_GATEWAY_URL`（wire 入口）。卷以 bind mount 挂到容器 `/data`。

## 隔离保证

- 每 cell 独立卷目录（`<data_root>/<customer_id>/`）、独立容器名与 registry 条目路径（`fd-wire-cell-<customer_id>`），互不重叠
- `customer_id` 白名单校验（`[A-Za-z0-9][A-Za-z0-9._-]{0,63}`，首字符字母数字）——杜绝路径逃逸
- 平台侧唯一触碰卷的代码是 `db.py:init_volume`（建空库+开 WAL），不读写业务数据

## DockerDriver 部署注意（给上线时）

1. **SDK**：生产镜像装 `pip install '.[docker]'`；缺 SDK 只在实例化报错（本机开发/CI 用 `CELL_DRIVER=fake`）
2. **daemon 访问**：cell-manager 容器需挂载 `/var/run/docker.sock`（或 `DOCKER_HOST` 指远程 daemon）；注意 docker.sock 等于宿主 root 权限——建议 sidecar proxy（如 tecnativa/docker-socket-proxy）只放行 containers API
3. **bind mount 路径是 daemon 侧路径**：`CELL_DATA_ROOT` 必须在 daemon 可见的文件系统上；cell-manager 与 cell 卷放同一共享卷面（compose/k8s local-path 同款约束）
4. **镜像**：`CELL_IMAGE` 默认是占位——部署时指 TCR 里 fd-daas-mcp 真实镜像（任务 1.2 发版产物）
5. **registry 契约**：`HttpRegistryClient` 端点/字段为占位，任务 5.2（cell 注册进 registry）联调时对齐 fork API 后仅需改 `registry/http.py`
6. **purge 调度**：`purge-expired` 需外部定时触发（cron/k8s CronJob 建议 1 次/天）；到期判定以簿记 `purge_at` 为准，`CELL_RETENTION_DAYS` 只在 deprovision 时刻生效
7. **单写者假设**：簿记 cells.json 无跨进程锁——同一 home 只允许一个 cell-manager 实例操作（k8s 单副本 Deployment + `strategy: Recreate`）

## 测试

```bash
cd cell-manager && python3 -m pytest
```

覆盖：provision 幂等 / 两企业 cell 并存隔离（卷、容器名、FakeDriver mounts 互不可见）/ pause 数据保留 / deprovision→retention 剩余天数 / 到期 purge（卷删+registry 摘除+审计留档）/ 保留期内 cancel 恢复 / 审计追加（含失败留痕）/ 未知客户 status / DockerDriver 惰性导入纪律 / CLI 子进程全生命周期。全 Fake，零 docker、零网络。

## 边界（后续任务）

- 任务 5.2：registry 真实契约联调（注册/摘除字段对齐）、wire 入口可达性验证
- 任务 5.3：cell 内跑 fd-daas-mcp（161 工具），`DAAS_DATABASE_URL` 消费方验证
- 存储演进：`DAAS_DATABASE_URL` 重指专属 PG database（先 spike 后迁移，ADR-0002）
