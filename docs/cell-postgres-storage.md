# cell 数据根 PostgreSQL 后端配方（wire-cell-postgres-storage · 建库/迁移/回退）

> 读者：**我方运维 / 未来的自己**。本文是手工运维配方——cell 数据根从
> 「每 cell 一个 SQLite 文件卷」升级为**可选 PostgreSQL 后端**（一 cell 一库），
> 怎么建库、怎么接线迁移、怎么回退，逐条可执行。v1 只做引擎能力 + drill
> 试点搬迁，**存量客户 cell 一律不动**。
>
> 关联：平台侧凭据纪律见 `docs/service-credentials.md`；PG 实例本身的
> 运维（升级/监控/备份）见 `deploy/wire-postgres/README.md`；变更动机与
> 引擎设计见 `openspec/changes/wire-cell-postgres-storage/`。

## 1. 这是什么、为什么

**cell 数据根** = cell 引擎（fd-daas-mcp）落客户数据的那个库：客户数据集表、
事件 WAL、审计、gateway upstream 行，全在这一个库里。

- **现状**：每 cell 一个 SQLite 文件，躺在该 cell 自己的 `/data` 卷里
  （cheap-1 上即 `/opt/cell-manager/volumes/<key>/daas.db`）。打个比方：
  每家客户一台**自带保险柜**，摆在自家房间（容器卷）里——简单够用，
  但备份、并发、容量都只能靠文件系统硬扛。
- **升级**：把保险柜搬进**银行的保管库**——同一个 PG 实例（一栋楼），每家
  客户仍然是一个独立的保险柜（**一 cell 一库**），钥匙（属主凭据）只有
  这家客户自己的 cell 引擎有。楼是可选的：不配 env 的 cell 继续用自己的
  保险柜，什么都不变。

### 1.1 为什么是「一 cell 一库」，不是「一库多 schema」

同样是集中存放，一 cell 一库的隔离更**硬**：

- **库级 ACL 是 PG 的硬边界**：CONNECT 权限长在库上，`REVOKE` 之后外人
  **连都连不进**；schema 只是库内的命名空间，权限模型琐碎、容易漏一格。
  类比：每个保险柜有自己独立的锁；而不是一个大柜子里隔出抽屉、
  靠「说好只开自己抽屉」。
- **可独立备份 / 恢复 / 丢弃**：一家退租 = `DROP DATABASE` 一条命令；
  一家要恢复 = 单独灌它自己的备份，不碰别家。保险柜可以整只搬走、
  整只销毁，不用在共用大柜子里小心抽出属于某一家的格子。
- 平台已有的 `wire_platform` / `wire_datasets` 也是同实例不同库，同款纪律。

### 1.2 不变量：不带 PG env 的 cell 一切照旧

引擎按 env 走：`DAAS_DATABASE_URL` 未设置（或仍指 sqlite）时，entrypoint
落默认值 `sqlite:////data/daas.db`（卷内文件），**行为与数据零变化**。
镜像里多装一个 psycopg 驱动 ≠ 启用——升级 cell 镜像本身不影响任何存量
cell，这是本变更的第一不变量。

## 2. 红线重述（动手前先读）

1. **平台侧永不直读 cell 数据**（读必经引擎工具）。PG 化后这条从「约定」
   升为**数据库 ACL**：cell 库属主凭据只归该 cell 引擎；平台 api/管理角色
   对 cell 库**无 CONNECT 权限**。对应 ROADMAP 方向 A 红线①原文：
   「cell 库属主凭据只归该 cell 引擎，平台管理角色策略禁读业务数据」。
   - **诚实的边界**：本实例超管角色 `wire` 理论上能连任何库——PG 设计里
     超管旁路一切权限检查、不可剥权。因此纪律上写死：**平台角色/超管只做
     DDL 运维（建库、备份、改配额），禁止 SELECT cell 业务表**。ACL 挡住
     一切非超管路径，纪律挡住超管路径——双保险，缺一不可。
2. **永不写回客户源**：连接器同步通道永远只读客户源。本变更只动「wire 侧
   数据存哪」，不动「客户源怎么读」，该红线不受影响。
3. **凭据纪律**：cell 库属主密码**不进 git、不进镜像、不进对话/日志/文档
   正文**（本文所有密码位置都是占位符，命令均不回显明文）。宿主侧只落在
   0600 的 env-file，与 wgk- 客户凭据同纪律；台账（`~/finddata/secrets`）
   登记「在哪、谁发的、何时」，不登记明文。

