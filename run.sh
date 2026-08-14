#!/usr/bin/env bash
# Conformance runner: build, run on Node (and QuickJS when available), diff.
set -e
cd "$(dirname "$0")"

# Keep failures visible instead of hidden behind a redirection.
./build.sh > build.log 2>&1 || {
echo "build failed:"
cat build.log
exit 1
}

node_status=0
node bundle.mjs > trace.node.json 2> node.err || node_status=$?
node_events=$(python3 -c "import json;print(sum(len(s['events']) for s in json.load(open('trace.node.json'))))" 2>/dev/null || echo 0)
echo "node: exit=$node_status events=$node_events"
if [ "$node_status" -ne 0 ]; then
cat node.err
exit "$node_status"
fi

if [ ! -f baseline.node.json ]; then
echo "baseline.node.json is missing; cannot verify conformance" >&2
exit 1
fi

# The pinned hash keeps a modified baseline from silently passing.
expected_hash=$(awk '{print $1}' baseline.sha256)
actual_hash=$(sha256sum baseline.node.json | awk '{print $1}')
if [ "$expected_hash" != "$actual_hash" ]; then
echo "baseline.node.json hash mismatch: expected $expected_hash, got $actual_hash" >&2
exit 1
fi

if cmp -s trace.node.json baseline.node.json; then
echo "vs baseline: IDENTICAL"
else
echo "vs baseline: DIFFER"
diff <(python3 -m json.tool trace.node.json) <(python3 -m json.tool baseline.node.json) | head -20
exit 1
fi

QJS=""
for c in quickjs-ng/qjs quickjs-*/qjs ../quickjs*/qjs; do [ -x "$c" ] && QJS="$c" && break; done
if [ -n "$QJS" ]; then
qjs_status=0
"$QJS" --std -I test-random.js -m bundle.mjs > trace.qjs.json 2> qjs.err || qjs_status=$?
qjs_events=$(python3 -c "import json;print(sum(len(s['events']) for s in json.load(open('trace.qjs.json'))))" 2>/dev/null || echo 0)
echo "qjs: exit=$qjs_status events=$qjs_events"
if [ "$qjs_status" -ne 0 ]; then
cat qjs.err
exit "$qjs_status"
fi
if cmp -s trace.node.json trace.qjs.json; then
echo "node vs qjs: IDENTICAL"
else
echo "node vs qjs: DIFFER"
diff <(python3 -m json.tool trace.node.json) <(python3 -m json.tool trace.qjs.json) | head -30
exit 1
fi
else
echo "qjs: not built yet (run build in quickjs-ng/)"
fi
