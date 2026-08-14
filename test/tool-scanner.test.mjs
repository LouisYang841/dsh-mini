import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { registerToolpackages, runToolpackage, scanToolpackages } from '../cli/tool-scanner.js'

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'dsh-mini-tools-'))
}

test('scanToolpackages loads valid manifests and reports invalid ones', () => {
  const root = tempRoot()
  try {
    writeFileSync(join(root, 'echo.tool.json'), JSON.stringify({
      name: 'demo_echo',
      description: 'Echo the supplied arguments.',
      command: ['node', './echo.mjs'],
      parameters: { text: { type: 'string', required: true } },
    }))
    writeFileSync(join(root, 'bad.tool.json'), JSON.stringify({ name: 'bad', description: 'missing command' }))
    const { definitions, errors } = scanToolpackages([root])
    assert.equal(definitions.length, 1)
    assert.equal(definitions[0].name, 'demo_echo')
    assert.deepEqual(definitions[0].command, ['node', './echo.mjs'])
    assert.equal(definitions[0].manifestDir, root)
    assert.equal(errors.length, 1)
    assert.match(errors[0].message, /command must be/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('registerToolpackages registers definitions and returns disposers', () => {
  const root = tempRoot()
  try {
    const manifest = join(root, 'demo.tool.json')
    writeFileSync(manifest, JSON.stringify({
      name: 'demo',
      description: 'Demo tool.',
      command: ['node', './demo.mjs'],
    }))
    const { definitions } = scanToolpackages([root])
    const registered = []
    const ctx = {
      tools: {
        register(definition) {
          registered.push(definition)
          return () => { registered.length = 0 }
        },
      },
    }
    const { disposers, errors } = registerToolpackages(ctx, definitions)
    assert.equal(errors.length, 0)
    assert.equal(registered.length, 1)
    assert.equal(registered[0].name, 'demo')
    assert.equal(typeof disposers[0], 'function')
    disposers[0]()
    assert.equal(registered.length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('runToolpackage executes a child process with JSON stdin/stdout', async () => {
  const root = tempRoot()
  try {
    const script = join(root, 'echo.mjs')
    writeFileSync(script, `let input = ""; process.stdin.on("data", (chunk) => { input += chunk }); process.stdin.on("end", () => { process.stdout.write(JSON.stringify({ ok: true, args: JSON.parse(input) })) });`)
    const definition = {
      name: 'demo_echo',
      description: 'Echo.',
      parameters: {},
      output: { type: 'object' },
      command: ['node', script],
      timeoutMs: 5000,
      manifestDir: root,
      manifestPath: join(root, 'demo.tool.json'),
    }
    const value = await runToolpackage(definition, { text: 'hi' })
    assert.deepEqual(value, { ok: true, args: { text: 'hi' } })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('runToolpackage returns plain stdout for string output schemas', async () => {
  const root = tempRoot()
  try {
    const script = join(root, 'plain.mjs')
    writeFileSync(script, `process.stdout.write("hello from tool")`)
    const definition = {
      name: 'demo_plain',
      description: 'Plain.',
      parameters: {},
      output: { type: 'string' },
      command: ['node', script],
      timeoutMs: 5000,
      manifestDir: root,
      manifestPath: join(root, 'demo.tool.json'),
    }
    assert.equal(await runToolpackage(definition, {}), 'hello from tool')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('runToolpackage rejects non-zero exits with stderr', async () => {
  const root = tempRoot()
  try {
    const script = join(root, 'fail.mjs')
    writeFileSync(script, `process.stderr.write("boom"); process.exit(2)`)
    const definition = {
      name: 'demo_fail',
      description: 'Fails.',
      parameters: {},
      output: { type: 'string' },
      command: ['node', script],
      timeoutMs: 5000,
      manifestDir: root,
      manifestPath: join(root, 'demo.tool.json'),
    }
    await assert.rejects(runToolpackage(definition, {}), /boom/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