## 3. 建库配方（cheap-3 · wire-postgres 实例）

### 3.1 实例信息

| 项 | 值 |
|---|---|
| 所在机器 | cheap-3 |
| 容器 | `wire-postgres`（docker compose，pg16-trixie 钉版；容器内 PG 端口 5432，宿主映射 …:5433） |
| 超管角色 | `wire`（即 `POSTGRES_USER`；api 双库目前也用它连接） |
| 已有库 | `wire_platform`（api 元数据）、`wire_datasets`（数据集库） |
| 集群内地址 | `100.64.0.12:5433`（cheap-1 上的 cell 引擎经此连入） |
| 每日备份 | 03:30 UTC `backup.sh`——**只备两个平台库，cell 库要自己加清单（见 3.6）** |

### 3.2 一次性基线：平台两库同样撤掉 PUBLIC CONNECT（首次执行本配方时做一次）

```bash
# 在 cheap-3 宿主执行（cheap-3 部署目录即 /opt/wire-postgres 所在主机）
docker exec wire-postgres psql -U wire -d postgres \
  -c 'REVOKE CONNECT ON DATABASE wire_platform, wire_datasets FROM PUBLIC;'
```

为什么：PG 默认**任何能登录的角色都能 CONNECT 任何库**。不撤这条，
3.4 验证②的「cell 属主连平台库应被拒」就不成立（能连进去、只是读不了表）。
当前两库只有超管 `wire` 在用（超管不受 REVOKE 影响），无副作用；未来若给
平台侧建非超管连接角色，需对其显式 `GRANT CONNECT`。

### 3.3 每 cell 三条命令（含密码纪律）

把 `<key>` 换成 cell key（如 drillcust001）。密码用
`openssl rand -hex 24` 生成（48 个十六进制字符——hex 字符集放进 URL
**无需转义**，这也是选 hex 的原因之一）：

```bash
# 在 cheap-3 宿主执行
KEY=drillcust001
PW=$(openssl rand -hex 24)   # 管道用法：openssl 输出直接进 shell 变量——不回显、不落盘

# 密码经 heredoc 展开、走 docker exec 的 stdin 进 psql：
# 不出现在命令行参数里（命令行参数会短暂暴露在宿主 ps 里）
docker exec -i wire-postgres psql -U wire -d postgres -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE wire_cell_${KEY} LOGIN PASSWORD '${PW}';
CREATE DATABASE wire_cell_${KEY} OWNER wire_cell_${KEY};
REVOKE CONNECT ON DATABASE wire_cell_${KEY} FROM PUBLIC;
SQL
# 成功输出三行：CREATE ROLE / CREATE DATABASE / REVOKE
# 密码此后还要去 cheap-1 落 env-file（见 4.2）；传完再 unset PW
```

三条命令各自的意义：

| 命令 | 作用 |
|---|---|
| `CREATE ROLE wire_cell_<key> LOGIN PASSWORD …` | 这个 cell 专属的登录角色（钥匙的持有者身份） |
| `CREATE DATABASE wire_cell_<key> OWNER …` | 专属库，属主就是上面的角色（有它才有整只保险柜） |
| `REVOKE CONNECT … FROM PUBLIC` | 撤掉「任意登录角色默认可连」的 PG 默认（上锁，见 3.5） |

台账登记：cell key、角色/库名、生成日期、密码存放位置（cheap-1 env-file
路径）、责任人——**不登记密码明文**。

### 3.4 隔离验证（一等公民步骤，两查都过才算建好）

**验证①：无授权角色连不进 cell 库**（「平台侧/任何其它角色」的化身——
用临时金丝雀角色实测，比看 ACL 字符串更硬）：

```bash
# 在 cheap-3 宿主执行；KEY 变量沿用 3.3
docker exec wire-postgres psql -U wire -d postgres \
  -c "CREATE ROLE probe_nogrant LOGIN;"

# 查询式确认（对金丝雀角色，CONNECT 应为 f）
docker exec wire-postgres psql -U wire -d postgres -Atc \
  "SELECT has_database_privilege('probe_nogrant', 'wire_cell_${KEY}', 'CONNECT');"
# 预期输出：f

# 实连确认（容器内 unix socket 是 trust 认证，走到的正是 ACL 这道闸）
docker exec wire-postgres psql -U probe_nogrant -d wire_cell_${KEY} -c 'select 1;'
# 预期输出（退出码非 0 即通过）：
#   psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed:
#   FATAL:  permission denied for database "wire_cell_drillcust001"
#   DETAIL:  User does not have CONNECT privilege.

docker exec wire-postgres psql -U wire -d postgres -c "DROP ROLE probe_nogrant;"
```

