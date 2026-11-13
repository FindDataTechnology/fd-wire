# 带迁移的发布 runbook（以 0054/0055 为实例）

**一句话**：镜像里没有 `alembic/`，也没有 `alembic.ini`，所以迁移**不能**在 pod 里跑，
必须先从一份 checkout 对生产库执行，再滚镜像。顺序反了不是"慢一点"，是**实体面全 500**。

本文所有命令都在 2026-11-13 实测过（pod 内 `os.getenv`、Secret 值、`alembic_version` 表、
镜像 Dockerfile 的 COPY 清单）。

---

## 0. 为什么必须"先迁移、后滚片"

| 事实 | 判据 |
| --- | --- |
| 生产库头 = `0053_cell_provision` | pod 内 `select version_num from alembic_version` |
| 0054 加 `ontology_events.target_key`；0055 给 `entities` / `entity_relationships` 加 `kernel_attrs` | 迁移文件的 `upgrade()`；两处都是**可空列、零回填** |
| `versioning.record_event()` **无条件**写 `target_key` | 每次本体事件插入都会带这一列 |
| `kernel_attrs` 是 ORM 映射列 | 任何 `select(Entity)` 的 SELECT 里就带着它 ⇒ 连**读**都会炸 |
| 启动建表只建**表**、不建**列** | `create_all` 语义；`verify_schema()` 只比表名 |
| 实体切片的生产开关 | Secret `fd-wire-env`: `boot_auto_create_tables=0`、`boot_schema_check=warn` |

⇒ 新片先上、迁移后补：INSERT/SELECT 命中不存在的列 → `UndefinedColumn` → 实体面 500。
⇒ 指望启动补救也不行：`create_all` 不加列，`verify_schema` 也不看列（`strict` 同样不看）。

---

## 1. 前置检查（只读，两分钟）

```bash
# 1.1 生产库头
kubectl --context cheap -n fd-prod exec deploy/fd-wire-api -- python -c "
import os, sqlalchemy as sa
e = sa.create_engine(os.environ['DATABASE_URL'])
print([r[0] for r in e.connect().execute(sa.text('select version_num from alembic_version'))])"
# 期望：['0053_cell_provision']（不是就在此停下，别继续）

# 1.2 迁移链与头对齐（本地 checkout）
git fetch gitee main && git log --oneline -1 gitee/main
cd api && python -m alembic heads          # 期望单一 head：0055_ontology_kernel_attrs
python -m alembic history -r 0053_cell_provision:head   # 期望恰好 0053→0054→0055

# 1.3 侧写：确认两处迁移都是可空加列（不是表重建）
grep -n "nullable=True\|add_column" alembic/versions/20261112_0054_*.py alembic/versions/20261112_0055_*.py

# 1.4 依赖同线：本机 uv.lock 的 sqlalchemy 不得低于镜像实际装的那版
kubectl --context cheap -n fd-prod exec deploy/fd-wire-api -- \
  python -c "import sqlalchemy;print(sqlalchemy.__version__)"   # 期望 2.1.8
cd api && uv lock --check   # 期望静默通过；报 "lockfile needs to be updated" 就是本地锁落后
```

判据：**1.1 的头必须等于 1.2 里 `history` 的起点**。不等就说明有别的发布插过队，
按实际头重算范围，别硬跑 `upgrade head`。

1.4 为什么要看：镜像是 `pip install '.[mongo]'` 现解范围（拿最新 2.1.x），
本地 `uv sync` 只认 `uv.lock`。两边不同线时，本地全绿的套件在线上语义下会红
——2026-11-13 实测：锁 2.1.3 允许「close 后再用同一个 Session」，线上 2.1.8 抛
`ResourceClosedError`，于是夹具把同一个 Session 当工厂的 bug 在本地一直是绿的
（见 `tests/test_artifact_marketplace.py` 的 `ds_engine`）。下限已钉到 `>=2.1.8,<3`。

---

## 2. 迁移（唯一需要写生产的一步）

镜像里没有 `alembic/`（Dockerfile 只 COPY `fd_wire_api` / `fd_mcp_client` / `scripts`），
所以在本机或 CI 上用一份 checkout 直连生产库：

```bash
cd api
export FD_WIRE_DATABASE_URL='postgresql+psycopg://…'   # 与 pod 内 DATABASE_URL 同库
python -m alembic current        # 复核：0053_cell_provision
python -m alembic upgrade head   # 0053 → 0054 → 0055
python -m alembic current        # 复核：0055_ontology_kernel_attrs
```

要点：

- **`FD_WIRE_DATABASE_URL` 优先于 `DATABASE_URL`**（`alembic/env.py` 的解析顺序：
  `-x db_url=` > `FD_WIRE_DATABASE_URL` > `DATABASE_URL` > 本地 sqlite 默认）。
  两个都设时以它为准——设错一个就会迁到错库，所以下面这条是必须的：
- **跑之前先确认连的是哪个库**：`python -m alembic current` 输出的头必须等于第 1 步
  读到的生产头。不一致 = 连错库，立刻停。
- 两列都是 `ADD COLUMN … NULL`（无默认值）：PG 上是元数据级操作，不重写表、不停写，
  但会短暂取 `ACCESS EXCLUSIVE` 锁——避开写高峰即可，不需要维护窗口。
- 迁移是**幂等**的（`_has_table` / 加列前先查），重跑安全。

