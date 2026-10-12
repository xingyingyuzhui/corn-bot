import { connect } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { JobClient } from '../../packages/dsh-adapter/src/job-client.ts'
import { record } from '../../packages/dsh-adapter/src/remote-error.ts'
import {
  descendants,
  eventSummary,
  gitWorkspace,
  openApprovals,
  processTable,
  until,
} from './lib/gate-env.mjs'
import { runGate } from './lib/gate-session.mjs'

// Run: node scripts/gates/run.mjs scripts/gates/b6-run-level-stop.mjs [-- --jobs-first | --leaf-first] [--recancel]
// DSH gate B6 (ADR-0007 revisit trigger "targeted stop"): B2's background
// Session owns a background shell job and a background subagent; the child
// owns its own background job and, mid-stop, spawns a late one (its model
// stream is held on a release gate). The run-level stop uses DSH APIs only:
// `session.cancel` (parent), `subagents.interruptByParent` for every child
// found through `session.list` (`session.cancel` refuses owned children),
// `job.list` per Session and `job.kill`.
// - sessions-first: parent, late spawn, children, then one job pass.
// - jobs-first: parent, job pass, late spawn, children (the race), and a
//   second job pass if anything survived to +2 s.
// - leaf-first: late spawn, children, job pass, processes gone, parent last.
// `--recancel` cancels the parent again if a settlement notice woke it.
// Jobs run `sleep A & sleep B & wait`, so each job has a bash parent and two
// descendants; every process carries the job's marker in its argv. The Host
// runs outside the gate sandbox (DSH bash Seatbelt cannot nest).
const ORDER = process.argv.includes('--jobs-first')
  ? 'jobs-first'
  : process.argv.includes('--leaf-first')
    ? 'leaf-first'
    : 'sessions-first'
const RECANCEL = process.argv.includes('--recancel')
const MARK = { parent: '53.11', childEarly: '53.21', childLate: '53.31' }
const bashJob = (mark, description) => ({
  name: 'bash',
  arguments: {
    command: `sleep ${mark}1 & sleep ${mark}2 & wait`,
    description,
    run_in_background: true,
  },
})
const scripts = {
  'b6-bg': [
    { toolCall: bashJob(MARK.parent, 'gate parent job') },
    {
      toolCall: {
        name: 'subagent',
        arguments: {
          description: 'gate child task',
          prompt: '⟦gate:b6-child⟧ child task for the gate probe',
          run_in_background: true,
        },
      },
    },
    { chunks: ['bg ', 'working '], chunkDelayMs: 50, hang: true },
  ],
  'b6-child': [
    { toolCall: bashJob(MARK.childEarly, 'gate child early job') },
    {
      chunks: ['child '],
      awaitRelease: 'late',
      toolCall: bashJob(MARK.childLate, 'gate child late job'),
    },
    { chunks: ['child after late job'], hang: true },
  ],
  'b6-fg': [{ chunks: Array(40).fill('fg '), chunkDelayMs: 200 }],
}
const ALL_MARKS = Object.values(MARK)
const markOf = (command) =>
  ALL_MARKS.find((mark) =>
    new RegExp(`sleep ${mark.replace('.', '\\.')}[12]`).test(command),
  )
const markProcesses = async () =>
  (await processTable())
    .map((row) => ({ ...row, mark: markOf(row.command) }))
    .filter((row) => row.mark)
const pidAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const listening = (port) =>
  new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.once('connect', () => resolve(socket.end() && true))
    socket.once('error', () => resolve(false))
  })
const messageOf = (event) => event.data?.message ?? event.data ?? {}
const textOf = (event) =>
  (messageOf(event).content ?? []).map((part) => part.text ?? '').join(' ')
/** Inbox notices: what DSH delivered into a stopped Session, and from whom. */
const splicedOf = (event) => ({
  target: event.data?.target ?? null,
  removed: event.data?.removedCount ?? 0,
  outcome: event.data?.outcome ?? null,
  inserted: (event.data?.inserted ?? []).map((item) => ({
    source: item.source?.kind ?? null,
    senderSessionId: item.source?.senderSessionId ?? null,
    summary: String(item.source?.summary ?? '').slice(0, 160),
  })),
})

/** A child Session is followed through its durable parent address only. */
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
    'child follow snapshot',
    5_000,
    10,
  )
  if (state.failure) throw state.failure
  return { state }
}

