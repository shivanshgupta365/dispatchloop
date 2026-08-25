#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
APP_NAME="dispatchloop"
APP_BUNDLE="$DESKTOP_DIR/src-tauri/target/release/bundle/macos/DispatchLoop.app"

pkill -x "$APP_NAME" >/dev/null 2>&1 || true

case "$MODE" in
  run)
    exec pnpm --dir "$DESKTOP_DIR" tauri dev
    ;;
  --debug|debug)
    RUST_BACKTRACE=1 exec pnpm --dir "$DESKTOP_DIR" tauri dev
    ;;
  --logs|logs|--telemetry|telemetry)
    exec pnpm --dir "$DESKTOP_DIR" tauri dev
    ;;
  --verify|verify)
    pnpm --dir "$DESKTOP_DIR" tauri build --bundles app
    /usr/bin/open -n "$APP_BUNDLE"
    sleep 2
    pgrep -x "$APP_NAME" >/dev/null
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
