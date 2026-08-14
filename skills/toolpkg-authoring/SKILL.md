---
name: toolpkg-authoring
description: How to add a custom out-of-process tool to dsh-mini (for example web_search) and debug toolpackage manifests.
whenToUse: User asks dsh-mini to create/add/customize one of its own tools; writing `*.tool.json` toolpackages; /tools reports manifest or execution errors.
---

# Authoring dsh-mini toolpackages

Full contract: [`docs/toolpackages.md`](../../docs/toolpackages.md).

## TL;DR

1. Put a manifest in `<cwd>/tools/<name>.tool.json` or
   `~/.dsh-mini/tools/<name>.tool.json`.
2. `parameters` is a **name → property-schema map**, not a JSON Schema root:
   `{ "query": { "type": "string", "required": true } }`.
3. `output` is a DSH JSON schema. Object output MUST set
   `additionalProperties` explicitly, otherwise registration fails.
4. `command` runs from the manifest directory. JSON args arrive on stdin;
   print one JSON value on stdout.
5. Secret-looking env vars are stripped by default; a tool that needs one
   declares `"allowEnv": ["DEEPSEEK_API_KEY"]` in its manifest.
6. Run `/tools reload`, then `/tools` to see registration count and errors.
7. Custom tools appear only in `standard` mode; `minimal` stays
   `bash + str_replace_editor`.

## Minimal manifest

```json
{
  "name": "my_tool",
  "description": "One sentence for the model.",
  "parameters": {
    "text": { "type": "string", "required": true, "description": "Input text." }
  },
  "output": { "type": "object", "additionalProperties": true },
  "command": ["node", "./my-tool.mjs"],
  "timeoutMs": 30000,
  "allowEnv": []
}
```

## Node implementation skeleton

```js
let input = ''
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', async () => {
  try {
    const args = JSON.parse(input || '{}')
    const result = { ok: true, args }
    process.stdout.write(JSON.stringify(result))
  } catch (error) {
    process.stderr.write(String(error?.stack ?? error))
    process.exit(1)
  }
})
```

## Debugging

- Test the executable directly first:
  `echo '{"text":"hello"}' | node tools/my-tool.mjs`
- Non-zero exit and stderr become the model-visible tool error.
- stdout over 1 MiB, timeouts, and aborts kill the child.
- If `output.type` is `"string"`, plain non-JSON stdout is accepted; every
  other schema requires valid JSON on stdout.
- Duplicate tool names and invalid schemas are reported by `/tools`.
- Script edits do not need `/tools reload`; manifest edits do.

## Trust

A toolpackage is as trusted as the `bash` tool and runs with the user's
permissions. Do not use toolpackages to bypass review or hide side effects.
Prefer read-only or idempotent tools unless the user requested mutating ones.
