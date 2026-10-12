import { setTimeout as delay } from 'node:timers/promises'
import { JobClient } from '../../packages/dsh-adapter/src/job-client.ts'
import { record } from '../../packages/dsh-adapter/src/remote-error.ts'
import {
  eventSummary,
  gitWorkspace,
  openApprovals,
  processTable,
  until,
} from './lib/gate-env.mjs'
import { runGate } from './lib/gate-session.mjs'

// Run: node scripts/gates/run.mjs scripts/gates/b6-idle-pre-step-fence.mjs -- \
//   --variant <idle-job|idle-subagent|idle-tree|cancel-first|leaf-first> \
//   --arm <control|gate|gate-append> [--pressure]
// B6-idle (U2 draft §6), Option C arm: a PROBE-ONLY Host plugin
// (scripts/gates/support/corn-stop-fence-probe) registers an `agent/pre-step`
// listener that rejects steps of a fenced Session and its subagent lineage.
// - control: plugin loaded, never fenced (reproduces the wake-up gap).
// - gate: listener prepended, parent fenced at T0, before any stop call.
// - gate-append: same, but registered in load order (compaction ordering).
// Variants: the parent is idle at T0 ("will report back") and is woken by a
// job settlement (idle-job), a subagent settlement (idle-subagent) or both,
// stopped leaf-first (idle-tree); or the parent is still running and is
// cancelled first (cancel-first) or last (leaf-first). `--pressure` makes the
// parent's last reply large under a context window that puts its next step
// over compaction-basic's threshold. After +10 s the fence is lifted and one
// user prompt goes to the parent. The Host runs outside the gate sandbox (DSH
// bash Seatbelt cannot nest); the model is the loopback fake.
const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag)
  return index < 0 ? fallback : process.argv[index + 1]
}
const VARIANT = arg('--variant', 'idle-tree')
const ARM = arg('--arm', 'control')
const PRESSURE = process.argv.includes('--pressure')
const VARIANTS = new Set([
  'idle-job',
  'idle-subagent',
  'idle-tree',
  'cancel-first',
  'leaf-first',
])
if (!VARIANTS.has(VARIANT) || !['control', 'gate', 'gate-append'].includes(ARM))
  throw new Error(`unknown variant/arm ${VARIANT}/${ARM}`)
const PARENT_IDLE = VARIANT.startsWith('idle-')
const WITH_JOB = VARIANT !== 'idle-subagent'
const WITH_CHILD = VARIANT !== 'idle-job'
const CHILD_JOBS = WITH_CHILD && VARIANT !== 'idle-subagent'
const FENCED = ARM !== 'control'

const MARK = { parent: '54.11', childEarly: '54.21', childLate: '54.31' }
const bashJob = (mark, description) => ({
  name: 'bash',
  arguments: {
    command: `sleep ${mark}1 & sleep ${mark}2 & wait`,
    description,
    run_in_background: true,
  },
})
const childScript = CHILD_JOBS ? 'bi-child' : 'bi-child-solo'
const spawnChild = {
  toolCall: {
    name: 'subagent',
    arguments: {
      description: 'gate child task',
      prompt: `⟦gate:${childScript}⟧ child task for the gate probe`,
      run_in_background: true,
    },
  },
}
// ~200 KB of prose: over the threshold below once it is on the surface, and
// larger than compaction-basic's retained tail, so a summary range exists.
const BIG = Array.from({ length: 100 }, (_, index) =>
  `Progress note ${index}: the background work continues and the parent will report back once it settles. `.repeat(
    20,
  ),
)
const lastReply = PRESSURE
  ? { chunks: BIG }
  : { chunks: ['will ', 'report back'], chunkDelayMs: 20 }