对照说明：同一查询对超管恒为 `t`——

```bash
docker exec wire-postgres psql -U wire -d postgres -Atc \
  "SELECT has_database_privilege('wire', 'wire_cell_${KEY}', 'CONNECT');"
# 预期输出：t（超管旁路一切 ACL，这正是 §2 纪律条款存在的原因；
# 「能连」≠「可读」——超管禁 SELECT 业务表）
```

**验证②：cell 属主凭据只能进本库**（正向能进 + 越库被拒；走容器内 TCP，
顺带验证口令本身可用）：

```bash
# PW 变量沿用 3.3（若已 unset，read -rs PW 重新手输一次，不回显）
export PGPASSWORD="$PW"
# 注意 -e PGPASSWORD 不带等号：从当前 shell 环境透传进容器，口令不进命令行

# 正向：进本库
docker exec -e PGPASSWORD wire-postgres \
  psql "host=127.0.0.1 port=5432 dbname=wire_cell_${KEY} user=wire_cell_${KEY}" \
  -Atc 'select current_user, current_database();'
# 预期输出：wire_cell_drillcust001|wire_cell_drillcust001

# 反向：连平台库 wire_platform → 依赖 3.2 的一次性基线 REVOKE
docker exec -e PGPASSWORD wire-postgres \
  psql "host=127.0.0.1 port=5432 dbname=wire_platform user=wire_cell_${KEY}" \
  -Atc 'select 1;'
# 预期输出（非 0 退出即通过）：
#   psql: error: connection to server at "127.0.0.1", port 5432 failed:
#   FATAL:  permission denied for database "wire_platform"
#   DETAIL:  User does not have CONNECT privilege.

unset PGPASSWORD PW
```

### 3.5 机制解释（为什么这几条命令就够）

- **`REVOKE … FROM PUBLIC` 挡的是什么**：PG 默认给 PUBLIC（= 任意能登录的
  角色，包括平台侧未来新建的任何角色）开了所有库的 CONNECT——连通≠能读表，
  但「连都连不进」是更硬的边界。撤掉之后，想进 cell 库只有一条路：
  显式 `GRANT CONNECT`（本配方永远不做）。
- **属主凭据的权限面**：`OWNER` 只在本库是全权（建表、读写），出了本库
  连 CONNECT 都没有（验证②）——这正是「钥匙只开自家保险柜」。
- **超管边界**：`wire` 超管不可剥权、理论上能连（验证①的对照查询恒 t）。
  所以红线①的落地 = **ACL（挡非超管）+ 纪律（超管只做 DDL、禁读业务表）**
  双保险，见 §2。

### 3.6 备份清单（建完库立刻做，否则这个库没有每日备份）

`deploy/wire-postgres/backup.sh` 的库清单目前是硬编码的两行
（`wire_platform` + `wire_datasets`）。每迁一个 cell 库，把
`backup.sh` 里的循环清单加上 `wire_cell_<key>`（其余不动），当天手工跑
一遍确认产出 `backups/wire_cell_<key>-*.sql.gz`。恢复演练同
`deploy/wire-postgres/README.md` §四（库名换成 cell 库即可——一 cell 一库
在这里兑现：单库可独立恢复）。

### 3.7 引擎侧 URL 形态（cell 看到的最终样子）

```
DAAS_DATABASE_URL=postgresql+psycopg://wire_cell_<key>:<密码>@100.64.0.12:5433/wire_cell_<key>
```

- env 名 **`DAAS_DATABASE_URL`**：引擎数据根总开关。
- cell 镜像 entrypoint 对它是「**有就用**」：未设时才落默认
  `sqlite:////data/daas.db`（这就是 §1.2 不变量的机制）。
- 驱动写 **`postgresql+psycopg`**（psycopg3，镜像白名单
  `psycopg[binary]>=3.1`）；不要写 psycopg2 形态。
- 密码是 hex（无特殊字符），可直接进 URL，无需百分号转义。

## 4. cell 侧接线与迁移（cheap-1 · docker 直跑形态）

### 4.1 现状盘点（drill cell）

