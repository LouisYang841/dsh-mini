import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MINIMAL_PERSONA,
  MODES,
  appendMode,
  apply,
  foldMode,
  isValidMode,
} from '../cli/mode-bootstrap.js'

function register(config) {
  let listener
  const ctx = {
    on(event, callback) {
      assert.equal(event, 'system-prompt/assemble')
      listener = callback
    },
  }
  apply(ctx, config)
  assert.equal(typeof listener, 'function')
  return listener
}

async function assemble(listener, events, tools) {
  return listener(
    undefined,
    { agent: { session: { events } } },
    async () => ({
      sections: [
        { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
        { name: 'deployment:persona', text: 'You are dsh-mini, a coding agent.' },
      ],
      contexts: [{ name: 'clock', text: '2026-08-14' }],
      tools,
    }),
  )
}

test('exports the minimal persona and supported modes', () => {
  assert.equal(MINIMAL_PERSONA, 'You are a helpful software engineer assistant.')
  assert.deepEqual(MODES, ['minimal', 'standard'])
  assert.equal(isValidMode('minimal'), true)
  assert.equal(isValidMode('anchored'), false)
})

test('foldMode reads the last durable mode and falls back for legacy sessions', () => {
  const events = [
    { type: 'agent-preset/selected', data: { agentPreset: 'standard' } },
    { type: 'agent-preset/selected', data: { agentPreset: 'minimal' } },
    { type: 'agent-preset/selected', data: { agentPreset: 'bogus' } },
  ]
  assert.equal(foldMode(events), 'minimal')
  assert.equal(foldMode([]), 'standard')
  assert.equal(foldMode([], 'minimal'), 'minimal')
})

test('appendMode records a durable event and rejects unknown modes', () => {
  const events = []
  const agent = { session: { append(type, data) { events.push({ type, data }) } } }
  appendMode(agent, 'minimal')
  assert.deepEqual(events, [{ type: 'agent-preset/selected', data: { agentPreset: 'minimal' } }])
  assert.throws(() => appendMode(agent, 'anchored'), /unknown mode/)
})

test('minimal mode replaces the prompt and exposes only bash and read', async () => {
  const listener = register({ fallbackMode: 'minimal' })
  const tools = [
    { name: 'bash' },
    { name: 'read' },
    { name: 'edit' },
    { name: 'todo_write' },
  ]
  const result = await assemble(listener, [{ type: 'agent-preset/selected', data: { agentPreset: 'minimal' } }], tools)
  assert.equal(result.sections.length, 1)
  assert.equal(result.sections[0].text, MINIMAL_PERSONA)
  assert.deepEqual(result.contexts, [])
  assert.deepEqual(result.tools.map((tool) => tool.name), ['bash', 'read'])
})

test('standard mode and legacy sessions keep the full assembly', async () => {
  const listener = register({ fallbackMode: 'standard' })
  const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }]
  const standard = await assemble(listener, [{ type: 'agent-preset/selected', data: { agentPreset: 'standard' } }], tools)
  const legacy = await assemble(listener, [], tools)
  assert.equal(standard.sections.length, 2)
  assert.equal(standard.contexts.length, 1)
  assert.deepEqual(standard.tools, tools)
  assert.deepEqual(legacy.tools, tools)
})

test('a misconfigured minimal bootstrap fails loudly', async () => {
  const listener = register({ fallbackMode: 'minimal' })
  await assert.rejects(
    assemble(listener, [{ type: 'agent-preset/selected', data: { agentPreset: 'minimal' } }], [{ name: 'bash' }, { name: 'edit' }]),
    /expected exactly one bootstrap shell and every common tool/,
  )
})
