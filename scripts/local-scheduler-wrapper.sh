#!/bin/zsh
set -eu

NODE_BIN="$1"
OPENCLI_BIN="$2"
RUNTIME_ROOT="$3"

export PATH="${NODE_BIN:h}:${OPENCLI_BIN:h}:/usr/bin:/bin:/usr/sbin:/sbin"
exec "$NODE_BIN" \
  "$RUNTIME_ROOT/node_modules/tsx/dist/cli.mjs" \
  "$RUNTIME_ROOT/scripts/local-scheduler-cli.ts" \
  scheduler --once
