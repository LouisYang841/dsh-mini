---
name: dsh-core-embedding
description: How to run the DeepSeek Harness core as an engine-agnostic bundle behind a shim layer, and how to drive it from a host (CLI, other runtimes). Use when embedding @deepseek-ai/dsh-* into a non-standard host, adding a provider adapter, debugging boot/scope/schema failures, or upgrading the pinned upstream version.
whenToUse: Embedding the DSH core (agent loop / tools / sessions) in a host; writing dsh-llm adapters; diagnosing cordis service visibility, tool DTO, or engine-difference failures; running the conformance gate after upstream bumps.
---

# Embedding the DSH core (dsh-mini playbook)

This skill captures everything learned while turning the DeepSeek Harness core
into a portable engine (spike in this repo) and driving it from a real CLI.
It is a troubleshooting and integration guide, not an architecture essay.

## Architecture in one paragraph

DSH = cordis plugin container + event-sourced sessions + the `ReactLoopAgent`
turn/step state machine. The portable engine is ONE esbuild bundle
(`bundle.mjs`, ~420 KB) of the core slice with `node:*` imports aliased to
`shims/`. The same core is reused by the CLI (`cli/`) on Node with real
builtins and a real provider adapter. Every host needs: a boot plugin with an
`inject` list, an `llm` adapter, and (optionally) an `fs` service.

## Core contracts (learned the hard way)

1. **Cordis service visibility.** Services register into their own plugin
   fiber's store; only contexts that INJECT a service can read `ctx.<name>`.
   The host driver must be a plugin (function with `.inject = [...]` or a
   `Service` subclass with `static inject`) listing every service it touches.
   Accessing `root.tools` from a bare root context throws
   "cannot get property ... without inject".
2. **`prepareCall` contract.** The `llm` service's `prepareCall(config)`
   returns a prepared call handle: `{ config, stream(request) }`. Returning
   only `{ config }` compiles but fails at runtime with
   `preparedCall.stream is not a function`.
3. **`dsh-tool-fs` / `dsh-tool-todo` are function plugins** (export `apply`),
   not classes. Mount with `root.plugin(ns)` where `ns` is the module
   namespace. Class-style `root.plugin(DefaultExport)` silently fails.
4. **Plugin `Config` must be a schemastery schema** (`z.object({...})`), not
   a plain object. A plain object fails cordis config validation with
   `Cannot read properties of undefined (reading 'validate')` — reported on
   the fiber's rejection, which is swallowed unless you attach error handlers
   to every `root.plugin(...)` fiber (`.then(ok, err => log)`).
5. **Tool result DTOs are exact.** `dsh-tool-fs`'s write tool executes the
   `fs` service and repackages its return into
   `{path, operation: "create"|"update", before: string|null, after}` with
   `additionalProperties: false`. Extra/missing fields fail validation
   (`tool "write" returned invalid output: value is not lossless JSON`).
   Mirror the DTO shapes from `dsh-tool-fs/lib/index.js` exactly.
6. **`fs` service contract** (implemented by `cli/node-fs.js`): `resolve(path,
   opts) -> {targetKey, displayPath}`, `stat(target, signal) ->
   {version, type, size} | undefined`, `readText`, `streamText -> lines`,
   `readBytes(target, signal, cap)`, `writeText(target, content, expected,
   signal) -> {operation, before, after}`, `editText(target, {oldString,
   newString, replaceAll}, expected, signal) -> {version, before, after}`,
   `listDir`. `expected.kind` is `createIfAbsent` | `replaceIfVersion`; wrong
   kinds are the caller's bug.
7. **Adapter stream contract** (`dsh-llm` `LlmAdapter`): `stream(options)`
   yields BlockAssembler chunks: `block-start {index, blockType}`,
   `text-delta`/`reasoning-delta`/`tool-call-delta {index, id?, name?,
   argumentsDelta}`, `block-end {index, block}`, optional `usage`, terminal
   `finish {reason: {kind: stop|max-tokens|error|aborted}}`. `options` carries
   `{provider, model, messages, system, tools, signal, maxTokens}`. An empty
   `tools` at the adapter means the schemas were never wired (see pitfall 1 —
   the plugin registering tools must have activated).
