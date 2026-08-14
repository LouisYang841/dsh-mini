#!/usr/bin/env bash
# Build the engine-agnostic DSH-core bundle.
#   target es2016: async/await is LOWERED to generators so every promise
#   continuation goes through JS-visible Promise.prototype.then — required for
#   the AsyncLocalStorage prelude to work on QuickJS (its `await` is C-internal).
#   node:* aliases: all Node builtins resolve to the shim layer.
set -e
cd "$(dirname "$0")"

# Resolve the DSH package tree through a symlink (esbuild walks up from the
# importer, so it must find node_modules next to the entry).
[ -e node_modules ] || ln -s /home/ubuntu/dsh/node_modules node_modules

/home/ubuntu/Dsh_workspace/spike-tools/node_modules/@esbuild/linux-arm64/bin/esbuild main.js \
  --bundle \
  --format=esm \
  --platform=neutral \
  --target=es2016 \
  --outfile=bundle.mjs \
  --log-level=warning \
  --alias:node:crypto=./shims/crypto.js \
  --alias:node:path=./shims/path.js \
  --alias:node:util=./shims/util.js \
  --alias:node:util/types=./shims/util_types.js \
  --alias:node:async_hooks=./shims/async_hooks.js \
  --alias:node:module=./shims/module.js \
  --alias:node:events=./shims/events.js \
  --alias:node:perf_hooks=./shims/perf_hooks.js \
  --alias:node:timers=./shims/timers.js \
  --alias:node:os=./shims/os.js \
  --alias:node:fs=./shims/fs.js \
  --alias:node:url=./shims/url.js \
  --alias:node:buffer=./shims/buffer.js \
  --alias:node:stream=./shims/stream.js \
  --alias:node:zlib=./shims/zlib.js \
  --alias:node:worker_threads=./shims/worker_threads.js \
  --alias:node:child_process=./shims/child_process.js \
  --alias:node:sqlite=./shims/sqlite.js

echo "built: bundle.mjs ($(wc -c < bundle.mjs) bytes)"
