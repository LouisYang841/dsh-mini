/**
 * dsh-mini agent modes.
 *
 * `minimal` reproduces the DeepSeek Harness Minimal preset condition for the
 * first request: the complete one-line persona plus only the platform shell
 * and `read`. dsh-mini keeps `standard` as its previous full-catalog behavior.
 *
 * Mode is durable session state: new sessions record a known durable event,
 * resuming sessions fold the last such event, and legacy sessions without one
 * fall back to `standard` so their behavior does not change on upgrade.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-mini-mode-bootstrap'

/** The exact Minimal preset persona. Keep it byte-identical. */
export const MINIMAL_PERSONA = 'You are a helpful software engineer assistant.'

/**
 * Durable session event that records the active mode.
 *
 * dsh-mini reuses the harness-known `agent-preset/selected` envelope because
 * the session persistence layer refuses unknown event types on resume unless
 * the writer could mark them `ignorable`, and `Session.append()` has no such
 * option yet. dsh-mini does not mount the agent-presets service, so this
 * event is consumed only by the mode bootstrap below.
 */
export const MODE_EVENT = 'agent-preset/selected'

/** Modes supported by the dsh-mini CLI. */
export const MODES = Object.freeze(['minimal', 'standard'])

/** Sessions created before mode support existed keep their old behavior. */
export const LEGACY_FALLBACK_MODE = 'standard'

export function isValidMode(value) {
  return MODES.includes(value)
}

/**
 * Fold the active mode from durable session events (the last marker wins).
 * Invalid or absent events use `fallback`.
 */
export function foldMode(events, fallback = LEGACY_FALLBACK_MODE) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type === MODE_EVENT && isValidMode(event.data?.agentPreset)) return event.data.agentPreset
  }
  return fallback
}

/** Append the durable mode marker to a session. */
export function appendMode(agent, mode) {
  if (!isValidMode(mode)) throw new TypeError(`${name}: unknown mode ${JSON.stringify(mode)} (known: ${MODES.join(', ')})`)
  agent.session.append(MODE_EVENT, { agentPreset: mode })
}

function stringList(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${name}: ${field} must be a non-empty array of non-empty strings`)
  }
  return [...new Set(value)]
}

/**
 * Register the per-session mode filter on the `system-prompt/assemble`
 * waterfall. `minimal` replaces the assembled prompt with the exact Minimal
 * persona and exposes only the configured bootstrap tools; `standard` returns
 * the ordinary assembly untouched.
 */
export function apply(ctx, config = {}) {
  const shellTools = stringList(config.shellTools ?? ['bash'], 'shellTools')
  const commonTools = stringList(config.commonTools ?? ['read'], 'commonTools')
  const fallbackMode = config.fallbackMode ?? LEGACY_FALLBACK_MODE
  if (!isValidMode(fallbackMode)) throw new TypeError(`${name}: fallbackMode must be one of ${MODES.join(', ')}`)

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (agent === undefined || foldMode(agent.session.events, fallbackMode) !== 'minimal') return assembled

    const available = new Set(assembled.tools.map((tool) => tool.name))
    const selectedShells = shellTools.filter((toolName) => available.has(toolName))
    const missingCommon = commonTools.filter((toolName) => !available.has(toolName))
    if (selectedShells.length !== 1 || missingCommon.length > 0) {
      throw new Error(
        `${name}: expected exactly one bootstrap shell and every common tool; `
        + `shells=${JSON.stringify(selectedShells)}, missing=${JSON.stringify(missingCommon)}`,
      )
    }

    const bootstrap = new Set([...selectedShells, ...commonTools])
    return {
      ...assembled,
      sections: [{ name: 'dsh-mini:minimal-persona', text: MINIMAL_PERSONA, complete: true }],
      contexts: [],
      tools: assembled.tools.filter((tool) => bootstrap.has(tool.name)),
    }
  })
}
