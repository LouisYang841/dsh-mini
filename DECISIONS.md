# DECISIONS.md

Recorded choices and rejected alternatives, so future agents do not re-litigate
the architecture.

## ADR-0001: assemble the engine instead of forking official dsh

**Decision**: pull the DSH core as npm-pinned packages behind five seams
(ARCHITECTURE.md), bundling a portable engine artifact, instead of forking the
official dsh repo and cutting it down.

**Evidence**: the official `@deepseek-ai/*` tree is 188 packages; the
transitive closure of our build deps is **13** (7%): cordis, schemastery,
dsh-agent, dsh-agent-loop, dsh-llm, dsh-session, dsh-system-prompt,
dsh-tools, dsh-tool-fs, dsh-tool-todo, dsh-fs, dsh-fs-local,
dsh-session-persistence-jsonl. The cut (175 packages) is dominated by the web
client UI (40), tool family (17), session extras (14), and web host (8) — a
fork would have to delete those anyway, and the engine kernel would be the
SAME 13 packages either way. The real differences live outside the engine.

**Why not fork-and-cut**: (1) the official tree has no terminal UI at all, so
the TUI/REPL/credential UX would still have to be written; (2) the launcher +
profile/bundle/patch-layer boot machinery is itself ~2000 lines of glue to
learn and shrink, versus ~150 lines of boot plugin here; (3) a fork is
Node-only — the portable-engine goal (QuickJS/Termux/Operit) would still
require the bundle + shim work, so nothing is saved; (4) assemble gave us a
conformance gate (byte-identical traces) that a fork does not naturally
produce.

## ADR-0002: sourcing criterion — cut big heads, keep small heads

**Decision**: for every missing piece, classify the official package before
writing anything:
- **Small head** (pure JS, or native deps that are platform-lazy): pull it.
- **Big head** (chokidar, node-pty, landlock, `@vscode/ripgrep`, MCP SDK,
  top-level koffi): self-write the seam glue, or vendor pi-native.

**Applied results**:

| Piece | Official | Verdict |
|---|---|---|
| fs backend (`dsh-fs-local`) | koffi, but dynamic import in the Windows-ACL branch only → pure on Linux/Termux | **ADOPTED** (deleted our 200-line NodeFs; `cli/node-fs.js` stays as the portable-host contract reference) |
| persistence backend (`dsh-session-persistence-jsonl`) | koffi, Windows-lazy; zstd via node:zlib (bundled in Node >= 22.15) | **ADOPTED** |
| DeepSeek adapter (`dsh-llm-deepseek`) | eventsource-parser (pure) | **ADOPTED** |
| credentials STORE (`dsh-credentials-local`) | chokidar + yaml | **REJECTED** — kept our 80-line env loader instead |
| skills scanner (`dsh-skill-filesystem`) | chokidar + yaml | **REJECTED** — kept our 30-line AGENTS.md injector |
| bash tool (official shell/sandbox stack) | node-pty + landlock native addons | **REJECTED** — pi-native executor vendored instead |
| grep/search tool | `@vscode/ripgrep` native package | **REJECTED** — bash covers it (terminal-first) |
| session titles (`dsh-session-title-first-prompt-llm`) | schemastery only (small head) | **AVAILABLE** — mount behind an env flag; it silently spends one model call per session |

**Net effect**: ~200 lines of hand-written infrastructure deleted, and every
remaining self-written file is a seam glue justified by a big-head rejection.