8. **Max-tokens ends the turn** (no intra-turn continuation step): the loop
   records `turn/end {reason: {kind: max-tokens}}` and the host/upper layer
   decides to follow up.
9. **Steering vs follow-up**: `agent.steer(msg)` lands in the `next-step`
   inbox (injected at the next step boundary, mid-turn); `agent.followup(msg)`
   lands in `next-turn` (new turn). Steering messages are spliced into the
   session log as `agent/inbox/spliced` events.

## Engine differences found (the compat layer's job)

- **QuickJS `Function.prototype.toString`** renders native functions as
  `function Object() {\n    [native code]\n}`; V8 renders the single-line
  form. `dsh-tools` intrinsic detection string-compares the V8 form, so tool
  registration fails on QuickJS. Fix in `polyfills.js`: normalize the
  toString output. NEVER patch upstream for engine quirks.
- **QuickJS `await` is C-internal** and bypasses JS-visible
  `Promise.prototype.then`, so a promise-chain AsyncLocalStorage prelude
  cannot capture context through await continuations. Fix: build with
  esbuild `--target=es2016`, which LOWERS async/await to generators that go
  through the patched `then`. Same bundle, both engines, byte-identical
  traces.
- **Google Gemini 3 `thoughtSignature`**: the SSE response carries the
  signature as a part-level sibling of `functionCall` (camelCase), and the
  REQUEST must echo it back at the same part level. Putting it inside
  `functionCall` (or using snake_case) returns HTTP 400. The adapter keeps an
  in-memory `callId -> signature` map; a persistent host would need it in
  replay state.
- **Gemini role alternation**: consecutive same-role history entries are
  rejected; merge them into one turn when converting DSH messages.
- **Gemini model availability moves fast**: `gemini-2.5-flash` 404s for new
  keys; list live models via
  `GET https://generativelanguage.googleapis.com/v1beta/models?key=KEY`.
  AI Studio free quota is PER MODEL — switch models to keep testing.

## Validation procedure (the conformance gate)

`./run.sh`: rebuild the portable bundle, run the 5 scripted scenarios on
Node, diff against `baseline.node.json` (hash-pinned in `baseline.sha256`),
and when a qjs binary exists run the SAME bundle on QuickJS and diff
byte-for-byte. Rules:
- Volatile fields (`id`, `timestamp`, stack traces, UUIDs) are normalized to
  placeholders before comparison.
- Fake-provider scenarios must cover: plain text, tool round-trip,
  parallel+exclusive tool scheduling (model-ordered commits), max-tokens
  truncation, mid-turn steering.
- Every upstream `@deepseek-ai/*` bump MUST pass `./run.sh` before merging;
  a new `node:*` import in upstream surfaces as either a bundle error or a
  loud shim failure (`fs.js`/`sqlite.js` stubs throw on use).

## Adding a new host (checklist)

1. Copy the boot-plugin pattern from `main.js`/`cli/cli.js` (inject list:
   `agents, sessions, llm, tools, systemPrompt, agentLoop`).
2. Provide an `llm` service: either the real `LlmRuntime` +
   `registerAdapter(["provider"], adapter)`, or a fake for replay tests.
3. Mount `AgentRegistry`, `SessionStore`, `SystemPrompt`, `ToolRuntime`
   before the boot plugin; register tools only after `ToolRuntime` is loaded.
4. Attach `.then(ok, err)` handlers to EVERY plugin fiber during bring-up —
   silent fiber failures are the #1 time sink.
5. For files: implement the `fs` service (contract above) or mount
   `dsh-fs-local` where native modules are allowed.
6. Validate with the conformance gate, then with a live provider smoke test
   (one text turn + one tool turn).