const report = await runGate(
  `b6-run-level-stop-${ORDER}${RECANCEL ? '-recancel' : ''}`,
  {
    scripts,
    title: `Run-level stop via DSH APIs (${ORDER}${RECANCEL ? ', re-cancel' : ''})`,
    hostSandbox: false,
  },
  async (ctx) => {
    const progress = []
    try {
      return await probe(ctx, progress)
    } catch (error) {
      progress.stopWatch = true
      error.context = {
        tail: progress.slice(-8),
        hostWatch: progress.hostWatch,
      }
      throw error
    }
  },
)
process.exit(report.passed ? 0 : 1)

async function probe(ctx, progress) {
  const h = ctx.harness
  const jobs = new JobClient(h.transport)
  const bg = await h.boundSession('b6-bg', 'developer')
  await gitWorkspace(bg.agent.canonicalRoot)
  const fg = await h.boundSession('b6-fg', 'research')
  const approvals = openApprovals(h.mux)
  await until(() => approvals.state.clientId, '$events ready')
  const bgFollow = await h.follow(bg.sessionId)
  const fgFollow = await h.follow(fg.sessionId)
  const roleOf = new Map([
    [bg.sessionId, 'bg'],
    [fg.sessionId, 'fg'],
  ])
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
          at: Date.now() - ctx.t0,
          role: roleOf.get(ask.agentId) ?? 'unknown',
          toolName: tool,
          requestKeys: Object.keys(ask.request ?? {}),
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
  const childrenOf = async (parents) => {
    const items = (await h.sessions.list()).map(record)
    const found = []
    let frontier = [...parents]
    while (frontier.length) {
      const next = items.filter((item) =>
        frontier.includes(item.parentSessionId),
      )
      found.push(...next)
      frontier = next.map((item) => item.sessionId)
    }
    return found
  }
  const visibleJobs = async (sessionIds) => {
    const byId = new Map()
    for (const sessionId of sessionIds)
      for (const row of await jobs.rows(h.mux, sessionId))
        if (!byId.has(row.id)) byId.set(row.id, { ...row, via: sessionId })
    return [...byId.values()]
  }
  const roleName = (sessionId) => roleOf.get(sessionId) ?? sessionId

  // Arrange: parent job, child with early job, child held before late job.
  await h.prompt(bg.sessionId, '⟦gate:b6-bg⟧ start the background work')
  await ctx.stub.waitFor(
    (row) =>
      row.kind === 'agent' &&
      row.scriptId === 'b6-bg' &&
      row.step >= 2 &&
      row.hanging,
    'parent stream mid-flight',
    30_000,
  )
  const childHeld = await ctx.stub.waitFor(
    (row) =>
      row.kind === 'agent' &&
      row.scriptId === 'b6-child' &&
      row.awaiting === 'late',
    'child held before its late job',
    30_000,
  )
  const [child] = await childrenOf([bg.sessionId])
  roleOf.set(child.sessionId, 'child')
  const childFollow = await followChild(h.mux, bg.sessionId, child.sessionId)
  await until(
    async () => {
      const marks = new Set((await markProcesses()).map((row) => row.mark))
      return marks.has(MARK.parent) && marks.has(MARK.childEarly)
    },
    'parent and child early job processes',
    10_000,
    50,
  )
  const before = await markProcesses()
  const table = await processTable()
  const jobTrees = Object.fromEntries(
    [MARK.parent, MARK.childEarly].map((mark) => {
      const rows = before.filter((row) => row.mark === mark)
      const roots = rows.filter(
        (row) => !rows.some((other) => other.pid === row.ppid),
      )
      return [
        mark,
        roots.map((root) => ({
          root: root.command.slice(0, 80),
          tree: descendants(table, root.pid).map((row) =>
            row.command.slice(0, 60),
          ),
        })),
      ]
    }),
  )
  const rosterBefore = {
    bg: await jobs.rows(h.mux, bg.sessionId),
    child: await jobs.rows(h.mux, child.sessionId),
  }
  const parentSubagentCatalog = JSON.stringify(
    record(await h.sessions.projections(bg.sessionId)).values
      ?.subagentCatalog ?? null,
  ).slice(0, 400)
  await h.prompt(fg.sessionId, '⟦gate:b6-fg⟧ foreground keeps going')
  await until(
    () => fgFollow.state.chunks > 0,
    'foreground streaming',
    20_000,
    10,
  )

  // Process watcher: first time each marker has no process left.
  const seen = new Map()
  const goneAt = new Map()
  let watching = true
  let T0 = 0
  const hostPort = Number(ctx.auth.url('/api/').port)
  const hostWatch = {
    hostPid: ctx.host.processId,
    hostPort,
    listenerDownMs: null,
    pidGoneMs: null,
    fgTurnEndMs: null,
  }
  progress.hostWatch = hostWatch
  const hostPid = ctx.host.processId
  const hostWatcher = (async () => {
    while (hostWatch.pidGoneMs === null) {
      await delay(50)
      if (!T0) continue
      const now = Date.now()
      if (hostWatch.listenerDownMs === null && !(await listening(hostPort)))
        hostWatch.listenerDownMs = now - T0
      if (!pidAlive(hostPid)) hostWatch.pidGoneMs = now - T0
      if (
        hostWatch.fgTurnEndMs === null &&
        fgFollow.state.events.some((e) => e.type === 'turn/end')
      )
        hostWatch.fgTurnEndMs = now - T0
      if (progress.stopWatch) break
    }
  })()
  const watcher = (async () => {
    while (watching) {
      const rows = await markProcesses()
      const now = Date.now()
      for (const row of rows) {
        if (!seen.has(row.mark))
          seen.set(row.mark, {
            firstSeenMs: T0 ? now - T0 : null,
            pids: new Set(),
          })
        seen.get(row.mark).pids.add(row.pid)
        goneAt.delete(row.mark)
      }
      for (const mark of seen.keys())
        if (!rows.some((row) => row.mark === mark) && !goneAt.has(mark))
          goneAt.set(mark, now - T0)
      await delay(25)
    }
  })()

  let childCancelAt = Number.POSITIVE_INFINITY
  const timeline = progress
  const mark = (label, extra = {}) =>
    timeline.push({
      label,
      ms: Date.now() - T0,
      gateMs: Date.now() - ctx.t0,
      ...extra,
    })
  const cancelSessions = async () => {
    const children = await childrenOf([bg.sessionId])
    mark('children-enumerated', { count: children.length })
    for (const item of children) {
      const direct = await h.sessions.cancel(item.sessionId).then(
        (receipt) => ({ ok: true, receipt }),
        (caught) => ({
          ok: false,
          code: caught.code ?? null,
          message: String(caught.message).slice(0, 160),
        }),
      )
      mark('child-session-cancel', {
        session: roleName(item.sessionId),
        direct,
      })
      await h.sessions.interruptChild({
        parentSessionId: item.parentSessionId,
        childSessionId: item.sessionId,
      })
      childCancelAt = Date.now()
      mark('child-interrupt-receipt', { session: roleName(item.sessionId) })
    }
    return children
  }
  const killPass = async (label) => {
    const children = await childrenOf([bg.sessionId])
    const rows = await visibleJobs([
      bg.sessionId,
      ...children.map((item) => item.sessionId),
    ])
    mark(`${label}-jobs-enumerated`, {
      jobs: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        owner: roleName(row.owner),
        status: row.status,
      })),
    })
    const kills = []
    for (const row of rows.filter(
      (item) => item.status === 'running' || item.status === 'stopping',
    )) {
      const at = Date.now()
      mark(`${label}-kill-start`, { id: row.id, via: roleName(row.via) })
      const outcome = await jobs.kill(row.via, row.id).catch((caught) => ({
        error: String(caught.message).slice(0, 120),
        code: caught.code ?? null,
      }))
      kills.push({
        id: row.id,
        owner: roleName(row.owner),
        outcome,
        rpcMs: Date.now() - at,
      })
    }
    mark(`${label}-kills`, { kills })
    return kills
  }
  const releaseLate = async () => {
    ctx.stub.release('late')
    mark('late-released')
    const spawned = await until(
      async () =>
        (await markProcesses()).some((row) => row.mark === MARK.childLate),
      'late job process',
      5_000,
      25,
    ).catch(() => false)
    mark('late-job-process', { spawned: Boolean(spawned) })
  }

  // Stop.
  const requestsAtStop = ctx.stub.requests.length
  const seqAtStop = {
    bg: bgFollow.state.cursor,
    child: childFollow.state.cursor,
  }
  let parentCancelAt = Number.POSITIVE_INFINITY
  const cancelParent = async () => {
    parentCancelAt = Date.now()
    const receipt = await h.sessions.cancel(bg.sessionId)
    mark('parent-cancel-receipt', { receipt })
    await until(
      () =>
        bgFollow.state.events.some(
          (e) => e.type === 'turn/end' && e.seq > seqAtStop.bg,
        ),
      'parent turn end',
      5_000,
      5,
    )
    mark('parent-turn-end')
  }
  const stopChildren = async () => {
    await cancelSessions()
    await until(
      () =>
        childFollow.state.events.some(
          (e) => e.type === 'turn/end' && e.seq > seqAtStop.child,
        ),
      'child turn end',
      5_000,
      5,
    ).catch(() => {})
    mark('child-turn-end')
  }
  await until(
    () => seen.has(MARK.parent) && seen.has(MARK.childEarly),
    'watcher baseline',
    5_000,
    10,
  )
  T0 = Date.now()
  switch (ORDER) {
    case 'sessions-first':
      await cancelParent()
      await releaseLate()
      await stopChildren()
      await killPass('pass1')
      break
    case 'jobs-first':
      await cancelParent()
      await killPass('pass1')
      await releaseLate()
      await stopChildren()
      break
    case 'leaf-first':
      await releaseLate()
      await stopChildren()
      await killPass('pass1')
      await until(
        async () => (await markProcesses()).length === 0,
        'job processes gone',
        5_000,
        25,
      ).catch(() => {})
      mark('job-processes-gone', { left: (await markProcesses()).length })
      await cancelParent()
      break
    default:
      throw new Error(`unknown order ${ORDER}`)
  }
  if (RECANCEL) {
    const woke = await until(
      () =>
        bgFollow.state.events.some(
          (e) => e.type === 'turn/start' && e.seq > seqAtStop.bg,
        ),
      'parent reactivated',
      2_000,
      5,
    ).catch(() => false)
    mark('parent-reactivated', { woke: Boolean(woke) })
    if (woke) {
      const receipt = await h.sessions.cancel(bg.sessionId)
      const turnEnds = () =>
        bgFollow.state.events.filter(
          (e) => e.type === 'turn/end' && e.seq > seqAtStop.bg,
        ).length
      await until(() => turnEnds() >= 2, 'reactivated turn end', 5_000, 5)
      mark('parent-recancel', { receipt })
    }
  }
  await until(
    async () =>
      !(await h.sessions.list())
        .map(record)
        .some((item) => item.sessionId === child.sessionId && item.running),
    'child leaves running',
    10_000,
    25,
  ).catch(() => {})
  mark('child-not-running')
  const stopDone = Date.now()

  const checkpoint = async (label) => {
    const items = (await h.sessions.list()).map(record)
    return {
      label,
      msAfterStop: Date.now() - stopDone,
      processes: (await markProcesses()).map((row) => ({
        mark: row.mark,
        ppid: row.ppid,
      })),
      runningJobs: (await visibleJobs([bg.sessionId, child.sessionId]))
        .filter((row) => row.status === 'running' || row.status === 'stopping')
        .map((row) => ({ id: row.id, owner: roleName(row.owner) })),
      runningSessions: items
        .filter(
          (item) =>
            item.running &&
            [bg.sessionId, child.sessionId].includes(item.sessionId),
        )
        .map((item) => roleName(item.sessionId)),
      // Model requests a stopped Session made after its own cancel.
      agentRequestsSinceStop: ctx.stub.requests
        .slice(requestsAtStop)
        .filter(
          (row) =>
            row.kind === 'agent' &&
            ((row.scriptId === 'b6-bg' && row.receivedAt > parentCancelAt) ||
              (row.scriptId === 'b6-child' && row.receivedAt > childCancelAt)),
        )
        .map((row) => ({
          scriptId: row.scriptId,
          step: row.step,
          receivedMs: row.receivedAt - T0,
        })),
      turnStartsSinceStop: [
        ...bgFollow.state.events
          .filter((e) => e.type === 'turn/start' && e.seq > seqAtStop.bg)
          .map(() => 'bg'),
        ...childFollow.state.events
          .filter((e) => e.type === 'turn/start' && e.seq > seqAtStop.child)
          .map(() => 'child'),
      ],
    }
  }
  await delay(Math.max(0, 2_000 - (Date.now() - stopDone)))
  const at2s = await checkpoint('+2s')
  let pass2 = null
  if (ORDER === 'jobs-first' && at2s.processes.length > 0) {
    const passStart = Date.now()
    pass2 = { kills: await killPass('pass2') }
    await until(
      async () => (await markProcesses()).length === 0,
      'pass2 processes gone',
      10_000,
      25,
    ).catch(() => {})
    pass2.allGoneMs =
      (await markProcesses()).length === 0 ? Date.now() - passStart : null
  }
  await delay(Math.max(0, 10_000 - (Date.now() - stopDone)))
  const at10s = await checkpoint('+10s')
  watching = false
  await watcher
  progress.stopWatch = true
  await hostWatcher
  await until(
    () => fgFollow.state.events.some((e) => e.type === 'turn/end'),
    'foreground turn end',
    20_000,
    20,
  )
  answering = false
  await answerLoop

  const fgUpstream = ctx.stub.requests.find(
    (row) => row.kind === 'agent' && row.scriptId === 'b6-fg',
  )
  const childUpstream = ctx.stub.requests.filter(
    (row) => row.kind === 'agent' && row.scriptId === 'b6-child',
  )
  const afterStop = (follow, seq) =>
    follow.state.events
      .filter((e) => e.seq > seq)
      .map((e) => ({
        ...eventSummary(e),
        ...(e.type === 'user/message'
          ? {
              source: messageOf(e).source?.kind ?? null,
              text: textOf(e).slice(0, 220),
            }
          : {}),
        ...(e.type === 'agent/inbox/spliced' ? splicedOf(e) : {}),
      }))
  const finalRoster = {
    bg: await jobs.rows(h.mux, bg.sessionId),
    child: await jobs.rows(h.mux, child.sessionId),
  }
  await ctx.host.stop()
  const leftoverAfterHostStop = (await markProcesses()).length
  for (const row of await markProcesses()) process.kill(row.pid, 'SIGKILL')

  const facts = {
    order: ORDER,
    approvals: answered,
    before: {
      jobTrees,
      roster: Object.fromEntries(
        Object.entries(rosterBefore).map(([key, rows]) => [
          key,
          rows.map((row) => ({
            id: row.id,
            kind: row.kind,
            owner: roleName(row.owner),
            status: row.status,
            label: row.label,
          })),
        ]),
      ),
      childHeldAtStep: childHeld.step,
      parentSubagentCatalog,
    },
    timeline,
    processesGoneMs: Object.fromEntries(
      [...seen.entries()].map(([key, value]) => [
        key,
        {
          pids: value.pids.size,
          firstSeenAfterT0Ms: value.firstSeenMs,
          goneMs: goneAt.get(key) ?? null,
        },
      ]),
    ),
    childUpstream: childUpstream.map((row) => ({
      step: row.step,
      receivedMs: row.receivedAt - T0,
      closedByClient: row.closedByClient,
      endedMs: row.endedAt ? row.endedAt - T0 : null,
      releasedMs: row.releasedAt ? row.releasedAt - T0 : null,
    })),
    checkpoints: [at2s, at10s],
    hostWatch,
    pass2,
    foreground: {
      turnEnd: eventSummary(
        fgFollow.state.events.find((e) => e.type === 'turn/end'),
      ),
      upstreamChunks: fgUpstream.chunksSent,
      upstreamCompleted: fgUpstream.completed,
      upstreamClosedByClient: fgUpstream.closedByClient,
    },
    events: {
      bg: afterStop(bgFollow, seqAtStop.bg),
      child: afterStop(childFollow, seqAtStop.child),
    },
    finalRoster: Object.fromEntries(
      Object.entries(finalRoster).map(([key, rows]) => [
        key,
        rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          owner: roleName(row.owner),
          status: row.status,
          detail: row.detail,
        })),
      ]),
    ),
    leftoverAfterHostStop,
    resources: ctx.sampler.window(),
  }
  const clean = (point) =>
    point.processes.length === 0 &&
    point.runningJobs.length === 0 &&
    point.runningSessions.length === 0 &&
    point.agentRequestsSinceStop.length === 0 &&
    point.turnStartsSinceStop.length === 0
  const fgOk =
    facts.foreground.turnEnd.reason?.kind === 'completed' &&
    fgUpstream.completed &&
    !fgUpstream.closedByClient &&
    fgUpstream.chunksSent === 40
  const lateSpawned =
    timeline.find((row) => row.label === 'late-job-process')?.spawned === true
  facts.expectations = {
    lateSpawnedDuringStop: lateSpawned,
    cleanAt2s: clean(at2s),
    cleanAt10s: clean(at10s),
    foregroundUnaffected: fgOk,
  }
  facts.passed = Object.values(facts.expectations).every(Boolean)
  return facts
}
