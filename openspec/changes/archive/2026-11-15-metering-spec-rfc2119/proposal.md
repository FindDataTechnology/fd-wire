# Proposal: metering-spec-rfc2119 — 两条 requirement 缺 RFC 2119 关键词

## Why

`fix-metering-poll-pagination` 归档后按规矩对被动过的能力跑
`openspec validate metering-poll-channel --type spec --strict`，**EXIT=1**：
`可达性闸门` 与 `降级到推送且不丢账` 两条 requirement 的正文里没有任何
`SHALL` / `MUST`，`--strict` 按 RFC 2119 最佳实践判它们不合格。

这不是本次归档引入的：对归档前的备份
（`/tmp/openspec-backup-20261115-090557/metering-poll-channel/spec.md`）跑同一命令
也是 **EXIT=1**，且当时是 **3 条** WARNING（本次 delta 给第一条 requirement 补了
`MUST`，所以现在剩 2 条）。也就是说这个能力从建立以来就一直是红的，只是没人
回头再跑一次 `--strict`。

AGENTS 的规矩是「归档后被动过的能力红了就当场修」，且 **`openspec/specs/` 只能经
`archive` 改**——所以补关键词这件事本身要走一个 change，而不是直接编辑正文。

## What Changes

只改两条 requirement 的**措辞**，不动判据口径、不动场景名、不动场景语义：

1. `可达性闸门`：把「以一次真实出站可达性探针为闸门」「不得宣称通道已建成」
   写成 `MUST` / `MUST NOT`。
2. `降级到推送且不丢账`：把「不得静默丢失」写成 `MUST NOT`。

## Impact

- 受影响能力：`metering-poll-channel`（仅措辞；无行为变化、无代码变化）。
- 风险：极低——两条 requirement 的场景块逐字保留（场景名不能改，改了会被
  archive 当成 drop 拒绝）。
- 顺带的意义：这是「`--strict` 只看被改动的那次，历史欠账不会自己消失」的
  一个实例；本 change 让该能力第一次真正转绿。
