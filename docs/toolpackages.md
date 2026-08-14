# Toolpackages: custom out-of-process tools for dsh-mini

dsh-mini can load agent- or user-authored tools from ordinary files. A
**toolpackage** is one `*.tool.json` manifest plus whatever executable the
manifest's `command` points to. Tools run as child processes, never inside the
dsh-mini process.

This document is the machine-facing contract. The short agent checklist lives
in [`skills/toolpkg-authoring/SKILL.md`](../skills/toolpkg-authoring/SKILL.md).

## Scan roots

Direct `*.tool.json` files in:

| Root | Owner | Typical use |
|---|---|---|
| `<cwd>/tools` | project | tools committed with the repo |
| `~/.dsh-mini/tools` | user | personal tools shared across projects |

Roots are deduplicated when they resolve to the same directory. Subdirectories
are not scanned; keep one toolpackage per directory if grouping is needed.

Loading happens at startup and on `/tools reload`. `minimal` mode hides custom
tools; `standard` mode exposes them alongside the built-in catalog.

## Manifest schema

A manifest is JSON. All fields except `timeoutMs`, `parameters`, and `output`
are required.

```json
{
  "name": "web_search",
  "description": "Search the web and return source URLs with snippets.",
  "parameters": {
    "query": {
      "type": "string",
      "required": true,
      "description": "Search query."
    }
  },
  "output": {
    "type": "object",
    "additionalProperties": true
  },
  "command": ["node", "./web-search.mjs"],
  "timeoutMs": 30000
}
```

| Field | Meaning |
|---|---|
| `name` | Unique tool name. Must not collide with another toolpackage or a built-in tool. |
| `description` | Model-facing description. This is the main prompt-engineering surface for the tool. |
| `parameters` | Parameter-name → DSH parameter schema object, e.g. `{ "query": { "type": "string", "required": true, "description": "..." } }`. It is NOT a JSON Schema root object. Defaults to `{}`. |
| `output` | DSH JSON schema for the tool result. Defaults to `{ "type": "string" }`. Object schemas must set `additionalProperties` explicitly. |
| `command` | Non-empty argv array. The first entry is the executable; the rest are argv. Relative paths resolve against the manifest's directory. |
| `timeoutMs` | Optional positive integer, default `30000`. The child is killed on timeout. |

DSH tool schemas use the subset accepted by `@deepseek-ai/dsh-tools`: scalar
`type`, object `properties`/`required`/`additionalProperties`, array `items`,
`enum`/`const`, and `oneOf`. Invalid schemas are reported by `/tools` instead
of silently producing a broken tool.

## Execution protocol

When the model calls a toolpackage:

1. dsh-mini spawns `command` with cwd set to the manifest directory and the
   current environment inherited.
2. The model arguments object is serialized as JSON and written to the child's
   stdin. The stream is then closed.
3. The child prints **one JSON value** to stdout.
4. That value is parsed and returned as the DSH tool result.

Error cases:

- Non-zero exit → tool error, stderr tail included when available.
- Invalid JSON on stdout → tool error, unless `output.type` is `"string"`,
  in which case the raw trimmed stdout is returned as text.
- Timeout, abort, or stdout over 1 MiB → tool error; the process tree is
  killed.

The tool implementation never imports dsh-mini code and does not run in the
dsh-mini JavaScript realm. It can be Node, Python, a shell script, a compiled
binary, or anything executable on the host.

## Complete example: echo

`tools/demo_echo.tool.json`:

```json
{
  "name": "demo_echo",
  "description": "Echo the supplied text back as a JSON object.",
  "parameters": {
    "text": {
      "type": "string",
      "required": true,
      "description": "Text to echo."
    }
  },
  "output": {
    "type": "object",
    "additionalProperties": true
  },
  "command": ["node", "./demo-echo.mjs"],
  "timeoutMs": 5000
}
```

`tools/demo-echo.mjs`:

```js
let input = ''
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  const args = JSON.parse(input)
  process.stdout.write(JSON.stringify({ ok: true, text: args.text }))
})
```

Direct smoke test without the model:

```sh
echo '{"text":"hello"}' | node tools/demo-echo.mjs
```

Then inside dsh-mini:

```text
/tools reload
/tools
```

Switch to `standard` mode (custom tools are hidden in `minimal`), and
`demo_echo` is a normal model-visible tool.

## Web search reference

A `web_search` toolpackage can reuse `DEEPSEEK_API_KEY` with the DeepSeek
Anthropic-compatible Messages endpoint and the native `web_search` server tool:

```json
{
  "name": "web_search",
  "description": "Search the web using DeepSeek's server-side search. Returns source URLs and snippets. Cite relevant URLs as markdown links in your answer.",
  "parameters": {
    "query": {
      "type": "string",
      "required": true,
      "description": "Search query."
    }
  },
  "output": {
    "type": "object",
    "additionalProperties": true
  },
  "command": ["node", "./web-search.mjs"],
  "timeoutMs": 60000
}
```

The script should POST to `https://api.deepseek.com/anthropic/v1/messages`
with the normal Anthropic wire shape, enable the `web_search_20250305` server
tool, and map the returned `web_search_tool_result` blocks into a stable JSON
object such as `{ "sources": [{ "title", "url", "snippet" }] }`. No new API
key is required. Alternative providers (Exa, Serper, Brave, etc.) can be added
later with the same manifest and a different script.

## Trust model

A toolpackage has the same trust level as the `bash` tool. It runs with the
user's permissions and can read or modify whatever that user can. Install
toolpackages only from directories you control. The out-of-process boundary
keeps tool bugs from corrupting the dsh-mini JavaScript heap, but it is not a
sandbox.

## Development loop

1. Write `<root>/<name>.tool.json` and its command target.
2. Run the command directly with JSON on stdin to validate behavior.
3. In dsh-mini: `/tools reload`.
4. Run `/tools` to check registration count and manifest errors.
5. Use `standard` mode and ask the model to call the tool once.
6. Keep stdout small and structured; return citations/snippets in the value,
   not only prose in `description`.

## Constraints

- No runtime npm dependency is added by a toolpackage. The tool runs with the
  host's installed runtimes and libraries.
- Toolpackages are files. Put them in a scanned root and they survive restarts;
  model-written in-process plugins do not.
- Manifest changes require `/tools reload`; executable content is read at each
  invocation, so script edits do not require reload.
