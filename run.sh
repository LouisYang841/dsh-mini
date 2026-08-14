#!/usr/bin/env bash
# Conformance runner: build, run on Node (and QuickJS when available), diff.
set -e
cd "$(dirname "$0")"
./build.sh >/dev/null 2>&1
node bundle.mjs > trace.node.json 2> node.err
echo "node: exit=$? events=$(python3 -c "import json;print(sum(len(s['events']) for s in json.load(open('trace.node.json'))))")"
if [ -f baseline.node.json ]; then
  if cmp -s trace.node.json baseline.node.json; then echo "vs baseline: IDENTICAL"; else echo "vs baseline: DIFFER"; diff <(python3 -m json.tool trace.node.json) <(python3 -m json.tool baseline.node.json) | head -20; fi
fi
QJS=""
for c in quickjs-ng/qjs quickjs-*/qjs ../quickjs*/qjs; do [ -x "$c" ] && QJS="$c" && break; done
if [ -n "$QJS" ]; then
  "$QJS" -m bundle.mjs > trace.qjs.json 2> qjs.err
  echo "qjs: exit=$? events=$(python3 -c "import json;print(sum(len(s['events']) for s in json.load(open('trace.qjs.json'))))")"
  if cmp -s trace.node.json trace.qjs.json; then echo "node vs qjs: IDENTICAL"; else echo "node vs qjs: DIFFER"; diff <(python3 -m json.tool trace.node.json) <(python3 -m json.tool trace.qjs.json) | head -30; fi
else
  echo "qjs: not built yet (run build in quickjs-ng/)"
fi
