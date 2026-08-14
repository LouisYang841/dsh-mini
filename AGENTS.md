# AGENTS.md — how to work on dsh-mini

Guidance for coding agents (including dsh-mini itself) developing this repo.

## What this is

dsh-mini = the DeepSeek Harness (DSH) core as a portable engine, assembled
into a lightweight coding-agent CLI with pi's shell (real `@earendil-works/
pi-tui`) and pi-native pieces wherever the seam allows. The project's core
work is **assembly and decoupling**, not new engine logic.

Architecture map: `ARCHITECTURE.md` (the five seams). Pitfall catalog:
`skills/dsh-core-embedding/SKILL.md` — read it before touching the seams.
Feature priorities: `ROADMAP.md`.

## Sourcing rules (in this order, always)

1. **pi-native first**: reuse/vendor `@earendil-works/pi-*` pieces when they
   fit a seam. Vendor verbatim into `vendor-pi/` with an MIT attribution
   header; adapt import paths only. Reimplement platform glue only when the
   original file drags in entangled imports (pi-tui/typebox/config).
2. **DSH minimal**: otherwise pull `@deepseek-ai/dsh-*` packages using the
   cut-big-keep-small criterion (ADR-0002 in `DECISIONS.md`): ADOPT small
   heads (pure JS, or native deps that are platform-lazy dynamic imports —
   koffi in dsh-fs-local/persistence is Windows-only); REJECT big heads
   (chokidar, node-pty, landlock, `@vscode/ripgrep`, MCP SDK, top-level
   koffi) and self-write the seam glue instead.
3. **Self-write last**: small glue files are fine; never reimplement engine
   semantics.

Terminal-first: dedicated tools for what the bash tool already covers
(grep/find/ls/web fetch via curl) are NOT worth building. Prefer teaching
the agent to write its own scripts. Docs for agents beat tools for agents.

## Hard rules

- **Zero runtime npm deps.** Everything npm is build-time only (devDependencies,
  trimmed to direct imports). `npm install --omit=dev` must install nothing.
  A new runtime import must come with a manifest justification or a release-
  artifact note.
- **Engine quirks live in `shims/` or `polyfills.js`**, never in vendored
  upstream code. Each shim documents the engine difference it normalizes.
- **Credentials via env only** (`GEMINI_API_KEY`); `.env` is gitignored,
  `.env.example` is the template. Nothing secret goes into source, commits,
  or release notes.
- **License hygiene**: every NEW bundled dependency must be added to
  `THIRD_PARTY_LICENSES.md` (component + license + copyright line) in the
  same commit; releases attach that file next to the artifact.
- **Conformance gate**: `./run.sh` must stay byte-identical to
  `baseline.node.json` (hash-pinned in `baseline.sha256`) after every
  upstream `@deepseek-ai/*` bump and every engine-side change. Scenarios in
  `main.js` use a fake provider — no live API, no quota.
- **New pitfalls go into the skill** (`skills/dsh-core-embedding/SKILL.md`)
  in the same commit that fixes them.
- CI must be green before tagging; releases attach rebuilt artifacts
  (staged in `dist/`, gitignored).

## Dev commands

```sh
./build.sh                 # portable engine bundle (bundle.mjs)
cli/cli-build.sh           # CLI bundle (cli/cli.mjs); vendor alias is auto
./run.sh                   # conformance: Node (+QuickJS if built) vs baseline
node cli/cli.mjs <model>   # run locally (GEMINI_API_KEY required)
```

Local quirks: no npm/npx on the dev box — esbuild lives in
`/home/ubuntu/Dsh_workspace/spike-tools/node_modules` (ESBUILD env overrides);
`node_modules` is a symlink to `/home/ubuntu/dsh/node_modules`
(DSH_NODE_MODULES overrides); the shell sandbox isolates /tmp per command and
denies writes outside the workspace (use `DSH_SESSIONS=/tmp/...`-style paths
inside the workspace for tests, stage release files in `dist/`).

## Testing without burning quota

Fake-provider replay is the standard trick (see `main.js` scenarios and the
`bash-test.tmp.js` pattern in history): boot the same services with a scripted
`llm` service, drive one turn, assert on `session.events`. Live model tests
only for final smoke; AI Studio free quota is per model, switch models.

## Release checklist

1. CI green on the commit to tag.
2. `./build.sh && cli/cli-build.sh`; copy `cli/cli.mjs` → `dist/dsh-mini.mjs`,
   `bundle.mjs` → `dist/dsh-engine.mjs`.
3. `git tag vX.Y.Z && git push origin vX.Y.Z && gh release create vX.Y.Z
   dist/dsh-mini.mjs dist/dsh-engine.mjs`.
4. `scripts/install.sh` downloads `releases/<tag>/download/dsh-mini.mjs` —
   keep the artifact name stable across releases.
5. Attach `THIRD_PARTY_LICENSES.md` to the release (license notices travel
   with the artifact).

## File map

- `main.js` — engine boot reference + fake-provider conformance scenarios
- `shims/`, `polyfills.js` — seams ④/⑤ (engine surface)
- `cli/cli.js` — host boot + shared command handling (plain + TUI)
- `cli/tui-renderer.js` — pi-tui shell
- `cli/gemini-adapter.js` — seam ① reference adapter
- `cli/node-fs.js` — seam ② reference implementation
- `cli/bash-tool.js` + `vendor-pi/` — pi-native bash tool (seam ③ untouched)
- `cli/banner.js` — hermes-style ANSI-Shadow banner, DeepSeek-blue gradient, width-adaptive
- `skills/dsh-core-embedding/SKILL.md` — everything we learned the hard way