回滚：`python -m alembic downgrade 0053_cell_provision`（两处都只删列），但删列会丢
`target_key` / `kernel_attrs` 已写的数据——除非确认新片没写过，否则别回滚，向前修。

---

## 3. 滚片

### 3.1 先定走哪条出片线——**main 不能走公开线**

| 要出的树 | 走哪条 | 为什么 |
| --- | --- | --- |
| 不含内核 wheel（≤ `7b2dfc3` 那类） | 公开快照仓 `scs001/fd-wire-images`（免费无限） | 公开面无源码风险 |
| **`main`（含 `api/vendor/fd_ontology_kernel-*.whl`）** | **私有构建池**，如 `testaction001/build-pool` | 公开仓会把内核源码推成永久公开 |

判据不看推测看事实：`main` 的 `pyproject.toml` 钉着 `fd-ontology-kernel`、
`Dockerfile` 用 `--find-links ./vendor` ⇒ 镜像离不开那个 wheel。

```bash
# 私有池出片（pd-build-snapshot 会用 git archive 只导已提交树，不含未跟踪文件）
fd-build-snapshot ~/finddata/fd-wire -R testaction001/build-pool \
  --namespace fd-wire --image api --dockerfile api/Dockerfile --context api
# 四个变量必须给齐：池是共享的，别的会话一推就会把 DF/CONTEXT 盖成他们的子目录
# 出片 tag = 快照仓 commit 短 sha（不是源码 sha）；本仓历史上就这么出过片
# （清单注释里的 `testaction001 build-pool 快照 sha=24994bc / 1807a2e`）
```

### 3.2 改清单并核对线上实况

```bash
# tag 用镜像仓 sha；先看线上实况，避免把别人的新片回退成自己的旧片
kubectl --context cheap -n fd-prod get deploy fd-wire-api \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
```

# 3.3 提交后 Argo hard refresh（应用 all-services-prod，盯 gitee main）
kubectl --context cheap -n argocd annotate app all-services-prod \
  argocd.argoproj.io/refresh=hard --overwrite
kubectl --context cheap -n argocd get app all-services-prod \
  -o jsonpath='{.status.sync.status} {.status.sync.revision}{"\n"}'
```

---

## 4. 上片后验收（每条都要看内容，不看状态码）

```bash
# 4.1 镜像已换、Pod 就绪
kubectl --context cheap -n fd-prod get deploy fd-wire-api \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"  "}{.status.updatedReplicas}/{.status.replicas}{"\n"}'

# 4.2 启动日志里没有缺表告警（warn 模式只会记日志，不会拦）
kubectl --context cheap -n fd-prod logs deploy/fd-wire-api --tail=200 | grep -E "boot.schema|ImportError|UndefinedColumn" || echo "clean"

# 4.3 列真的在了（缺列时 /health 照样 200，只有这条会红）
#
# 为什么不用 HTTP：`GET /api/v1/entities` 要 console 会话，无令牌直接 401——
# 401 根本不发 SQL，证明不了列。改用 pod 内纯 SQL 探针，不 import 应用包
# （旧片里连 fd_wire_api.entities.models 都导不进来，见第 5 节）。
# 注意每条列各开一个连接：PG 事务一报错就整块 aborted，后面的查询全废。
kubectl --context cheap -n fd-prod exec deploy/fd-wire-api -- python -c "
import os, sqlalchemy as sa
e = sa.create_engine(os.environ['DATABASE_URL'])
for t, col in [('ontology_events','target_key'),('entities','kernel_attrs'),('entity_relationships','kernel_attrs')]:
    with e.connect() as c:
        try:
            c.execute(sa.text(f'select {col} from {t} limit 0')); print(f'  OK      {t}.{col}')
        except Exception as exc:
            print(f'  MISSING {t}.{col}  <- {type(exc).__name__}')
with e.connect() as c:
    print('alembic head:', [r[0] for r in c.execute(sa.text('select version_num from alembic_version'))])"
# 期望：三行 OK + head = 0055_ontology_kernel_attrs

# 4.4 冷启动导入矩阵（本次新增的判据，防止导入环回归）
cd api && python -m pytest tests/test_cold_imports.py -q
```

**判据要点**：`/health` 与 `kubectl get pods` 全绿**不能**证明迁移到位——缺列时它们
完全正常，只有实体面的查询会 500。4.3 那条探针是唯一能判死的。

**2026-11-13 实跑（迁移前）**：三列均为 `MISSING`、head `0053_cell_provision` ——
说明这条判据有区分力（迁移后必须三行 `OK`），也说明现在这版库里确实缺列。

---

## 5. 本次发布特有的两件事

1. **导入环**：`datasets/ingest → ai → entities → data_plane → datasets.ingest` 等三条
   在**旧片（7b2dfc3）里仍活着**。修在 `70eaeaf`，随本次上片生效。在此之前的旧片里跑
   任何单独脚本都可能撞 `ImportError`——那是既有缺陷，不是本次引入。
2. **`entities` 已接进 `db_policy`**（`b60eae6`）：生产 `boot_auto_create_tables=0` 现在对这个
   切片也生效（此前它自己默认开）。这意味着上片后实体两表**不再**有启动建表兜底——
   迁移必须先跑完（第 2 步），这是本 runbook 顺序不可交换的第二个理由。
