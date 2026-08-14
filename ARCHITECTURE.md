# Architecture: engine / host seams

dsh-mini is built so that **anyone can take the engine out and retrofit it into
another harness or agent app**. Everything that is hard to replace (the DSH
core: loop, sessions, tools, goals) is isolated in one engine-agnostic bundle;
everything that varies per host (provider, filesystem, persistence, UI) plugs
into the engine through five narrow seams.

```
┌────────────────────────────── host (this repo's cli/, replaceable) ──────────────────────────────┐
│  cli.js            boot plugin (inject list), REPL, /commands                                     │
│  renderEvent       session/event firehose → terminal                                               │
│  gemini-adapter.js seam ① llm adapter (any provider: implement LlmAdapter.stream)                │
│  node-fs.js        seam ② fs service (any storage: implement the fs contract)                    │
│  JsonlSession-     seam ③ persistence backend (swap for your own store; needs no engine change)   │
│  Persistence                                                                                       │
└──────────────────────────────────────────┬──────────────────────────────────────────────────────────┘
                                           │ npm-pinned @deepseek-ai/dsh-* packages
┌──────────────────────────────────────────▼──────────────────────────────────────────────────────────┐
│  ENGINE (build.sh → bundle.mjs, engine-agnostic, no Node builtins)                                  │
│    cordis + AgentRegistry + SessionStore + SystemPrompt + ToolRuntime + AgentLoop                  │
│    shims/          seam ④ Node-API surface: pure-JS reimplementations + loud-failure stubs         │
│    polyfills.js    seam ⑤ engine surface: ES polyfills + cross-engine normalizations               │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## The five seams

1. **LLM adapter** — implement `dsh-llm`'s `LlmAdapter` (`stream(options)`
   yields BlockAssembler chunks) and `ctx.llm.registerAdapter(["provider"],
   adapter)`. `gemini-adapter.js` is the reference (SSE streaming, thinking
   signatures, role merging). Any provider, local model, or mock fits here.
2. **Filesystem service** — implement the `fs` contract (resolve/stat/
   readText/streamText/readBytes/writeText/editText/listDir). `node-fs.js` is
   the reference; an Android host implements the same contract over SAF, a
   remote host over SFTP, without touching `dsh-tool-fs`.
3. **Persistence backend** — mount any `sessionPersistence` implementation
   (JSONL here; write your own store for your host). The engine only consumes
   `prepare/load/list`. Sessions are keyed by id + cwd.
4. **Node-API surface** (`shims/`) — what a non-Node engine must provide:
   `path`, `util`, `crypto`, `async_hooks` (AsyncLocalStorage + the es2016
   promise-chain prelude), `module`, `events`, `perf_hooks`, `timers`, plus
   loud stubs for `fs`/`sqlite`/`child_process`/`zlib`/`worker_threads` so
   accidental use fails loudly instead of silently.
5. **Engine surface** (`polyfills.js`) — AbortController, structuredClone,
   Promise.withResolvers, Symbol.dispose, `Function.prototype.toString`
   normalization (QuickJS vs V8 native-code formatting), and the es2016
   async/await lowering requirement (see the skill).

## Host responsibilities (what the engine does NOT do)

- Boot orchestration: a plugin with an `inject` list (see `cli.js` `boot`).
- Rendering: subscribe to `session/event` and project the event log to UI.
- Provider credentials, retry policy, model selection.
- The host's own session UX (resume, listing) on top of seam ③.

## Retrofit recipe (into another harness/agent app)

1. Copy `build.sh` + `shims/` + `polyfills.js` + `main.js` (or the CLI
   boot pattern); pin the same `@deepseek-ai/*` versions from `package.json`.
2. Implement seam ① for your provider (or reuse a fake for tests).
3. Implement seam ② for your storage; skip if you only need chat.
4. Implement seam ③ for your store; skip for in-memory sessions.
5. Run the conformance gate (`run.sh`, fake provider, 5 scenarios) — it must
   be byte-identical to `baseline.node.json` before any custom work.
6. Swap the renderer for your UI; the event log is the single source of
   truth, so any UI projects the same stream.

## Upgrade policy (tracking DSH upstream)

- All `@deepseek-ai/*` versions are pinned exactly in `package.json`.
- Every upgrade: `./run.sh` must stay green (byte-identical traces), then a
  live-provider smoke test (one text turn + one tool turn).
- Engine quirks and provider quirks belong in the seams, never in vendored
  upstream code. If a shim grows, it documents why in `skills/dsh-core-embedding`.
