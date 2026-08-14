# dsh-mini — DSH core as a portable engine + a tiny coding-agent CLI

This directory is the spike that answers one question: **can the DeepSeek
Harness core be pulled from npm, run as a self-contained engine behind a
compatibility layer, and be embedded in other hosts?**

Two deliverables:

## 1. Engine spike (`bundle.mjs`, `run.sh`)

The real DSH core — cordis + `AgentRegistry` + `SessionStore` + `SystemPrompt`
+ `ToolRuntime` + `AgentLoop` (the event-sourced turn/step state machine) —
bundled into ONE engine-agnostic file (~419 KB, zero Node builtins) with:

- `shims/` — the Node builtin surface reimplemented in pure JS (`path`,
  `util`, `crypto`, `async_hooks`/AsyncLocalStorage via a patched promise
  chain, …). fs/sqlite/child_process are loud-failure stubs: if the core ever
  touches them, it fails loudly instead of misbehaving.
- `polyfills.js` — engine polyfills (AbortController, structuredClone,
  Promise.withResolvers, Symbol.dispose, …) plus one engine-difference
  normalization: QuickJS renders `Function.prototype.toString` of native
  functions multi-line while `dsh-tools` string-compares the V8 single-line
  form.

Key design choice: esbuild `--target=es2016` LOWERS async/await to generators
so every promise continuation passes through JS-visible `Promise.prototype.then`
— required for the AsyncLocalStorage prelude to work on QuickJS, whose `await`
is C-internal.

Validation: 5 scripted scenarios (plain text / tool round-trip /
parallel+exclusive tool scheduling / max-tokens truncation / mid-turn
steering) replay through a fake provider. Node and QuickJS produce
**byte-identical** event traces (114 events), hash-pinned in
`baseline.node.json` + `baseline.sha256`. Every future `@deepseek-ai/*`
upgrade must pass `./run.sh`.

## 2. dsh-mini CLI (`cli/`)

The same DSH core as a real interactive coding agent on Node:

```
node cli/cli.mjs [model]
```

- Provider: Google Gemini via the AI Studio SSE endpoint, implemented as a
  `dsh-llm` `LlmAdapter` (`cli/gemini-adapter.js`) — proof that a third-party
  provider plugs into the core through the adapter seam. Includes the
  Gemini-3 `thoughtSignature` echo quirk (signatures are part-level siblings
  of `functionCall` in both directions).
- Tools: the REAL `dsh-tool-fs` tools (read/write/edit/list) + `dsh-tool-todo`,
  backed by a minimal node:fs implementation of the dsh `fs` service
  (`cli/node-fs.js`).
- Persistence: the REAL DSH JSONL backend (`dsh-session-persistence-jsonl`,
  zstd, per-cwd layout); sessions survive restarts, `--resume <id>` resumes,
  `--sessions` lists. Verified cross-process memory (secret-code test).
- REPL: `/clear`, `/model <id>`, `/sessions`, `/exit`; live event rendering
  from the session firehose; ANSI status bar with live token usage.

Commands:
```
cli/cli-build.sh          # build cli/cli.mjs (Node profile)
./run.sh                  # engine conformance (Node + QuickJS, diff vs baseline)
./build.sh                # portable engine bundle only
node cli/cli.mjs [model] [--resume <id>] [--sessions]   # DSH_SESSIONS overrides the sessions dir
```

Architecture (engine/host seams, retrofit recipe, upgrade policy):
`ARCHITECTURE.md`. Pitfalls and host-integration checklist:
`skills/dsh-core-embedding/SKILL.md`.

## Roadmap

- [x] pi-tui shell (the real `@earendil-works/pi-tui` framework; session events → components)
- [ ] Session stats + compaction on resume
- [ ] Bash tool + sandbox policy for the Node profile
- [ ] Operit QuickJS host bridge (long-lived event loop + JNI bridge)