| 项 | 值 |
|---|---|
| 容器名 | `fd-wire-cell-drillcust001` |
| 镜像 | `ccr.ccs.tencentyun.com/fd-wire/cell:<tag>`（迁移时换成带 psycopg 的新 tag，见 4.2） |
| 卷 | `/opt/cell-manager/volumes/drillcust001:/data`（sqlite 卷；**迁移后不清不删 = 回退保底**） |
| 网络 | `mcp-gateway-registry_default` |
| 重启策略 | `unless-stopped` |
| env | `WIRE_CUSTOMER_KEY`（env-file 中的 wgk- 客户凭据，**值永不进文档**）等；当前**没有** `DAAS_DATABASE_URL`（默认 sqlite） |

### 4.2 重建配方：env 落成 env-file，再加 PG URL

现状凭据在容器 env 里；借这次迁移把 env 固化成宿主 env-file（一次性动作，
之后轮换/回退都只改文件重建）：

```bash
# ---- 在 cheap-1 宿主执行 ----
KEY=drillcust001
CTR=fd-wire-cell-${KEY}
ENVF=/opt/cell-manager/env-files/${KEY}.env    # 路径自定，一次落定
mkdir -p "$(dirname "$ENVF")"

# 1) 现有容器 env 导出成 env-file（含 wgk- 客户凭据），立即收紧权限
docker inspect "$CTR" --format '{{range .Config.Env}}{{println .}}{{end}}' > "$ENVF"
chmod 600 "$ENVF"        # 与 wgk- 同纪律

# 2) 追加 PG 数据根 URL（密码从 cheap-3 生成处带来；read -s 手输：不回显、不进 history）
read -rs -p "cell db password: " PW; echo
printf 'DAAS_DATABASE_URL=postgresql+psycopg://wire_cell_%s:%s@100.64.0.12:5433/wire_cell_%s\n' \
  "$KEY" "$PW" "$KEY" >> "$ENVF"    # printf 是 shell 内建，口令不进 ps
unset PW

# 3) 删旧容器，按原参数重建（镜像/卷/网络/restart 保持原值，镜像换新 tag）
IMAGE=ccr.ccs.tencentyun.com/fd-wire/cell:<带 psycopg 的新 tag>
docker rm -f "$CTR"
docker run -d \
  --name "$CTR" \
  --restart unless-stopped \
  --network mcp-gateway-registry_default \
  -v /opt/cell-manager/volumes/${KEY}:/data \
  --env-file "$ENVF" \
  "$IMAGE"
```

说明：

- `docker inspect … .Config.Env` 会带出镜像自带的 `PATH` 等默认变量——
  同值覆盖无害；讲究的话可手工只留注入类 env。
- 密码从 cheap-3（生成处）到 cheap-1（env-file）的传递走你信任的私密通道，
  与 wgk- 凭据交付同纪律：不进聊天/工单/终端回显/命令行参数。
- `docker rm -f` 到 `docker run` 之间容器下线（秒级）——低峰窗口做。
- 回退或日常轮换不需要重复步骤 1–2，只改 env-file 再跑步骤 3。

### 4.3 迁移顺序与冒烟（每步过了再下一步）

1. **低峰窗口**（建议 02:00–05:00 UTC，对齐 api 侧迁移纪律）。
2. **建库**（§3.2 若未做过先做基线 → §3.3 三条命令）。
3. **隔离验证两查**（§3.4 验证①②）全过。
4. **改 env-file**（§4.2 步骤 1–2）。
5. **重建容器**（§4.2 步骤 3，新镜像）。
6. **冒烟**：
   - 健康检查绿（healthcheck 本身就是 MCP initialize 握手）：
     ```bash
     docker inspect --format '{{.State.Health.Status}}' fd-wire-cell-drillcust001
     # 预期：healthy
     ```
   - 启动日志确认数据根已切：
     ```bash
     docker logs fd-wire-cell-drillcust001 2>&1 | grep '\[entrypoint\]'
     # 预期出现：[entrypoint] exec fd-daas-mcp server: … db=postgresql+psycopg://…
     # ⚠ 当前 entrypoint 这行会打印完整 db=URL（含口令）——
     #   外发/贴日志前先抹掉口令段，勿整行截图进工单或对话
     ```
   - **MCP 工具面**：经 wire 入口
     `https://mcp.finddatatech.cloud/fd-wire-cell-<key>/mcp` 持该 cell 的
     wgk- key（从 0600 台账文件取，勿贴进终端回显）走标准序列
     （initialize → initialized → tools/list，模板见
     `docs/customer-onboarding-integration.md` §4.1）——tools/list 应出现
     完整的 `customer_dataset_*` 工具组。
   - **实弹建集 + 查数**各一发。新数据根是**空库起步**，历史冒烟产物
     不跟随——预期内，重新造即可。
   - （可选直查）确认引擎已建表——超管只看表清单，**不 SELECT 业务表**
     （§2 纪律）：
     ```bash
     docker exec wire-postgres psql -U wire -d wire_cell_drillcust001 -c '\dt'
     ```

