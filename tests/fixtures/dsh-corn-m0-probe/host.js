import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { join, sep } from 'node:path'

export const name = 'dsh-corn-m0-probe'
export const inject = ['connection', 'agents', 'tools']
const PREFIX = 'corn-m0-governance-'
const CASES = new Set(['gate-deny', 'remote-reject', 'remote-cancel'])
const COMMAND = "printf 'corn-m0-probe\\n'"

/** Test-only, bounded execution seam. Never register this in a product profile. */
export function apply(ctx, config = {}) {
  if (config.enabled !== true) return
  const home = realpathSync(process.env.DSH_HOME)
  const marker = JSON.parse(
    readFileSync(join(home, '.corn-bot-home.json'), 'utf8'),
  )
  if (
    home !== realpathSync(config.testHome) ||
    marker.owner !== 'corn-bot' ||
    marker.purpose !== 'm0-governance-probe'
  )
    throw new Error('M0 probe requires its disposable Corn-owned test home')
  const states = new Map()
  const usedCases = new Set()

  function binding(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId.startsWith(PREFIX)) {
      throw new Error('Only dedicated M0 test Sessions may be armed')
    }
    const registry = JSON.parse(
      readFileSync(join(home, 'workspace-agents', 'registry.json'), 'utf8'),
    )
    const bound = registry.sessionBindings?.[sessionId]
    const row = bound && registry.agents?.[bound.agentId]
    const agent = ctx.agents.get(sessionId)
    const header = agent?.session.header
    if (
      !row ||
      !agent ||
      row.status === 'archived' ||
      !row.agentId.startsWith('wa_') ||
      !row.dshPreset.startsWith('wa-') ||
      bound.workspaceId !== row.workspaceId ||
      header.agentPreset !== row.dshPreset ||
      header.cwd !== row.canonicalRoot ||
      !realpathSync(row.canonicalRoot).startsWith(join(home, 'DSclaw') + sep)
    ) {
      throw new Error(
        'A real matching Claw registry binding and live Session are required',
      )
    }
    return { agent, row }
  }

  function route(action, handle) {
    const dispose = ctx.connection.fetch.register({
      path: `/api/corn-m0-probe/${action}`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const text = await request.text()
          if (text.length > 2048) throw new Error('Probe request too large')
          const value = await handle(JSON.parse(text || '{}'))
          return Response.json(
            { ok: true, ...value },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch {
          return Response.json(
            { ok: false, error: 'Probe request rejected' },
            { status: 400 },
          )
        }
      },
    })
    ctx.effect(() => () => {
      void Promise.resolve(dispose).then((stop) => stop())
    })
  }

  route('arm', ({ sessionId, case: testCase }) => {
    const { row } = binding(sessionId)
    if (
      !CASES.has(testCase) ||
      usedCases.has(testCase) ||
      states.has(sessionId)
    ) {
      throw new Error('Each test case may be armed once')
    }
    const preset = testCase === 'gate-deny' ? 'research' : 'developer'
    if (row.policy?.preset !== preset) throw new Error('Unexpected Claw policy')
    const callId = `corn-m0-${randomUUID()}`
    states.set(sessionId, {
      sessionId,
      case: testCase,
      callId,
      status: 'armed',
      bashExecutions: 0,
      traceId: `tr_${createHash('sha256').update(callId).digest('hex').slice(0, 12)}`,
      toolResults: [],
    })
    usedCases.add(testCase)
    return { callId }
  })
  route('result', ({ sessionId }) => {
    binding(sessionId)
    const state = states.get(sessionId)
    if (!state) throw new Error('Session was not armed')
    return { probe: state }
  })

  ctx.on('tools/execute', (exec, next) => {
    const state = states.get(exec.agent?.session.id)
    if (
      state &&
      (exec.rootCallId || exec.callId) === state.callId &&
      exec.name === 'bash'
    ) {
      state.bashExecutions += 1
    }
    return next()
  })
  ctx.on('tools/result', (exec, result) => {
    const state = states.get(exec.agent?.session.id)
    if (!state || (exec.rootCallId || exec.callId) !== state.callId) return
    state.toolResults.push({
      name: exec.name,
      callId: exec.callId,
      rootCallId: exec.rootCallId || exec.callId,
      isError: result.isError,
      error: result.isError ? result.error.message.slice(0, 300) : null,
    })
  })
  ctx.on(
    'agent/pre-step',
    async ({ agent, turn, signal }, next) => {
      const state = states.get(agent.session.id)
      if (!state) return next()
      // Once claimed, every later step of this dedicated Session remains blocked.
      if (state.status !== 'armed') return { kind: 'reject' }
      state.status = 'running'
      state.turn = turn
      try {
        binding(agent.session.id)
        const args = {
          command: COMMAND,
          description: 'Corn M0 bounded governance probe',
          timeoutMs: 1000,
          workdir: agent.session.header.cwd,
          run_in_background: false,
        }
        const runCode = ctx.tools.get('run_code', agent)
        state.transport = runCode ? 'run_code' : 'native-bash'
        if (runCode && ctx.get('ptcRuntime')?.language !== 'typescript') {
          throw new Error(
            'Only the official TypeScript PTC runtime is supported by this fixture',
          )
        }
        const result = await ctx.tools.execute({
          callId: state.callId,
          name: runCode ? 'run_code' : 'bash',
          arguments: runCode
            ? {
                code: `return await tools.bash(${JSON.stringify(args)})`,
                description: 'Corn M0 bounded governance probe',
              }
            : args,
          agent,
          signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        })
        state.isError = result.isError
        state.status = 'done'
      } catch {
        state.status = 'failed'
      }
      // Official loop commits turn/end; no synthetic boundaries or model traffic.
      return { kind: 'reject' }
    },
    { prepend: true },
  )
}
