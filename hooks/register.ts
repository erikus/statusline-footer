import type { Engine, Register, SessionUsage } from 'claude-code'
import { parseAnsi } from './ansi'

/** The `script` option when the manifest default is somehow unset. */
const DEFAULT_SCRIPT_RELATIVE_PATH = '.claude/statusline.sh'
/** How long one run of the script may take before it is killed. */
const SCRIPT_TIMEOUT_MS = 5000
/** How often the line is refreshed with nothing else going on (git state drifts). */
const REFRESH_INTERVAL_MS = 30000
/** Columns the engine's own mode indicator ("⏵⏵ auto mode on · ") takes before our text. */
const INDICATOR_COLUMNS = 20
/** Terminal width assumed until the surface reports one. */
const DEFAULT_COLUMNS = 80
/** The threshold the status line JSON's `exceeds_200k_tokens` flag counts against. */
const EXCEEDS_TOKENS = 200_000

/** Model ids are `claude-<family>-<major>-<minor>[-...]`; the display name is `<Family> <major>.<minor>`. */
const MODEL_ID_PATTERN = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/

/** The display name a status line shows for a model, from the id `$.session.model()` returns. */
export function modelDisplayName(model: string): string {
  const match = MODEL_ID_PATTERN.exec(model)
  if (match === null) return model
  const [, family = '', major = '', minor] = match
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  return minor === undefined ? `${name} ${major}` : `${name} ${major}.${minor}`
}

/** The stdin JSON a `statusLine` command receives, for the fields the mod can supply. */
type StatusLineInput = {
  cwd: string
  session_id: string
  version: string
  model: { display_name: string }
  workspace: { current_dir: string; project_dir: string }
  cost: { total_cost_usd: number; total_duration_ms: number }
  context_window: {
    total_input_tokens: number | null
    used_percentage: number | null
    context_window_size: number
  }
  rate_limits: Record<string, { used_percentage: number; resets_at?: string }>
  exceeds_200k_tokens: boolean
}

async function buildInput($: Engine, usage: SessionUsage): Promise<StatusLineInput> {
  const [cwd, root, model, sessionId, version, now] = await Promise.all([
    $.session.cwd(),
    $.session.root(),
    $.session.model(),
    $.session.id(),
    $.session.version(),
    $.clock.now(),
  ])
  const rateLimits: StatusLineInput['rate_limits'] = {}
  for (const limit of usage.rateLimits) {
    rateLimits[limit.kind] = { used_percentage: limit.percentUsed, resets_at: limit.resetsAt }
  }
  const tokens = usage.context.tokens ?? null
  return {
    cwd,
    session_id: sessionId,
    version: version.version,
    model: { display_name: modelDisplayName(model) },
    workspace: { current_dir: cwd, project_dir: root },
    cost: {
      total_cost_usd: usage.cost?.usd ?? 0,
      total_duration_ms: Math.max(0, now - usage.startedAt),
    },
    context_window: {
      total_input_tokens: tokens,
      used_percentage: usage.context.percent ?? null,
      context_window_size: usage.context.window,
    },
    rate_limits: rateLimits,
    exceeds_200k_tokens: tokens !== null && tokens > EXCEEDS_TOKENS,
  }
}

async function runScript($: Engine, scriptRelativePath: string, columns: number): Promise<string> {
  const home = (await $.env.get('HOME')) ?? ''
  const usage = await $.session.usage()
  const input = await buildInput($, usage)
  const result = await $.process.run(['bash', `${home}/${scriptRelativePath}`], {
    stdin: JSON.stringify(input),
    env: { COLUMNS: String(Math.max(1, columns - INDICATOR_COLUMNS)) },
    timeoutMs: SCRIPT_TIMEOUT_MS,
  })
  if (result.exitCode !== 0) {
    return `statusline.sh exited ${result.exitCode}`
  }
  // A status line is one row: keep the first line, as the engine's own status line does.
  return result.stdout.split('\n')[0] ?? ''
}

/** The mod's own state: the line last drawn and what it was drawn for. */
type State = {
  scriptRelativePath: string
  line: string
  columns: number
  isRefreshing: boolean
  isRefreshWanted: boolean
}

/** Re-runs the script and redraws the hint row when its output changed; one run at a time. */
async function refresh($: Engine, state: State): Promise<void> {
  if (state.isRefreshing) {
    state.isRefreshWanted = true
    return
  }
  state.isRefreshing = true
  try {
    do {
      state.isRefreshWanted = false
      let next: string
      try {
        next = await runScript($, state.scriptRelativePath, state.columns)
      } catch (error) {
        next = `statusline.sh failed: ${error instanceof Error ? error.message : String(error)}`
      }
      if (next !== state.line) {
        state.line = next
        $.ui.invalidate('ui.render')
      }
    } while (state.isRefreshWanted)
  } finally {
    state.isRefreshing = false
  }
}

export const register: Register = (on, options) => {
  const script = options.script
  const state: State = {
    scriptRelativePath: typeof script === 'string' && script !== '' ? script : DEFAULT_SCRIPT_RELATIVE_PATH,
    line: '',
    columns: DEFAULT_COLUMNS,
    isRefreshing: false,
    isRefreshWanted: false,
  }

  on('session.start', ($, e, next) => {
    $.clock.every(REFRESH_INTERVAL_MS, () => void refresh($, state))
    void refresh($, state)
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    void refresh($, state)
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    void refresh($, state)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    void refresh($, state)
    return result
  })

  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    const reported = e.viewport?.columns
    if (reported !== undefined && reported !== state.columns) {
      state.columns = reported
      void refresh($, state)
    }
    if (state.line === '') {
      return next(e)
    }
    const { Text } = $.ui.resolve(e)
    const runs = parseAnsi(state.line).map((run) =>
      h(Text, { color: run.color, backgroundColor: run.backgroundColor, dimColor: run.dim, bold: run.bold }, run.text),
    )
    return h(Text, { wrap: 'truncate' }, ...runs)
  })
}
