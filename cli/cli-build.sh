#!/usr/bin/env bash
# Build the dsh-mini CLI for Node (node:* builtins stay native).
set -e
cd "$(dirname "$0")/.."
if [ ! -e node_modules ] && [ ! -L node_modules ]; then
  echo "node_modules missing: run 'npm install' (add --ignore-scripts on Termux)" >&2
  exit 1
fi
if [ -L node_modules ] && [ ! -e node_modules ]; then
  echo "node_modules is a dangling symlink: run 'npm install'" >&2
  exit 1
fi
ESBUILD="${ESBUILD:-}"
if [ -z "$ESBUILD" ]; then
  if command -v npx >/dev/null 2>&1; then ESBUILD="npx --yes esbuild"
  elif [ -x /home/ubuntu/Dsh_workspace/spike-tools/node_modules/@esbuild/linux-arm64/bin/esbuild ]; then ESBUILD="/home/ubuntu/Dsh_workspace/spike-tools/node_modules/@esbuild/linux-arm64/bin/esbuild"
  else echo "esbuild not found: install it or set ESBUILD"; exit 1; fi
fi
ALIAS_FLAG=""
if [ -f vendor/node_modules/@earendil-works/pi-tui/dist/index.js ]; then
  ALIAS_FLAG="--alias:@earendil-works/pi-tui=./vendor/node_modules/@earendil-works/pi-tui/dist/index.js"
fi
if [ -f vendor/node_modules/@openguardrails/dsh-tui/lib/index.js ]; then
  ALIAS_FLAG="$ALIAS_FLAG --alias:@openguardrails/dsh-tui=./vendor/node_modules/@openguardrails/dsh-tui/lib/index.js --alias:@openguardrails/dsh-tui/prompt=./vendor/node_modules/@openguardrails/dsh-tui/lib/prompt.js"
fi
# Deterministic cosmetic patches on whichever dsh-tui copy esbuild bundles
# (local vendor/ or CI's npm install) — keeps CI artifacts == local releases.
if [ -f vendor/node_modules/@openguardrails/dsh-tui/lib/index.js ]; then
  TUI_LIB="vendor/node_modules/@openguardrails/dsh-tui/lib/index.js"
else
  TUI_LIB="$(dirname "$(node -e "console.log(require.resolve('@openguardrails/dsh-tui'))" 2>/dev/null || echo node_modules/@openguardrails/dsh-tui/lib/index.js)")/index.js"
fi
[ -f "$TUI_LIB" ] && python3 patches/apply-dsh-tui-patches.py "$TUI_LIB"

$ESBUILD cli/cli.js \
  $ALIAS_FLAG \
  --alias:node:module=./shims/module.js \
  --alias:node:fs/promises=./shims/fs-promises.js \
  --bundle \
  --format=esm \
  --platform=node \
  --target=node22 \
  --outfile=cli/cli.mjs \
  --external:koffi \
  --log-level=warning
echo "built: cli/cli.mjs ($(wc -c < cli/cli.mjs) bytes)"