const parentSteps = [
  ...(WITH_JOB ? [{ toolCall: bashJob(MARK.parent, 'gate parent job') }] : []),
  ...(WITH_CHILD ? [spawnChild] : []),
  ...(PARENT_IDLE
    ? [lastReply]
    : [
        { chunks: ['bg ', 'working '], chunkDelayMs: 50, hang: true },
        lastReply,
      ]),
]
const scripts = {
  'bi-parent': parentSteps,
  'bi-child': [
    { toolCall: bashJob(MARK.childEarly, 'gate child early job') },
    {
      chunks: ['child '],
      awaitRelease: 'late',
      toolCall: bashJob(MARK.childLate, 'gate child late job'),
    },
    { chunks: ['child after late job'], hang: true },
  ],
  'bi-child-solo': [{ chunks: ['child '], hang: true }],
  'bi-fg': [{ chunks: Array(40).fill('fg '), chunkDelayMs: 200 }],
}
// compaction-basic defaults (headroom 65 536, threshold 0.8, retain 0.16) with
// maxTokens 4 096: a 100 000-token window gives a 30 368-token threshold.
const PRESSURE_WINDOW = 100_000
const PROBE_PLUGIN = new URL(
  './support/corn-stop-fence-probe/host.js',
  import.meta.url,
).href

const ALL_MARKS = Object.values(MARK)
const markOf = (command) =>
  ALL_MARKS.find((mark) =>
    new RegExp(`sleep ${mark.replace('.', '\\.')}[12]`).test(command),
  )
const markProcesses = async () =>
  (await processTable())
    .map((row) => ({ ...row, mark: markOf(row.command) }))
    .filter((row) => row.mark)
const messageOf = (event) => event.data?.message ?? event.data ?? {}
const splicedOf = (event) => ({
  target: event.data?.target ?? null,
  removed: event.data?.removedCount ?? 0,
  outcome: event.data?.outcome ?? null,
  inserted: (event.data?.inserted ?? []).map((item) => ({
    source: item.source?.kind ?? null,
    summary: String(item.source?.summary ?? '').slice(0, 120),
  })),
})

/** `agent/pre-step` listeners, outermost first, as `<index>:<plugin>[:prepend]`. */
const compactOrder = (hooks) =>
  hooks.map(
    (hook, index) =>
      `${index}:${hook.probe ? 'PROBE' : String(hook.plugin).replace('@deepseek-ai/dsh-', '')}${hook.prepend ? ':prepend' : ''}`,
  )

async function followChild(mux, parentSessionId, childSessionId) {
  const state = { cursor: -1, events: [], failure: undefined }
  mux.open(
    'session/follow',
    {
      request: {
        address: {
          kind: 'subagent',
          parentSessionId,
          childSessionId,
          mode: 'continuable',
        },
        maxMessages: 50,
      },
    },
    (raw) => {
      const item = record(raw)
      if (item.type === 'snapshot') state.cursor = item.cursor
      else if (item.type === 'event') {
        const event = record(item.event)
        state.cursor = event.seq
        state.events.push(event)
      }
    },
    (error) => {
      state.failure = error
    },
  )
  await until(
    () => state.cursor >= 0 || state.failure,
    'child follow',
    5_000,
    10,
  )
  if (state.failure) throw state.failure
  return { state }
}

const name = `b6-idle-fence-${VARIANT}-${ARM}${PRESSURE ? '-pressure' : ''}`
const report = await runGate(
  name,
  {
    scripts,
    title: `B6-idle Option C probe (${VARIANT}, ${ARM}${PRESSURE ? ', compaction pressure' : ''})`,
    hostSandbox: false,
    contextWindow: PRESSURE ? PRESSURE_WINDOW : undefined,
    homePatch: (home) => [
      {
        insert: [
          {
            id: 'corn-stop-fence-probe',
            name: PROBE_PLUGIN,
            config: {
              enabled: true,
              testHome: home,
              prepend: ARM !== 'gate-append',
            },
          },
        ],
      },
    ],
  },
  async (ctx) => {
    const progress = []
    try {
      return await probe(ctx, progress)
    } catch (error) {
      error.context = { tail: progress.slice(-8) }
      throw error
    }
  },
)
process.exit(report.passed ? 0 : 1)

