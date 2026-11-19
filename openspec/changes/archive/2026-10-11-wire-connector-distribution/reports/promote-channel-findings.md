# 连接器晋升通道实况（2026-10-11 生产定案）

## 三次实测的通道裁决

1. **US runner → 国内 SSH 高端口（rsync 直推）**：TCP 被网络层静默断——the node
   auth.log 在失败时间窗零连接记录（不是凭据问题；`ssh-keyscan` stderr 被
   `2>/dev/null` 吞、`set -e` 即死）。本机同 key 同端口认证通过，定位为
   海外→国内高端口干扰。**判死，降为变量门控可选**（`vars.DOWNLOADS_RSYNC_ENABLED`）。
2. **国内节点 → GitHub（拉模型兜底）**：the node `curl api.github.com` 超时
   （exit 124）；the node 拉 GH release 同超时。**双向都断。**
3. **OCI 中继（定案主通道）**：runner 推 `fd-wire/downloads:sha-<sha>` + `:current`
   （busybox 薄壳装五平台产物+manifest）到 hkccr → the node tcr-relay（repos.conf
   已登记）回灌 ccr → **the node `wire-downloads-push.sh` cron（*/10）**拉取+sha256
   全量校验+rsync 推 the node（tailnet <node>3）。the node 无 docker（纯 k3s 节点），
   故拉取校验在 the node、落盘在 the node。

## 全链实弹（2026-10-11 02:29-02:31）

- run 38075802778（8e09d61）：promote job 31s 全绿，镜像双 tag 推 hkccr
- relay 手动补单 `fd-wire/downloads:current` 13s OK
- push 脚本实跑：`PUSHED sha-d17e5f1 -> sha-8e09d61`（版本比较跳过逻辑+sha 校验过）
- 公网端点复验：manifest version=sha-8e09d61、linux-amd64 200、sha256 与 manifest 一致

## 附带修复

- the node sshd `PubkeyAuthentication no → yes`（加法修复，密码通道未动）——promote
  key（scs001-fd-wire-promote）与 the node 节点钥（cheap3-wire-dl-sync）均已授权
- secrets：DOWNLOADS_SSH_HOST/USER/KEY + vars：DOWNLOADS_REMOTE_DIR=/var/lib/fd-wire/downloads、
  DOWNLOADS_SSH_PORT=26859（cheap 系共享 IP 各自端口，rsync 可选通道用）
