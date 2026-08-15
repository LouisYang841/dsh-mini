import assert from 'node:assert/strict'
import test from 'node:test'

import { installModelSelection } from '@deepseek-ai/dsh-agent'

function harness() {
  const listeners = new Map()
  const disposers = []
  const agentCtx = {
    on(event, callback) {
      assert.equal(listeners.has(event), false)
      listeners.set(event, callback)
      const disposer = () => listeners.delete(event)
      disposers.push(disposer)
      return disposer
    },
  }
  return { listeners, disposers, agentCtx }
}

test('installModelSelection snapshots the pick during assembly and applies it to the request', async () => {
  const { listeners, agentCtx } = harness()
  const selected = {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'max',
  }
  const selection = { current: selected, assembled: undefined }
  installModelSelection(agentCtx, selection)

  assert.deepEqual([...listeners.keys()].sort(), ['agent/request', 'system-prompt/assemble'])

  const assembled = await listeners.get('system-prompt/assemble')(undefined, {}, async () => ({
    variables: { provider: 'stale', model: 'stale' },
  }))
  assert.deepEqual(assembled.variables, { provider: selected.provider, model: selected.model })
  assert.equal(selection.assembled, selected)

  const request = await listeners.get('agent/request')({}, async () => ({
    provider: 'old-provider',
    model: 'old-model',
    reasoningEffort: 'low',
    maxTokens: 100,
  }))
  assert.deepEqual(request, {
    provider: selected.provider,
    model: selected.model,
    reasoningEffort: 'max',
    maxTokens: 100,
  })
})

test('installModelSelection clears an inherited effort when the pick omits one', async () => {
  const { listeners, agentCtx } = harness()
  const selection = {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    assembled: undefined,
  }
  installModelSelection(agentCtx, selection)
  await listeners.get('system-prompt/assemble')(undefined, {}, async () => ({ variables: {} }))
  const request = await listeners.get('agent/request')({}, async () => ({
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'max',
  }))
  assert.equal('reasoningEffort' in request, false)
  assert.equal(request.provider, 'deepseek-official')
  assert.equal(request.model, 'deepseek-v4-flash')
})
