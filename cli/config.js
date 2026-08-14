/**
 * dsh-mini persistent configuration.
 *
 * Precedence: CLI flags > environment variables > project config >
 * user config > built-in defaults. Both config files are JSON objects.
 * The user file is created with mode 0600 because it may contain paths and
 * preferences that reveal a workspace layout; credentials stay in env files.
 *
 * The contract is a deliberately small port of pi's settings manager:
 * two JSON files deep-merged in a fixed precedence order, with the host
 * (cli.js) re-applying CLI overrides on reload. DSH official's
 * `dsh-settings-file` YAML + chokidar watcher is intentionally NOT ported —
 * hot-reload is not worth a fs-watch dependency in a zero-runtime-dep bundle,
 * and `/config` restarts or re-reads settings when a value actually changes.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const USER_CONFIG_PATH = join(homedir(), '.dsh-mini', 'settings.json')
export const PROJECT_CONFIG_PATH = join(process.cwd(), '.dsh-mini', 'settings.json')

export const CONFIG_DEFAULTS = Object.freeze({
  defaultMode: 'minimal',
  defaultProvider: undefined,
  defaultModel: undefined,
  sessionsDir: join(homedir(), '.dsh-mini', 'sessions'),
  compactionRatio: 0.8,
  titles: false,
  workspaceInstructions: true,
  showBanner: true,
  renderer: 'auto',
})

export const RENDERER_VALUES = Object.freeze(['auto', 'cc', 'basic', 'plain'])

const BOOLEAN_FIELDS = new Set(['titles', 'workspaceInstructions', 'showBanner'])
const NUMBER_FIELDS = new Set(['compactionRatio'])
const STRING_FIELDS = new Set(['defaultMode', 'defaultProvider', 'defaultModel', 'sessionsDir', 'renderer'])

function normalize(raw, source) {
  if (raw === undefined) return {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`dsh-mini config ${source} must be a JSON object`)
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in CONFIG_DEFAULTS)) throw new Error(`dsh-mini config ${source}: unknown field "${key}"`)
    if (BOOLEAN_FIELDS.has(key)) {
      if (typeof value !== 'boolean') throw new Error(`dsh-mini config ${source}: ${key} must be a boolean`)
      out[key] = value
    } else if (NUMBER_FIELDS.has(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`dsh-mini config ${source}: ${key} must be a finite number`)
      out[key] = value
    } else if (STRING_FIELDS.has(key)) {
      if (typeof value !== 'string' || value.length === 0) throw new Error(`dsh-mini config ${source}: ${key} must be a non-empty string`)
      out[key] = value
    }
  }
  if (out.renderer !== undefined && !RENDERER_VALUES.includes(out.renderer)) {
    throw new Error(`dsh-mini config ${source}: renderer must be one of ${RENDERER_VALUES.join(', ')}`)
  }
  if (out.compactionRatio !== undefined && (out.compactionRatio <= 0 || out.compactionRatio > 1)) {
    throw new Error(`dsh-mini config ${source}: compactionRatio must be > 0 and <= 1`)
  }
  return out
}

function readJson(path) {
  if (!existsSync(path)) return undefined
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`dsh-mini config ${path}: invalid JSON (${error.message})`)
  }
}

export function loadConfig(options = {}) {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const userPath = options.userPath ?? USER_CONFIG_PATH
  const projectPath = options.projectPath ?? join(cwd, '.dsh-mini', 'settings.json')
  const user = normalize(readJson(userPath), userPath)
  const project = normalize(readJson(projectPath), projectPath)
  const merged = { ...CONFIG_DEFAULTS, ...user, ...project }

  const config = {
    path: projectPath,
    userPath,
    defaultMode: env.DSH_MODE ?? merged.defaultMode,
    defaultProvider: env.DSH_PROVIDER ?? merged.defaultProvider,
    defaultModel: env.DSH_MODEL ?? merged.defaultModel,
    sessionsDir: env.DSH_SESSIONS ?? expandPath(merged.sessionsDir),
    compactionRatio: env.DSH_COMPACT_RATIO === undefined ? merged.compactionRatio : Number(env.DSH_COMPACT_RATIO),
    titles: env.DSH_TITLES === undefined ? merged.titles : env.DSH_TITLES !== '0',
    workspaceInstructions: env.DSH_NO_AGENTS === undefined ? merged.workspaceInstructions : env.DSH_NO_AGENTS !== '1',
    showBanner: env.DSH_NO_BANNER === undefined ? merged.showBanner : env.DSH_NO_BANNER !== '1',
    renderer: env.DSH_RENDERER ?? merged.renderer,
    raw: { user, project },
  }
  if (!Number.isFinite(config.compactionRatio) || config.compactionRatio <= 0 || config.compactionRatio > 1) {
    config.compactionRatio = CONFIG_DEFAULTS.compactionRatio
  }
  if (!RENDERER_VALUES.includes(config.renderer)) config.renderer = CONFIG_DEFAULTS.renderer
  return config
}

export function expandPath(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

/** Persist a partial user config, preserving fields already in the file. */
export function saveUserConfig(patch, options = {}) {
  const path = options.path ?? USER_CONFIG_PATH
  const existing = normalize(readJson(path), path)
  // normalize() also validates the patch before anything touches disk.
  const next = normalize({ ...existing, ...patch }, path)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  // Same-directory temp + rename keeps an existing settings file intact if
  // the write or chmod fails halfway through.
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, path)
  return { path, config: next }
}

/** Validate and return one config key patch, or throw. */
export function coerceConfigPatch(key, value) {
  if (!(key in CONFIG_DEFAULTS)) throw new Error(`unknown config field "${key}"`)
  if (BOOLEAN_FIELDS.has(key)) {
    if (value === 'true' || value === true) return { [key]: true }
    if (value === 'false' || value === false) return { [key]: false }
    throw new Error(`${key} must be true or false`)
  }
  if (NUMBER_FIELDS.has(key)) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) throw new Error(`${key} must be a finite number`)
    return { [key]: parsed }
  }
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} must be a non-empty string`)
  return { [key]: value }
}
