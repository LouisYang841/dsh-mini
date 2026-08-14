import assert from 'node:assert/strict'
import test from 'node:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CONFIG_DEFAULTS,
  coerceConfigPatch,
  expandPath,
  loadConfig,
  saveUserConfig,
} from '../cli/config.js'

test('config defaults are the minimal-mode contract', () => {
  assert.equal(CONFIG_DEFAULTS.defaultMode, 'minimal')
  assert.equal(CONFIG_DEFAULTS.defaultProvider, undefined)
  assert.equal(CONFIG_DEFAULTS.compactionRatio, 0.8)
  assert.equal(CONFIG_DEFAULTS.renderer, 'auto')
})

test('loadConfig merges user then project then env with strict validation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mini-config-'))
  const userPath = join(dir, 'user.json')
  const projectPath = join(dir, 'project.json')
  writeFileSync(userPath, JSON.stringify({ defaultMode: 'standard', titles: true, sessionsDir: '~/sessions' }))
  writeFileSync(projectPath, JSON.stringify({ defaultMode: 'minimal', titles: false, compactionRatio: 0.5 }))
  const config = loadConfig({
    env: { DSH_COMPACT_RATIO: '0.25', DSH_TITLES: '0', DSH_SESSIONS: join(dir, 'env-sessions') },
    userPath,
    projectPath,
  })
  assert.equal(config.defaultMode, 'minimal')
  assert.equal(config.compactionRatio, 0.25)
  assert.equal(config.titles, false)
  assert.equal(config.sessionsDir, join(dir, 'env-sessions'))
  assert.deepEqual(config.raw, {
    user: { defaultMode: 'standard', titles: true, sessionsDir: '~/sessions' },
    project: { defaultMode: 'minimal', titles: false, compactionRatio: 0.5 },
  })
  rmSync(dir, { recursive: true, force: true })
})

test('loadConfig reports invalid and unknown config fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mini-config-'))
  const badJson = join(dir, 'bad.json')
  writeFileSync(badJson, '{not json')
  assert.throws(() => loadConfig({ env: {}, userPath: badJson, projectPath: join(dir, 'none.json') }), /invalid JSON/)
  const badShape = join(dir, 'shape.json')
  writeFileSync(badShape, JSON.stringify([1]))
  assert.throws(() => loadConfig({ env: {}, userPath: badShape, projectPath: join(dir, 'none.json') }), /must be a JSON object/)
  const badField = join(dir, 'field.json')
  writeFileSync(badField, JSON.stringify({ wat: true }))
  assert.throws(() => loadConfig({ env: {}, userPath: badField, projectPath: join(dir, 'none.json') }), /unknown field "wat"/)
  const badRenderer = join(dir, 'renderer.json')
  writeFileSync(badRenderer, JSON.stringify({ renderer: 'xterm' }))
  assert.throws(() => loadConfig({ env: {}, userPath: badRenderer, projectPath: join(dir, 'none.json') }), /renderer must be one of/)
  rmSync(dir, { recursive: true, force: true })
})

test('saveUserConfig persists a patch with mode 0600 and preserves existing fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mini-config-'))
  const path = join(dir, 'settings.json')
  saveUserConfig({ titles: true }, { path })
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).titles, true)
  assert.equal(statSync(path).mode & 0o777, 0o600)
  saveUserConfig({ defaultMode: 'standard' }, { path })
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(saved.defaultMode, 'standard')
  assert.equal(saved.titles, true)
  rmSync(dir, { recursive: true, force: true })
})

test('coerceConfigPatch validates booleans, numbers, and known fields', () => {
  assert.deepEqual(coerceConfigPatch('titles', 'true'), { titles: true })
  assert.deepEqual(coerceConfigPatch('compactionRatio', '0.5'), { compactionRatio: 0.5 })
  assert.deepEqual(coerceConfigPatch('renderer', 'basic'), { renderer: 'basic' })
  assert.throws(() => coerceConfigPatch('nope', 'x'), /unknown config field/)
  assert.throws(() => coerceConfigPatch('titles', 'yes'), /true or false/)
  assert.throws(() => coerceConfigPatch('compactionRatio', 'many'), /finite number/)
})

test('expandPath expands the leading tilde only', () => {
  assert.equal(expandPath('~'), expandPath('~/'))
  assert.equal(expandPath('/tmp/absolute'), '/tmp/absolute')
  assert.equal(expandPath('relative'), 'relative')
})