## 5. 回退配方（sqlite 卷保底）

触发条件（对齐 api 侧手册）：冒烟/验证清单的问题 **1 小时内修不好**。

```bash
# ---- 在 cheap-1 宿主执行 ----
ENVF=/opt/cell-manager/env-files/drillcust001.env
cp "$ENVF" "${ENVF}.bak-$(date -u +%Y%m%dT%H%M)"      # 回退也留一手
grep -v '^DAAS_DATABASE_URL=' "$ENVF" > "${ENVF}.new" && mv "${ENVF}.new" "$ENVF"
# 然后按 §4.2 步骤 3 同款重建（docker rm -f + docker run，参数不变，镜像可不换——
# 新镜像不带该 env 时行为等同旧镜像，见 §1.2 不变量）
```

**回退语义（动手前必须读懂）**：切 PG 后引擎只写 PG、**旧 sqlite 卷一个字
都不再写**——卷从迁移那一刻起变成**静态快照**。所以：

> 回退 = 回到**搬迁时点**：卷里当时有多少，回来就是多少；搬迁之后写进 PG 的
> 新数据**不带回**。回退**不是双向同步**。若 PG 侧已有必须保留的数据，
> 先经引擎工具导出，再执行回退。

回退后：PG 侧 cell 库保留作取证与差异核对；确认不再前滚再处置
（`DROP DATABASE wire_cell_<key>` + 台账销项 + backup.sh 清单摘除）。
sqlite 卷在确认稳定前不清不删。

## 6. 试点记录锚点（drillcust001，做完即填）

| 项 | 结果 |
|---|---|
| 建库命令执行时间 / 操作人 | 2026-10-12 ~04:00 CST / 主线会话（口令服务器侧 openssl 生成，曾因调试输出泄露即时轮换一次） |
| 一次性基线 REVOKE（§3.2）执行时间 | 同上（三库 wire_platform/wire_datasets/wire_cell_drillcust001 一次到位；实例登录角色仅 wire 超管+临时测试角色，无误伤） |
| 隔离验证①（无授权角色连 cell 库被拒 + has_database_privilege=f） | ✅ fd_engine_test→cell 库 f；→wire_platform f |
| 隔离验证②（属主进本库 OK / 连 wire_platform 被拒） | ✅ wire_cell_drillcust001→本库 t；→wire_platform f |
| 迁移时刻（容器重建，镜像 tag） | 2026-10-12 ~06:40 CST，cell:sha-12aac2a（快照=law-ai-official fd-wire-images 12aac2a，真 676ad2b；引擎=fd-daas-mcp internal-main 3198699） |
| backup.sh 清单已加 wire_cell_drillcust001 | ✅ /opt/wire-postgres/backup.sh 第 10 行（.bak-cellpg 留底）；次日 19:30 起产出该库备份 |
| 冒烟结论 | ✅ healthy；entrypoint 日志 db=postgresql+psycopg://…/wire_cell_drillcust001；184 工具含 link；16 步实弹 0 FAIL（建集/摄取/类型强制/修正四环/写批/query+agg/link NULL 语义/派生/刷新/血缘/删除如实 404）；cell_event_wal 93 条、ingest 审计 51 条留档 |
| 回退演练结论 | ✅ 迁移后 sqlite 卷 md5 不变（8ad6e0ff…）；切回基线 env 重建→sqlite 根 healthy、旧元数据在（datasets_meta=2）；再切回 PG 终态 healthy。快照语义确认：PG 侧 16 步数据不随回退带回（符合预期，非双向同步） |

## 7. v1 边界（本文不做，均为后续 change）

- **cell-manager 自动「建库 + 发凭据」**（含凭据入 OpenBAO 动态下发）——
  §3 的三条命令届时并入 provision 流程，本文只给手工配方。
- **存量客户 cell 逐户搬迁编排**——v1 只搬 drill 试点（零客户价值租户），
  验证「带着既有数据搬 + 回退保底」全流程；存量客户一律不动。
- **50 万行上限转 `pg_database_size` 商业配额杠杆并重估数字**——v1 期间
  引擎行上限逻辑原样保留，重估留后续 change。