async function probe(ctx, timeline) {
  const h = ctx.harness
  const jobs = new JobClient(h.transport)
  const probePost = async (action, body = {}) => {
    const response = await fetch(
      ctx.auth.url(`/api/corn-stop-fence-probe/${action}`),
      {
        method: 'POST',
        headers: { ...ctx.auth.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    const value = await response.json()
    if (!value.ok) throw new Error(`probe ${action} rejected`)
    return value
  }
  const admitted = await probePost('state')
  const bg = await h.boundSession('bi-parent', 'developer')
  await gitWorkspace(bg.agent.canonicalRoot)
  const fg = await h.boundSession('bi-fg', 'research')
  const approvals = openApprovals(h.mux)
  await until(() => approvals.state.clientId, '$events ready')
  const bgFollow = await h.follow(bg.sessionId)
  const fgFollow = await h.follow(fg.sessionId)
  const roleOf = new Map([
    [bg.sessionId, 'parent'],
    [fg.sessionId, 'fg'],
  ])
  const roleName = (sessionId) => roleOf.get(sessionId) ?? 'other'
  const answered = []
  let answering = true
  const answerLoop = (async () => {
    while (answering) {
      for (const ask of approvals.state.asked) {
        if (answered.some((row) => row.eventId === ask.eventId)) continue
        const tool = ask.request?.toolName
        const allowed =
          ['bash', 'subagent'].includes(tool) && ask.agentId !== fg.sessionId
        answered.push({
          eventId: ask.eventId,
          role: roleName(ask.agentId),
          toolName: tool,
          answer: allowed ? 'allowed-once' : 'rejected',
        })
        await h.transport
          .rpc('$events/result', {
            clientId: approvals.state.clientId,
            eventId: ask.eventId,
            outcome: {
              kind: 'result',
              value: allowed ? 'allowed-once' : 'rejected',
            },
          })
          .catch(() => {})
      }
      await delay(20)
    }
  })()
  const childrenOf = async () =>
    (await h.sessions.list())
      .map(record)
      .filter((item) => item.parentSessionId === bg.sessionId)
  const visibleJobs = async (sessionIds) => {
    const byId = new Map()
    for (const sessionId of sessionIds)
      for (const row of await jobs.rows(h.mux, sessionId))
        if (!byId.has(row.id)) byId.set(row.id, { ...row, via: sessionId })
    return [...byId.values()]
  }
  const parentRunning = async () =>
    (await h.sessions.list())
      .map(record)
      .some((item) => item.sessionId === bg.sessionId && item.running)

  // Arrange.
  await h.prompt(bg.sessionId, '⟦gate:bi-parent⟧ start the background work')
  if (PARENT_IDLE) {
    await until(
      () => bgFollow.state.events.some((e) => e.type === 'turn/end'),
      'parent turn completed',
      30_000,
      10,
    )
    await until(async () => !(await parentRunning()), 'parent idle', 5_000, 25)
  } else
    await ctx.stub.waitFor(
      (row) =>
        row.kind === 'agent' && row.scriptId === 'bi-parent' && row.hanging,
      'parent stream mid-flight',
      30_000,
    )
  let child
  let childFollow
  if (WITH_CHILD) {
    await ctx.stub.waitFor(
      (row) =>
        row.kind === 'agent' &&
        row.scriptId === childScript &&
        (CHILD_JOBS ? row.awaiting === 'late' : row.hanging),
      'child held',
      30_000,
    )
    ;[child] = await childrenOf()
    roleOf.set(child.sessionId, 'child')
    childFollow = await followChild(h.mux, bg.sessionId, child.sessionId)
  }
  const expectMarks = [
    ...(WITH_JOB ? [MARK.parent] : []),
    ...(CHILD_JOBS ? [MARK.childEarly] : []),
  ]
  await until(
    async () => {
      const marks = new Set((await markProcesses()).map((row) => row.mark))
      return expectMarks.every((mark) => marks.has(mark))
    },
    'job processes',
    10_000,
    50,
  )
  const lastEnd = bgFollow.state.events.findLast((e) => e.type === 'turn/end')
  const parentTurnEndBefore = lastEnd ? eventSummary(lastEnd) : null
  const parentRunningAtT0 = await parentRunning()
  await h.prompt(fg.sessionId, '⟦gate:bi-fg⟧ foreground keeps going')
  await until(
    () => fgFollow.state.chunks > 0,
    'foreground streaming',
    20_000,
    10,
  )

  // Stop.
  const seqAtStop = {
    parent: bgFollow.state.cursor,
    child: childFollow?.state.cursor ?? -1,
  }
  const requestsAtStop = ctx.stub.requests.length
  const T0 = Date.now()
  const mark = (label, extra = {}) =>
    timeline.push({ label, ms: Date.now() - T0, ...extra })
  if (FENCED)
    mark('fence', await probePost('fence', { sessionId: bg.sessionId }))
  const cancelParent = async () => {
    const receipt = await h.sessions.cancel(bg.sessionId).then(
      (value) => ({ ok: true, value }),
      (caught) => ({ ok: false, code: caught.code ?? null }),
    )
    mark('parent-cancel', { receipt })
    if (!PARENT_IDLE)
      await until(
        () =>
          bgFollow.state.events.some(
            (e) => e.type === 'turn/end' && e.seq > seqAtStop.parent,
          ),
        'parent turn end',
        5_000,
        5,
      )
  }
  const releaseLate = async () => {
    if (!CHILD_JOBS) return
    ctx.stub.release('late')
    const spawned = await until(
      async () =>
        (await markProcesses()).some((row) => row.mark === MARK.childLate),
      'late job process',
      5_000,
      25,
    ).catch(() => false)
    mark('late-released', { lateJobSpawned: Boolean(spawned) })
  }
  const stopChildren = async () => {
    for (const item of await childrenOf()) {
      await h.sessions.interruptChild({
        parentSessionId: bg.sessionId,
        childSessionId: item.sessionId,
      })
      mark('child-interrupt', { session: roleName(item.sessionId) })
    }
  }
  const killPass = async () => {
    const sessions = [
      bg.sessionId,
      ...(await childrenOf()).map((i) => i.sessionId),
    ]
    const rows = await visibleJobs(sessions)
    const kills = []
    for (const row of rows.filter(
      (r) => r.status === 'running' || r.status === 'stopping',
    )) {
      const outcome = await jobs.kill(row.via, row.id).then(
        () => 'killed',
        (caught) => caught.code ?? 'error',
      )
      kills.push({ id: row.id, owner: roleName(row.owner), outcome })
    }
    mark('kill-pass', { kills })
  }
  const processesGone = async () => {
    await until(
      async () => (await markProcesses()).length === 0,
      'job processes gone',
      5_000,
      25,
    ).catch(() => {})
    mark('processes', { left: (await markProcesses()).length })
  }
  switch (VARIANT) {
    case 'idle-job':
      await killPass()
      await processesGone()
      break
    case 'idle-subagent':
      await stopChildren()
      break
    case 'idle-tree':
    case 'leaf-first':
      await releaseLate()
      await stopChildren()
      await killPass()
      await processesGone()
      await cancelParent()
      break
    case 'cancel-first':
      await cancelParent()
      await releaseLate()
      await stopChildren()
      await killPass()
      await processesGone()
      break
    default:
      throw new Error(`unknown variant ${VARIANT}`)
  }
  if (child)
    await until(
      async () =>
        !(await h.sessions.list())
          .map(record)
          .some((item) => item.sessionId === child.sessionId && item.running),
      'child leaves running',
      10_000,
      25,
    ).catch(() => {})
  const stopDone = Date.now()
  mark('stop-done')

  const sinceStop = () => ctx.stub.requests.slice(requestsAtStop)
  // A compaction summarises the parent's marked prompt away; the foreground
  // and the child keep theirs, so an unmarked agent request is the parent's.
  const ofParent = (row) =>
    row.scriptId === 'bi-parent' || (row.kind === 'agent' && !row.scriptId)
  const parentRequests = (rows) => {
    const own = rows.filter(
      (row) => ofParent(row) && !row.markers.includes('probe:next'),
    )
    return {
      agent: own.filter((row) => row.kind === 'agent' && !row.compaction)
        .length,
      compaction: own.filter((row) => row.compaction).length,
      aux: own.filter((row) => row.kind === 'aux').length,
    }
  }
  // A woken Turn is one that started after T0; the running parent's own
  // cancelled Turn ends after T0 too but is not one.
  const turnsOf = (follow, seq) => {
    const events = follow?.state.events.filter((e) => e.seq > seq) ?? []
    const woken = new Set(
      events
        .filter((e) => e.type === 'turn/start')
        .map((e) => record(e.data).turn),
    )
    const ends = events.filter((e) => e.type === 'turn/end')
    const reason = (e) => record(e.data).reason?.kind ?? null
    return {
      starts: woken.size,
      wokenEnds: ends.filter((e) => woken.has(record(e.data).turn)).map(reason),
      otherEnds: ends
        .filter((e) => !woken.has(record(e.data).turn))
        .map(reason),
    }
  }
  const checkpoint = async (label) => {
    const items = (await h.sessions.list()).map(record)
    const sessions = [bg.sessionId, ...(child ? [child.sessionId] : [])]
    return {
      label,
      msAfterStop: Date.now() - stopDone,
      processes: (await markProcesses()).map((row) => row.mark),
      runningJobs: (await visibleJobs(sessions))
        .filter((row) => row.status === 'running' || row.status === 'stopping')
        .map((row) => ({ id: row.id, owner: roleName(row.owner) })),
      runningSessions: items
        .filter((item) => item.running && sessions.includes(item.sessionId))
        .map((item) => roleName(item.sessionId)),
      parentRequestsSinceT0: parentRequests(sinceStop()),
      childAgentRequestsSinceT0: sinceStop().filter(
        (row) =>
          row.kind === 'agent' &&
          row.scriptId === childScript &&
          row.receivedAt > T0,
      ).length,
      parentTurns: turnsOf(bgFollow, seqAtStop.parent),
      childTurns: turnsOf(childFollow, seqAtStop.child),
    }
  }
  await delay(Math.max(0, 2_000 - (Date.now() - stopDone)))
  const at2s = await checkpoint('+2s')
  await delay(Math.max(0, 10_000 - (Date.now() - stopDone)))
  const at10s = await checkpoint('+10s')
  await until(
    () => fgFollow.state.events.some((e) => e.type === 'turn/end'),
    'foreground turn end',
    20_000,
    20,
  )
  const stoppedState = await probePost('state')
  const parentEventsAfterStop = bgFollow.state.events
    .filter((e) => e.seq > seqAtStop.parent)
    .map((e) => ({
      ...eventSummary(e),
      ...(e.type === 'user/message'
        ? { source: messageOf(e).source?.kind ?? null }
        : {}),
      ...(e.type === 'agent/inbox/spliced' ? splicedOf(e) : {}),
    }))
  const childEventsAfterStop = (childFollow?.state.events ?? [])
    .filter((e) => e.seq > seqAtStop.child)
    .map((e) => eventSummary(e))

  // Follow-up: lift the fence (a new user prompt is a new Run), one prompt.
  const lifted = FENCED
    ? await probePost('lift', { sessionId: bg.sessionId })
    : null
  const seqBeforeNext = bgFollow.state.cursor
  const requestsBeforeNext = ctx.stub.requests.length
  const decisionsBeforeNext = stoppedState.decisions.length
  await h.prompt(bg.sessionId, '⟦probe:next⟧ follow-up after the stop')
  await until(
    () =>
      bgFollow.state.events.some(
        (e) => e.type === 'turn/end' && e.seq > seqBeforeNext,
      ),
    'next prompt turn end',
    30_000,
    10,
  )
  // A pre-step compaction replays the surface before the prompt is on it.
  const nextRequests = ctx.stub.requests
    .slice(requestsBeforeNext)
    .filter((row) => row.markers.includes('probe:next') || ofParent(row))
  const finalState = await probePost('state')
  answering = false
  await answerLoop
  await ctx.host.stop()
  const leftoverAfterHostStop = (await markProcesses()).length
  for (const row of await markProcesses()) process.kill(row.pid, 'SIGKILL')

  const decisionRow = (row) => ({
    ms: row.at - T0,
    session: roleName(row.sessionId),
    turn: row.turn,
    step: row.step,
    claimed: row.claimed,
    decision: row.decision,
  })
  const fgUpstream = ctx.stub.requests.find(
    (row) => row.kind === 'agent' && row.scriptId === 'bi-fg',
  )
  const nextTurnEvents = bgFollow.state.events.filter(
    (e) => e.seq > seqBeforeNext,
  )
  const facts = {
    variant: VARIANT,
    arm: ARM,
    pressure: PRESSURE,
    admission: {
      route:
        'home cordis.patch.yml insert (user layer); Host booted through verifyClawProfile and checkClawRuntime',
      pluginLive: admitted.ok === true,
      prepend: admitted.prepend,
      hookOrderAtBoot: compactOrder(admitted.hookOrder),
      hookOrderAtStop: compactOrder(stoppedState.hookOrder),
    },
    approvals: answered.map(({ role, toolName, answer }) => ({
      role,
      toolName,
      answer,
    })),
    before: {
      parentRunningAtT0,
      parentTurnEnd: parentTurnEndBefore,
      compactionBeforeT0: ctx.stub.requests
        .slice(0, requestsAtStop)
        .filter((row) => row.compaction).length,
    },
    timeline,
    checkpoints: [at2s, at10s],
    parentRequestsAfterStop: ctx.stub.requests
      .slice(requestsAtStop, requestsBeforeNext)
      .filter(ofParent)
      .map((row) => ({
        kind: row.compaction ? 'compaction' : row.kind,
        marked: row.scriptId === 'bi-parent',
        step: row.step,
        receivedMs: row.receivedAt - T0,
        notices: row.notices,
      })),
    preStepAfterStop: stoppedState.decisions
      .filter((row) => row.at >= T0)
      .map(decisionRow),
    parentEventsAfterStop,
    childEventsAfterStop,
    next: {
      lifted: lifted?.fenced ?? null,
      turnEnd: eventSummary(nextTurnEvents.find((e) => e.type === 'turn/end')),
      turnStarts: nextTurnEvents.filter((e) => e.type === 'turn/start').length,
      userMessages: nextTurnEvents
        .filter((e) => e.type === 'user/message')
        .map((e) => messageOf(e).source?.kind ?? null),
      preStep: finalState.decisions.slice(decisionsBeforeNext).map(decisionRow),
      requests: nextRequests.map((row) => ({
        kind: row.compaction ? 'compaction' : row.kind,
        completed: row.completed,
        notices: row.notices,
      })),
    },
    foreground: {
      turnEnd: eventSummary(
        fgFollow.state.events.find((e) => e.type === 'turn/end'),
      ),
      upstreamChunks: fgUpstream?.chunksSent ?? 0,
      upstreamCompleted: fgUpstream?.completed ?? false,
    },
    leftoverAfterHostStop,
    resources: ctx.sampler.window(),
  }
  const clean = (point) =>
    point.processes.length === 0 &&
    point.runningJobs.length === 0 &&
    point.runningSessions.length === 0
  const leak = (point) =>
    point.parentRequestsSinceT0.agent + point.parentRequestsSinceT0.compaction
  const nextAgent = facts.next.requests.filter((row) => row.kind === 'agent')
  facts.expectations = {
    pluginLive: facts.admission.pluginLive,
    cleanAt2s: clean(at2s),
    cleanAt10s: clean(at10s),
    foregroundUnaffected:
      facts.foreground.turnEnd.reason?.kind === 'completed' &&
      facts.foreground.upstreamChunks === 40,
    nextPromptCompleted:
      facts.next.turnEnd.reason?.kind === 'completed' &&
      nextAgent.some((row) => row.completed),
    ...(FENCED
      ? {
          noParentRequestAfterStop: leak(at10s) === 0,
          wokenTurnsBlocked:
            at10s.parentTurns.wokenEnds.length === at10s.parentTurns.starts &&
            at10s.parentTurns.wokenEnds.every((kind) => kind === 'blocked'),
        }
      : {}),
  }
  facts.passed = Object.values(facts.expectations).every(Boolean)
  return facts
}
