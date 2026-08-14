/**
 * Out-of-process toolpackages for dsh-mini.
 *
 * An agent (or user) can create a custom model-facing tool by writing two
 * files in a scanned root:
 *
 *   <root>/<tool>.tool.json   manifest: name, description, parameters,
 *                             command, optional timeout/output schema
 *   <root>/<tool>.mjs         executable (any command array works)
 *
 * At registration time the manifest becomes a normal DSH tool definition.
 * At execution time dsh-mini spawns the command, writes JSON arguments to its
 * stdin, and reads one JSON value from stdout. Tools never run inside the
 * dsh-mini process, so a broken or malicious tool is bounded like bash access.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-mini-tool-scanner'

export const DEFAULT_OUTPUT_SCHEMA = { type: 'string' }

const DEFAULT_TIMEOUT_MS = 30000
const MAX_OUTPUT_BYTES = 1024 * 1024

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function validateManifest(raw, file) {
  if (typeof raw !== 'object' || raw === null) throw new Error('manifest root must be a JSON object')
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) throw new Error('name must be a non-empty string')
  if (typeof raw.description !== 'string' || raw.description.trim().length === 0) throw new Error('description must be a non-empty string')
  if (!Array.isArray(raw.command) || raw.command.length === 0 || raw.command.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error('command must be a non-empty array of non-empty strings')
  }
  if (raw.parameters !== undefined && (typeof raw.parameters !== 'object' || raw.parameters === null || Array.isArray(raw.parameters))) {
    throw new Error('parameters must be a parameter-name -> schema object when supplied')
  }
  if (raw.output !== undefined && (typeof raw.output !== 'object' || raw.output === null || Array.isArray(raw.output))) {
    throw new Error('output must be a JSON Schema object when supplied')
  }
  const timeoutMs = raw.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : raw.timeoutMs
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be a positive safe integer')
}

/**
 * Scan tool roots for direct `*.tool.json` manifests.
 *
 * @param roots absolute directories to scan
 * @returns { definitions, errors }
 */
export function scanToolpackages(roots) {
  const definitions = []
  const errors = []
  for (const root of roots) {
    let entries
    try {
      if (!existsSync(root)) continue
      entries = readdirSync(root, { withFileTypes: true })
    } catch (error) {
      errors.push({ file: root, message: errorMessage(error) })
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.tool.json')) continue
      const file = join(root, entry.name)
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8'))
        validateManifest(raw, file)
        const parameters = raw.parameters ?? {}
        const output = raw.output ?? DEFAULT_OUTPUT_SCHEMA
        definitions.push({
          name: raw.name,
          description: raw.description,
          parameters,
          output,
          command: raw.command,
          timeoutMs: raw.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          manifestDir: dirname(file),
          manifestPath: file,
        })
      } catch (error) {
        errors.push({ file, message: errorMessage(error) })
      }
    }
  }
  return { definitions, errors }
}

/** Render any JSON-lossless tool value as readable text. */
function renderToolResult(value) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function killProcessTree(child) {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      process.kill(child.pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
}

/**
 * Run one toolpackage command with JSON-on-stdin / JSON-on-stdout protocol.
 *
 * @param definition normalized manifest definition from scanToolpackages()
 * @param args model-supplied tool arguments
 * @param signal optional AbortSignal from the DSH tool runtime
 * @returns parsed stdout JSON, or plain text when output schema is string
 */
export async function runToolpackage(definition, args, signal) {
  const child = spawn(definition.command[0], definition.command.slice(1), {
    cwd: definition.manifestDir,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  let stdout = ''
  let stderr = ''
  let outputBytes = 0
  let timedOut = false
  let timeoutHandle

  const onAbort = () => killProcessTree(child)
  if (signal?.aborted) onAbort()
  else signal?.addEventListener('abort', onAbort, { once: true })

  try {
    timeoutHandle = setTimeout(() => {
      timedOut = true
      killProcessTree(child)
    }, definition.timeoutMs)

    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length
      if (outputBytes <= MAX_OUTPUT_BYTES) stdout += chunk
      else killProcessTree(child)
    })
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk
    })
    child.stdin.end(JSON.stringify(args ?? {}))

    const exitCode = await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code) => resolve(code))
    })

    if (signal?.aborted) throw new Error(`tool "${definition.name}" was aborted`)
    if (timedOut) throw new Error(`tool "${definition.name}" timed out after ${definition.timeoutMs}ms`)
    if (exitCode !== 0) throw new Error(stderr.trim() || `tool "${definition.name}" exited with code ${exitCode}`)
    if (outputBytes > MAX_OUTPUT_BYTES) throw new Error(`tool "${definition.name}" output exceeded ${MAX_OUTPUT_BYTES} bytes`)

    const text = stdout.trim()
    try {
      return JSON.parse(text)
    } catch {
      if (definition.output?.type === 'string') return text
      throw new Error(`tool "${definition.name}" did not return valid JSON from stdout${stderr.trim() ? `: ${stderr.trim()}` : ''}`)
    }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Register normalized definitions into ToolRuntime.
 *
 * @returns { disposers, errors } — each disposer unregisters one tool.
 */
export function registerToolpackages(ctx, definitions) {
  const disposers = []
  const errors = []
  for (const definition of definitions) {
    try {
      disposers.push(ctx.tools.register(defineTool({
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
        output: {
          schema: definition.output,
          render: (_args, value) => [{ type: 'text', text: renderToolResult(value) }],
        },
        async execute(args, exec) {
          return runToolpackage(definition, args, exec.signal)
        },
      })))
    } catch (error) {
      errors.push({ name: definition.name, file: definition.manifestPath, message: errorMessage(error) })
    }
  }
  return { disposers, errors }
}
