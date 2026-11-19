#!/usr/bin/env bash
# ── 把 fd-wire 的源码同步到公开镜像仓 scs001/fd-wire-images ─────────────────
#
#   ./scripts/sync-public-mirror.sh              # 构建 + 校验，不推
#   ./scripts/sync-public-mirror.sh --push       # 构建 + 校验 + 推
#   ./scripts/sync-public-mirror.sh --check      # 只校验公开仓是否落后真源
#
# ## 为什么有这个脚本
#
# fd-wire 是私有仓，且组织的私有 Actions 额度已耗尽 —— 它自己的 CI 一条都起不来
# （实测：4 秒失败，"The job was not started because recent account payments have
# failed"）。唯一能跑 CI 的地方就是那个公开镜像仓。
#
# 2026-11-19 查出来：镜像落后真源 7 个提交，其中包含一个安全修复
# （删掉硬编码的内部令牌默认值）。它落后了**没有人知道** —— BUILD-INFO 还停在
# 11-12，看上去像个正常的旧快照。这个脚本存在就是为了让"同步"变成一条命令，
# 而不是一件要靠人记得的事。
#
# ## 排除什么，为什么
#
# 从真源与镜像的实际差集推出来（2026-11-19）：真源比镜像多 547 个文件，
# 集中在 openspec/（499）、docs/（33）、deploy/（12）。
#
#   openspec/   变更台账，含内网地址与事故复盘
#   docs/       架构与运维文档，同上
#   deploy/     k8s 清单，整份是机队拓扑
#
# 这三类排除后，镜像只剩源码与构建输入 —— 正好是 CI 需要的那部分。
#
# ## 校验（推之前必须全过）
#
#   1. 目录是独立仓（不能是 fd-wire 本身 —— 2026-11-14 paas 事故就是这么发生的）
#   2. 文件数在合理量级（800-2000；真源 1280、镜像 753）
#   3. 禁品路径缺席（openspec/、docs/、deploy/、.env、AGENTS.md）
#   4. 禁品模式零命中（内网地址、节点名、令牌字面量）
#
# 任一不过 ⇒ 非零退出，公开仓保持上一版。宁可旧一版，也不推一份带泄漏的。
set -euo pipefail

cd "$(dirname "$0")/.."
SRC_ROOT="$PWD"
MIRROR_REMOTE="${MIRROR_REMOTE:-git@github.com:scs001/fd-wire-images.git}"
WORK="${WORK:-$(mktemp -d)}"
PUSH=0
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    --check) CHECK_ONLY=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

EXCLUDES=(openspec docs deploy .claude .pi .impeccable graphify-out)

if [ "$CHECK_ONLY" = "1" ]; then
  base=$(curl -fsSL "https://raw.githubusercontent.com/scs001/fd-wire-images/main/BUILD-INFO.json" \
         | python3 -c "import json,sys; print(json.load(sys.stdin)['sourceCommit'])")
  if git merge-base --is-ancestor "$base" HEAD 2>/dev/null; then
    n=$(git rev-list --count "$base"..HEAD)
    echo "镜像基线 ${base}，落后 $n 个提交"
    [ "$n" -eq 0 ] && exit 0 || exit 1
  fi
  echo "镜像基线 $base 不是 HEAD 的祖先 —— 真源与镜像已分叉" >&2
  exit 1
fi

echo "1/4 导出源码树 @ $(git rev-parse --short HEAD)"
mkdir -p "$WORK/tree"
git archive HEAD | tar -x -C "$WORK/tree"

echo "2/4 排除非源码目录"
removed=0
# 本脚本自己也要排掉：它的禁品扫描规则里就写着那些地址与令牌字面量，
# 带进镜像会被自己那道检查命中（实测：第一次跑就撞上了）。
rm -f "$WORK/tree/scripts/sync-public-mirror.sh"
for d in "${EXCLUDES[@]}"; do
  if [ -e "$WORK/tree/$d" ]; then
    rm -rf "$WORK/tree/$d"
    removed=$((removed + 1))
  fi
done
echo "    移除 $removed 个目录"

echo "3/4 校验"
files=$(find "$WORK/tree" -type f | wc -l | tr -d ' ')
[ "$files" -ge 600 ] && [ "$files" -le 2000 ] || {
  echo "    文件数 $files 越界（应 600-2000）—— 排除表可能失效" >&2; exit 1
}
for bad in openspec docs deploy .env AGENTS.md DEPLOY.md; do
  [ -e "$WORK/tree/$bad" ] && { echo "    禁品在场: $bad" >&2; exit 1; }
done
if grep -rnE '100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|134\.175\.46\.69|103\.236\.|cheap-[1-9]\b|harbor\.local|wire-internal-dev' \
     "$WORK/tree" >/dev/null 2>&1; then
  echo "    禁品模式命中:" >&2
  grep -rnE '100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|134\.175\.46\.69|103\.236\.|cheap-[1-9]\b|harbor\.local|wire-internal-dev' \
       "$WORK/tree" | head -5 >&2
  exit 1
fi
echo "    ✓ $files 个文件，禁品零命中"

cat > "$WORK/tree/BUILD-INFO.json" <<JSON
{
  "source": "fd-wire",
  "sourceCommit": "$(git rev-parse HEAD)",
  "baseRef": "HEAD",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "note": "由 fd-wire/scripts/sync-public-mirror.sh 生成。排除 openspec/ docs/ deploy/。"
}
JSON

echo "4/4 建独立仓"
cd "$WORK/tree"
git init -q -b main
git add -A
[ "$(git rev-parse --show-toplevel)" = "$(cd "$WORK/tree" && pwd -P)" ] || {
  echo "    ⚠️ 当前目录解析到的仓不是这个目录 —— 2026-11-14 事故的同款陷阱，中止" >&2; exit 1
}
git -c user.email=dev@finddatatech.com -c user.name="FindData" commit -q \
  -m "sync from fd-wire @ $(cd "$SRC_ROOT" && git rev-parse --short HEAD)"

if [ "$PUSH" = "0" ]; then
  echo "✅ 就绪（未推）：$WORK/tree"
  echo "   推送：$0 --push"
  exit 0
fi

echo "推送"
git remote add origin "$MIRROR_REMOTE"
git push --force origin main
echo "✅ 已推送 $MIRROR_REMOTE"
