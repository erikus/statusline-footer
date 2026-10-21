import { expect, mock, test } from 'claude-code/testing'
import { modelDisplayName } from './register'

test('modelDisplayName turns a model id into the status line display name', async () => {
  expect(modelDisplayName('claude-fable-5-1')).toBe('Fable 5.1')
  expect(modelDisplayName('claude-opus-5-5-20260101')).toBe('Opus 5.5')
  expect(modelDisplayName('claude-haiku-5')).toBe('Haiku 5')
  expect(modelDisplayName('Fable 5.1')).toBe('Fable 5.1')
})

const PLUGIN = 'statusline-footer'
const SCRIPT_OUTPUT = '\x1b[38;5;170m🧠 F5.1\x1b[0m 📁 claude-empty'
const SCRIPT_TEXT = '🧠 F5.1 📁 claude-empty'

for (const surface of ['terminal', 'desktop'] as const) {
  test(`draws the script's first line on the PromptHint row (${surface})`, async ($, on) => {
    const clock = mock.clock(on)
    mock.env(on, { HOME: '/home/tester' })
    const runs: { argv: readonly string[]; stdin?: string; columns?: string }[] = []

    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('session.cwd', () => ({ value: '/home/tester/project' }))
    on('session.root', () => ({ value: '/home/tester/project' }))
    on('session.model', () => ({ value: 'claude-fable-5-1' }))
    on('session.id', () => ({ value: 'session-1' }))
    on('session.version', () => ({ value: { version: '2.1.302', base: '2.1.302', builtAt: 0 } }))
    on('session.usage', () => ({
      value: {
        startedAt: clock.now() - 60_000,
        context: { tokens: 12_345, window: 200_000, percent: 6 },
        rateLimits: [{ kind: 'five_hour', percentUsed: 10 }, { kind: 'seven_day', percentUsed: 20 }],
        cost: { usd: 0.42 },
      },
    }))
    on('process.run', ($, e) => {
      runs.push({ argv: e.argv, stdin: e.init?.stdin, columns: e.init?.env?.COLUMNS })
      return {
        value: {
          exitCode: 0,
          stdout: `${SCRIPT_OUTPUT}\nsecond line ignored`,
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    })

    await $.session.start({ cwd: '/home/tester/project', surface, isInteractive: true })
    await clock.settle()

    expect(runs.length).toBeGreaterThan(0)
    expect(runs[0]?.argv).toEqual(['bash', '/home/tester/.claude/statusline.sh'])
    const input = JSON.parse(runs[0]?.stdin ?? '{}')
    expect(input.model.display_name).toBe('Fable 5.1')
    expect(input.context_window.total_input_tokens).toBe(12_345)
    expect(input.rate_limits.five_hour.used_percentage).toBe(10)
    expect(input.cost.total_cost_usd).toBe(0.42)

    const mounted = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '(shift+tab to cycle)' },
    })
    const text = await mounted.find({ type: 'Text' })
    expect(text?.text).toBe(SCRIPT_TEXT)
    const texts = await mounted.findAll({ type: 'Text' })
    const colored = texts.find((t) => t.props.color !== undefined)
    expect(colored?.text).toBe('🧠 F5.1')
    expect(colored?.props.color).toBe('#d75fd7')
  })
}

test('draws nothing of its own before the script has answered', async ($, on) => {
  mock.clock(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine hint')
  })
  const mounted = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '(shift+tab to cycle)' },
  })
  const text = await mounted.find({ type: 'Text' })
  expect(text?.text).toBe('engine hint')
})
