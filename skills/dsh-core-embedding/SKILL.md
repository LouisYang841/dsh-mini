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
   **A required Config field without a default silences the whole plugin:**
   `dsh-tool-todo`'s Config is `z.object({ allowParallelInProgress:
   z.boolean().required() })`. Mounting it with NO config makes config
   validation fail and the fiber dies fire-and-forget — the mount "succeeds"
   but `todo_write` never registers (`unknown tool "todo_write"`). Always
   mount it as `root.plugin(ns, { allowParallelInProgress: true })`, and
   probe `ctx.tools.view(...).visible` for the tool names you expect after
   mounting.
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


## Persistence & resume pitfalls (CLI layer)

- **Cordis function-plugin async bodies are fire-and-forget**: `fiber.await()`
  resolves once the plugin callback RETURNS — a pending promise does not keep
  it pending, and a rejection is invisible unless you attach handlers.
  `[mount] X OK` therefore means "loaded", NOT "body finished". Wrap long
  bodies in try/catch, race them against timeouts, and always attach
  `.then(ok, err)` to every `root.plugin(...)` fiber.
- **argv parsing**: `process.argv[indexOf("--resume") + 1]` returns argv[0]
  when the flag is absent (indexOf = -1). Guard with an explicit index check.
- **JSONL backend mount is enough**: `dsh-session-persistence-jsonl`
  registers as `ctx.sessionPersistence` and installs its own write path
  (200 ms batch window; `session/flush` is emitted by the optional
  checkpoint-policy plugin, not required). Do NOT also mount
  `dsh-session-persistence` (the shared coordinator package is pulled
  transitively; the backend embeds its coordinator instance).
- **Coordinator swallows creation errors** (`live.init.catch(() => {})`):
  a failed first write is invisible. Verify with `sessionPersistence.list()`
  after the first turn; if it is empty, check the sessions root is writable
  (in this dev sandbox, writes outside the workspace are denied — use
  `DSH_SESSIONS=/tmp/...` for tests).
- **Restore validation is stricter than live append**: persisted sessions
  are validated on load; user messages WITHOUT a `source` fail with
  "message has invalid source". Always create user messages with
  `source: { kind: "user" }`.
- **Sessions are stored per-cwd** under the configured root
  (`--<sanitized-cwd>--/<id>.jsonl`, zstd by default via node:zlib on
  Node 22+; the backend needs `--external:koffi` when bundling — koffi is
  only loaded on Windows).
- **Resume flow**: `ctx.agentLoop.resume(ctx, { resumeSessionId, agentOptions })`
  returns `{ agent, dispose }`; it reads `sessionPersistence` via
  `ctx.get("sessionPersistence")` from the AgentLoop's own context.

## pi-tui shell integration (cli/tui-renderer.js)

- Layout: `TruncatedText` status bar + `ScrollView(primary, follow:"end")`
  wrapping a `VStack` of `Text` lines + `Input` for the prompt.
  `tui.addInputListener` + `matchesKey(data, "ctrl+c")` for exit/interrupt.
- `VStack` is a Container: append lines with `lines.addChild(new Text(...))`;
  stream deltas by buffering and `setText` on the current assistant Text.
- **TDZ trap**: the host is constructed BEFORE the shared `handleLine` is
  declared — `const handleLine` referenced from an onSubmit callback throws
  "Cannot access before initialization" on the FIRST keystroke. Declare
  shared handlers as hoisted `function` declarations.
- pi-tui vendors cleanly: `@earendil-works/pi-tui` + `get-east-asian-width`
  + `marked` tarballs under `vendor/node_modules`, entry aliased in the
  build (`--alias:@earendil-works/pi-tui=./vendor/.../dist/index.js`); CI
  gets the same packages from npm.

## pi-native bash tool (cli/bash-tool.js + vendor-pi/)

- **Prefer pi's native pieces over DSH packages when the seam allows**: the
  bash tool vendors pi's executor verbatim (`vendor-pi/bash-executor.ts`:
  streaming, ANSI/binary sanitization, 50KB truncate-tail, temp-file spill,
  abort) and reimplements only the platform glue (local `BashOperations`:
  `spawn("bash", ["-c", cmd], {detached:true})` + `process.kill(-pid)`).
  This replaces the whole DSH bash stack (shell/sandbox/sandbox-policy/
  subprocess-local/node-pty) with ONE tool definition.
- Tool DTOs must be JSON-lossless: strip `undefined` fields
  (`...(x ? {fullOutputPath: x} : {})`) or snapshot validation fails with
  "value is not lossless JSON".
- Rebuild after every tool edit — a stale bundle fails exactly like the
  unfixed code (symptom: live run errors while the isolated replay passes).
- Vendored pi files are MIT; keep the attribution header.

## CLI host pitfalls (second batch)

- **Piped stdin swallows lines**: `readline` consumes a whole chunk and emits
  all `line` events before the next `rl.question` is registered, so piped
  answers to consecutive questions are lost. Use one persistent `line`
  listener + a queue (`lineQueue`/`lineResolver` in cli.js).
- **Close must not kill a busy process**: `rl.on("close", () =>
  process.exit(0))` terminates mid-turn when a pipe closes. Exit only when
  idle; otherwise latch a flag and exit after `whenIdle()`.
- **TDZ strikes again**: `close`/`onSubmit` callbacks registered before
  `busy`/`agent` declarations — hoist shared mutable state to the top of the
  boot body.
- **dsh-llm-deepseek**: function plugin (`apply`), provider route
  `deepseek-official`; the API key resolves from the credentials service or,
  absent one, from the env var named by `apiKeyEnv` (`DEEPSEEK_API_KEY`).
- **AGENTS.md injection**: `ctx.systemPrompt.section({name:
  "workspace:agents", order: -90, ...})` from the boot plugin lands in the
  global prompt layer and reaches every agent; verify via
  `DSH_DEBUG=1` + grep for the section marker in stderr — the debug print is
  MULTILINE, so `grep "header.system"` alone only shows the first line.

## Cut-big-keep-small findings

- **koffi is platform-lazy in BOTH official backends**: dsh-fs-local and
  dsh-session-persistence-jsonl only `await import("koffi")` inside the
  Windows ACL branch (advapi32/kernel32). On Linux/Termux they are
  effectively pure — mount them; mark `--external:koffi` when bundling.
- **dsh-credentials-local is the big head, not the service**: the
  credentials SERVICE is pure, but its only store backend drags chokidar +
  yaml — keep the 80-line env loader instead.
- Official dsh-fs-local returns the write/edit DTOs exactly as dsh-tool-fs
  expects (atomic rename, stale-version checks, diff bases) — mounting it
  removes a whole class of hand-replicated DTO bugs.

## Multi-provider (dsh-llm-pi-ai) findings

- The official `dsh-llm-pi-ai` mounts as a function plugin with
  `providers: { <route>: { apiKeyEnv: "ENV_NAME" } }`; routes not present in
  pi-ai's installed catalog MUST list `models` explicitly or resolveProfiles
  throws ("provider X resolves no models"). pi-ai 0.82.1 has no ollama
  catalog entry; model ids come from the catalog (`deepseek-v4-flash`).
- Bundling pi-ai statically pulls the provider SDKs (AWS Bedrock, Anthropic,
  Google genai, Mistral) — the CLI artifact grows to ~7.6MB. Acceptable for
  the Node CLI; keep the portable engine bundle free of it.
- Two DeepSeek routes coexist: `deepseek-official` (dsh-llm-deepseek,
  direct) and `deepseek` (pi-ai) — distinct route strings, no adapter clash.

## Skills welding (cli/skill-scanner.js)

- The DSH registry/tool pair is pure and mounts directly; the OFFICIAL
  scanner (dsh-skill-filesystem) is the big head (chokidar + yaml) — the mini
  scanner implements the same provider contract: `list()` returns candidates
  {name (kebab), description, whenToUse?, invocation, source, provider, rank,
  locator, path}; `get(candidate)` returns the definition with the markdown
  body. Frontmatter parsing is yaml-LITE (scalar key: value lines only) —
  fine for name/description/whenToUse.
- `dsh-tool-skill` injects agents/tools/skills and registers the model-facing
  `skill` tool; calling it with a name renders `<skill_content>` blocks.
- Skill roots: `<cwd>/skills` + `~/.dsh-mini/skills`; `<name>/SKILL.md` or
  `<name>.md`.

## Compaction + titles findings

- `dsh-compaction-basic` REQUIRES the real `LlmRuntime` (it calls
  `ctx.llm.resolveModelInfo`); a hand-rolled llm SERVICE misses the method
  and the hook swallows the TypeError (ctx.logger.warn). Context capacity
  comes from the ADAPTER's `resolveModel` (`context.contextWindow`), not from
  `prepareCall`.
- Auto compaction triggers between steps when the meter's totalTokens
  exceeds thresholdRatio × contextWindow; the surface range selector needs
  balanced boundaries, so tiny single-turn replay surfaces silently select
  nothing (`range === null` → return). Test with multi-turn histories.
- Session titles = `dsh-session-title` (service) + the first-prompt LLM
  provider, gated behind `DSH_TITLES=1` — each new session costs one silent
  model call; never default-on for free-tier keys.

## Final wiring pass findings

- **Bare slash commands fall through to the model**: `/provider` without an
  argument missed the `startsWith("/provider ")` guard (trailing space) and
  went to the agent as a prompt — the agent then explored the repo with bash.
  Guard bare forms (`trimmed === "/x"`) BEFORE the prefixed forms.
- **cc-tui piped-input timing**: input piped at pty creation is consumed
  before the TUI's raw-mode StdinBuffer mounts; delay the send a few seconds
  (`(sleep 6; printf '...\r')`) and the full cycle works — model wait
  spinner, reply, "Completed", token/cache status, steering hints.
- The community TUI consumes our services directly (tokenMeter feeds its
  status bar; persistence/skills/commands/ask-user all wired); titles
  auto-mount with DSH_CC_TUI because its session list expects them.

## Release artifact self-containment

- dsh-llm reads its own version via `createRequire(import.meta.url)
  ("../package.json")` — the CLI bundle must alias `node:module` to the shim
  (like the portable build), or the standalone artifact crashes with
  MODULE_NOT_FOUND on hosts with no package.json beside it. Caught on the
  phone; fixed in cli-build.sh.
- Phone deploy recipe (verified): scp the artifact → pipe `\n<key>\n<prompt>`
  into first run for the interactive setup (key never transits to the
  controlling machine if you run the extraction on-device) → keys persist to
  `~/.dsh-mini/env`, sessions to `~/.dsh-mini/sessions`.

## Android/Termux persistence (phone-verified)

- **Android SELinux denies hard links** inside app-private storage
  (`link()` → EACCES). dsh-session-persistence-jsonl publishes via
  temp-write + fsync + `link(tmp, final)` + dir-fsync and SWALLOWS the
  error — symptom: per-session directories appear but stay empty. Fix:
  `shims/fs-promises.js` (aliased in the CLI build) falls back to
  `rename()` for EACCES/EPERM/EXDEV/ENOTSUP. Reference: pi's JSONL repo
  uses rename-based atomic publish on every platform — that is why pi
  persists fine on Termux.
- **`process.exit()` kills the 200ms write batch**: quick `/stats`+`/exit`
  runs persisted nothing. Exit paths must emit `session/flush` and wait
  ~500ms (gracefulExit in cli.js; same in tui-renderer).
- Debugging on the phone: upload a small probe bundle (remember the
  node:module + fs/promises aliases), attach `.then(ok, err)` handlers to
  EVERY fiber — a parked boot fiber exits 0 with zero output.
- Termux specifics: `/tmp` is not writable (upload to `~/`); session files
  are `session.jsonl.zstd` inside per-session directories
  (`root/--cwd--/<id>/`); zstd works on Node 25.

## Vendor patch delivery (deterministic builds)

- Vendor cosmetic patches (accent blue, todo cap) must be applied by the
  BUILD (patches/apply-dsh-tui-patches.py, wired into cli-build.sh) against
  whichever copy esbuild bundles — local vendor/ or CI's npm install.
  Patching only the local vendor copy silently diverges CI artifacts from
  releases. Detection is marker-based, idempotent.
- Patch policy: cosmetic, config-less presentation changes ONLY — never
  logic (skill rule).

## cc-tui palette patch (vendor override policy)

- The community TUI's accent was SGR 95 (bright magenta) — visually harsh and
  off-brand. Override: `accent.open` 95 -> 34 (DeepSeek blue) directly in
  `vendor/node_modules/@openguardrails/dsh-tui/lib/index.js`, with an inline
  comment pointing here. Vendor overrides are allowed ONLY for cosmetic,
  config-less changes that upstream does not expose — never for logic.
- Branding: the plugin Config takes `title` (terminal title) and `welcome`
  (startup banner); both default to DeepSeek-branded values already, we set
  them explicitly ("dsh-mini · DeepSeek Harness").

## Distribution hygiene

- **Zero runtime npm deps**: every @deepseek-ai/@earendil-works package is
  BUILD-TIME only; they live in devDependencies, trimmed to direct imports.
  Consumers take release artifacts (curl) or plain engine files — never an
  npm install. `npm install --omit=dev` must install nothing; if it doesn't,
  a runtime import snuck in and the manifest is wrong.
- Release artifacts are staged in the workspace (dist/) and attached via
  `gh release create` — the sandbox isolates /tmp between commands, so
  absolute /tmp paths fail inside gh.

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
