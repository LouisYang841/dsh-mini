# ROADMAP — feature audit, sourcing, priorities

Sourcing order (see AGENTS.md): **pi-native → DSH minimal → self-written glue**.
Terminal-first: if the bash tool already covers it, it is not a feature.

## P0 — next

### pi-ai multi-provider adapter (挖 pi, seam ①)

One `LlmAdapter` over `@earendil-works/pi-ai` (the provider library pi itself
uses) unlocks OpenAI / Anthropic / Ollama / Bedrock / OpenRouter / local
models, plus the model catalog — `--list-models` comes nearly free. Cost:
one adapter file (~150 lines, same shape as `gemini-adapter.js`) + pi-ai as a
build-time dep. The Gemini adapter stays as the reference for streaming
quirks (thought signatures etc. are provider-specific).

## P1 — UX from the pi-tui package we already ship

- **Markdown rendering for assistant replies** (pi-tui `Markdown` component;
  `marked` is already in the bundle).
- **Path + slash-command autocomplete** for the input (pi-tui autocomplete).
- **Editor component** for multiline prompts (pi-tui `Editor`).
- All three are pure wiring — the components exist in the vendored package.

## P2 — DSH pulls, all pure packages

- **Skills**: `dsh-skill` (registry, pure) + `dsh-tool-skill` (loader tool,
  pure) + a minimal self-written scanner for `skills/**/SKILL.md` (avoid
  `dsh-skill-filesystem`'s chokidar + yaml). MEDIUM — only when there are
  enough skills to matter; the engine skill lives in this repo already.
- **Compaction**: `dsh-compaction` + `dsh-compaction-basic` + `dsh-token-meter`
  (all pure; trigger wiring is the open question). MEDIUM — defer until
  sessions actually exceed context; /stats already exposes the pressure.
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
