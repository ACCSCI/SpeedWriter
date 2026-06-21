#!/usr/bin/env bash
# InkOS Desktop - 完整验证脚本
# 用途:从 clean 状态一键跑到 e2e 全绿
# 依赖:pnpm 10+, Node 22+
#
# 用法:
#   ./scripts/verify-desktop.sh          # 跑完整套件
#   ./scripts/verify-desktop.sh --smoke  # 只跑 smoke(快速)
#   ./scripts/verify-desktop.sh --loop   # 失败自动重跑,直到绿(autonomous)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# === 参数解析 ===
MODE="full"
LOOP=false
case "${1:-}" in
  --smoke) MODE="smoke" ;;
  --llm)   MODE="llm" ;;
  --loop)  LOOP=true ;;
esac

# === 颜色 ===
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*" >&2; }
ok()   { echo -e "${GREEN}[$(date +%H:%M:%S)] ✓${NC} $*" >&2; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠${NC} $*" >&2; }
err()  { echo -e "${RED}[$(date +%H:%M:%S)] ✗${NC} $*" >&2; }

run_step() {
  local name="$1"; shift
  log "→ $name"
  if "$@"; then
    ok "$name 完成"
  else
    err "$name 失败"
    return 1
  fi
}

verify_once() {
  log "════════════════════════════════════════════════════════════"
  log "InkOS Desktop verify — mode: $MODE"
  log "════════════════════════════════════════════════════════════"

  # Step 1: install(增量,跳过 lock 没变的情况)
  run_step "pnpm install" pnpm install --frozen-lockfile --prefer-offline

  # Step 2: build core + studio + desktop
  run_step "build core" pnpm --filter @actalk/inkos-core build
  run_step "build studio" pnpm --filter @actalk/inkos-studio build
  run_step "build desktop" pnpm --filter @actalk/inkos-desktop build

  # Step 3: package(根据当前 OS 跑对应 unpacked,Mac/Linux/Windows 都覆盖)
  if [ "$MODE" = "full" ]; then
    case "$(uname -s 2>/dev/null || echo Windows)" in
      Darwin)
        log "→ package(macOS .app — icon 由 scripts/generate-mac-icon.mjs 生成)"
        if CSC_IDENTITY_AUTO_DISCOVERY=false node "$ROOT_DIR/scripts/generate-mac-icon.mjs" \
          && CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @actalk/inkos-desktop exec electron-builder --mac --dir; then
          ok "package 完成 — packages/desktop/dist/mac/InkOS.app"
        else
          err "package 失败"
          return 1
        fi
        ;;
      Linux)
        log "→ package(Linux AppImage)"
        if CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @actalk/inkos-desktop exec electron-builder --linux --dir; then
          ok "package 完成 — packages/desktop/dist/linux-unpacked/InkOS"
        else
          err "package 失败"
          return 1
        fi
        ;;
      *)
        log "→ package(Windows .exe)"
        if CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @actalk/inkos-desktop exec electron-builder --dir --config.win.signAndEditExecutable=false; then
          ok "package 完成 — packages/desktop/dist/win-unpacked/InkOS.exe"
        else
          err "package 失败"
          return 1
        fi
        ;;
    esac
  fi

  # Step 4: e2e
  if [ "$MODE" = "full" ] || [ "$MODE" = "smoke" ]; then
    run_step "e2e smoke" pnpm --filter @actalk/inkos-desktop test:smoke || return 1
  fi
  if [ "$MODE" = "full" ] || [ "$MODE" = "llm" ]; then
    if [ -f "$ROOT_DIR/.env" ] && grep -q "^INKOS_LLM_API_KEY=sk-" "$ROOT_DIR/.env"; then
      run_step "e2e llm" pnpm --filter @actalk/inkos-desktop test:llm || return 1
    else
      warn "跳过 llm 测试(.env 无 INKOS_LLM_API_KEY)"
    fi
  fi

  ok "════════════════════════════════════════════════════════════"
  ok "全部通过 ✓"
  ok "════════════════════════════════════════════════════════════"
}

# === 主循环 ===
ATTEMPT=1
MAX_ATTEMPTS=10
while true; do
  log "═══ 尝试 #$ATTEMPT ═══"
  if verify_once; then
    ok "✅ 验证成功"
    exit 0
  fi

  if [ "$LOOP" = false ]; then
    err "❌ 验证失败(用 --loop 自动重试)"
    exit 1
  fi

  if [ "$ATTEMPT" -ge "$MAX_ATTEMPTS" ]; then
    err "❌ 已重试 $MAX_ATTEMPTS 次,放弃"
    exit 1
  fi

  warn "失败,$((ATTEMPT))/$MAX_ATTEMPTS,5 秒后重试..."
  sleep 5
  ATTEMPT=$((ATTEMPT + 1))
done
