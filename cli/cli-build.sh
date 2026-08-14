#!/usr/bin/env bash
# Build the dsh-mini CLI for Node (node:* builtins stay native).
set -e
cd "$(dirname "$0")/.."
[ -e node_modules ] || ln -s /home/ubuntu/dsh/node_modules node_modules
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
$ESBUILD cli/cli.js \
  $ALIAS_FLAG \
  --bundle \
  --format=esm \
  --platform=node \
  --target=node22 \
  --outfile=cli/cli.mjs \
  --external:koffi \
  --log-level=warning
echo "built: cli/cli.mjs ($(wc -c < cli/cli.mjs) bytes)"
