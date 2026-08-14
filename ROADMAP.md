# ROADMAP — feature audit, sourcing, priorities

Sourcing order (see AGENTS.md): **pi-native → DSH minimal → self-written glue**.
Terminal-first: if the bash tool already covers it, it is not a feature.

Sourcing criterion (ADR-0002 in `DECISIONS.md`): cut big heads, keep small
heads — pull official packages whose native deps are platform-lazy; reject
chokidar/node-pty/landlock/ripgrep and write seam glue instead.

## Done

- [x] Official `dsh-fs-local` backend replaces the hand-written NodeFs
  (koffi is Windows-lazy; replay-verified write/edit/read, 0 errors)
- [x] DeepSeek default provider (DSH's `dsh-llm-deepseek`, route
  `deepseek-official`, `deepseek-v4-flash`); Gemini stays via the reference
  adapter; `/provider` switch; first-run interactive key setup with
  persistence (`~/.dsh-mini/env` / `.env` fallback) + env loader.
- [x] `AGENTS.md` workspace-instruction injection (system prompt section,
  order -90, `DSH_NO_AGENTS=1` to disable).

## P0 — done

### pi-ai multi-provider adapter (挖 DSH, seam ①)

Mounted DSH's official `dsh-llm-pi-ai` (the same pi-ai-backed adapter the web
profile uses — zero adapter code of our own): routes for `deepseek`,
`openai`, `anthropic`, `openrouter` auto-enable when their env keys exist
(`DEEPSEEK_API_KEY`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY`),
live-verified end-to-end on the `deepseek` route. Notes: pi-ai 0.82.1 has no
`ollama` catalog entry (routes without catalog models must list `models`
explicitly — revisit with newer pi-ai); model ids follow pi-ai's catalog
(`deepseek-v4-flash`); the CLI artifact grows to ~7.6MB from the bundled
provider SDKs (the portable engine bundle is unaffected at 419KB).

## P1 — done (accepted on a real terminal)

- [x] **Community full-screen TUI promoted to DEFAULT** (real-terminal
  acceptance by the user); our minimal shell stays behind `DSH_TUI=basic`,
  plain mode via `DSH_PLAIN=1`. Titles auto-mount with the cc-tui.

## P1 (original) — UX from the pi-tui package we already ship

- **Markdown rendering for assistant replies** (pi-tui `Markdown` component;
  `marked` is already in the bundle).
- **Path + slash-command autocomplete** for the input (pi-tui autocomplete).
- **Editor component** for multiline prompts (pi-tui `Editor`).
- All three are pure wiring — the components exist in the vendored package.

## Done — DSH web-parity core

- [x] **Goals**: dsh-goal + dsh-tool-goal + dsh-goal-round-driver (all pure) —
  create_goal/update_goal/get_goal tools, same-session auto round
  continuation (replay-verified: 2 rounds then round-limit block);
  `/goal` command shows objective/phase/rounds.
- [x] **Plan mode**: dsh-plan-mode (pure) — the community TUI renders plan
  review dialogs.
- [x] **Todo panel**: the community TUI's standing Plan panel (todo/write
  events) capped at the 3 most recent non-completed items (+ dim counter) —
  deterministic vendor patch via patches/apply-dsh-tui-patches.py so CI
  artifacts match local releases.

## P2 — DSH pulls, all pure packages

- [x] **Skills**: `dsh-skill` registry + `dsh-tool-skill` loader tool (both
  pure) + our ~100-line filesystem scanner (`cli/skill-scanner.js`; rejects
  `dsh-skill-filesystem`'s chokidar + yaml). Roots: `<cwd>/skills` +
  `~/.dsh-mini/skills`; replay-verified load of the embedded
  `dsh-core-embedding` skill.
- [x] **Compaction**: `dsh-compaction-basic` (bundles the abstract core) +
  `dsh-token-meter`, both pure. Triggers via `agent/pre-step` pressure checks
  (0.8 × adapter contextWindow, tunable with `DSH_COMPACT_RATIO`) and
  context-overflow recovery. Live triggering is hard to smoke-test without a
  huge session; the replay harness has a pending TODO (the range selector
  needs a multi-turn surface with balanced boundaries).
- [x] **Session titles**: `dsh-session-title` + `dsh-session-title-first-
  prompt-llm` (pure) mounted behind `DSH_TITLES=1` (one silent LLM call per
  session — opt-in by default).
- **Session titles**: `dsh-session-title-first-prompt-llm` (LLM titles for
  `/sessions`). LOW.

## P3 — nice-to-have

- **Transcript export (HTML/markdown)** — pi has export-html; adapt the idea,
  not the module. LOW.

## Deliberately skipped (for a lightweight CLI)

| Feature | Why skip |
|---|---|
| grep/find/ls tools | bash tool covers them; DSH's search tool needs the `@vscode/ripgrep` native package — strictly worse than terminal-first |
| web search / page fetch tools | `curl` via bash covers the basics; `dsh-web-search-deepseek` needs a DeepSeek search key, `dsh-tool-web` pulls turndown |
| MCP | `dsh-mcp-client` pulls `@modelcontextprotocol/sdk`; revisit only when a host integration demands it |
| answer variants / undo | conflicts with append-only event-sourced sessions; low value |
| interactive process terminal | non-interactive bash tool suffices; pi's ProcessTerminal integration is a TUI rabbit hole |
| goals / subagents / workflows (DSH-side) | powerful but they need UX + background semantics a lightweight CLI does not have; the ENGINE keeps them for other hosts |
| session branches / lanes (pi harness) | pi's session-tree architecture, not DSH's linear sessions; not planned |
| image attachments / vision tools | needs provider-specific media plumbing; revisit after the pi-ai adapter if a provider makes it cheap |

## Terminal-first note

Anything on the skip list the agent can self-assemble at runtime via the bash
tool (curl pipelines, scripts, per-task tooling). The highest-leverage
investment is agent-facing documentation (`AGENTS.md`, `ARCHITECTURE.md`,
`skills/`) — that is what turns a terminal into tools.
