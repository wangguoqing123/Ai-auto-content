#!/bin/zsh
set -eu

NODE_BIN="$1"
OPENCLI_BIN="$2"
CODEX_BIN="$3"
CODEX_MODEL="$4"
RUNTIME_ROOT="$5"

export PATH="${NODE_BIN:h}:${OPENCLI_BIN:h}:${CODEX_BIN:h}:/usr/bin:/bin:/usr/sbin:/sbin"
export TOPIC_LLM_PROVIDER="codex_cli"
export TOPIC_CODEX_BIN="$CODEX_BIN"
export TOPIC_CODEX_MODEL="$CODEX_MODEL"
export RESEARCH_CODEX_BIN="$CODEX_BIN"
export RESEARCH_CODEX_MODEL="$CODEX_MODEL"
exec "$NODE_BIN" \
  "$RUNTIME_ROOT/node_modules/tsx/dist/cli.mjs" \
  "$RUNTIME_ROOT/scripts/local-scheduler-cli.ts" \
  scheduler --once
