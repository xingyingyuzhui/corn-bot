import { setTimeout as delay } from 'node:timers/promises'
import {
  descendants,
  eventSummary,
  gitWorkspace,
  openApprovals,
  processTable,
  until,
} from './lib/gate-env.mjs'
import { runGate } from './lib/gate-session.mjs'

// Run: node scripts/gates/run.mjs scripts/gates/b2-targeted-cancel.mjs
// ADR-0007 §5.2 scenario 4 (DSH gate B2): `session.cancel` on the background
// Session only, while it owns a background shell job and a background
// subagent and its own model stream is mid-flight; the foreground Session
// streams at the same time. Fixed side-effect-free work: `sleep <marker>` and
// a child whose model stream hangs.
const SLEEP = 'sleep 47.913'
const scripts = {
  'b2-bg': [
    {
      toolCall: {
        name: 'bash',
        arguments: {
          command: SLEEP,
          description: 'gate background sleep job',
          run_in_background: true,
        },
      },
    },
    {
      toolCall: {
        name: 'subagent',
        arguments: {
          description: 'gate child task',
          prompt: '⟦gate:b2-child⟧ child task for the gate probe',
          run_in_background: true,
        },
      },
    },
    { chunks: ['bg ', 'working ', 'now '], chunkDelayMs: 50, hang: true },
  ],
  'b2-child': [{ chunks: ['child '], hang: true }],
  'b2-fg': [{ chunks: Array(20).fill('fg '), chunkDelayMs: 200 }],
}
const turnEnds = (follow) =>
  follow.state.events.filter((event) => event.type === 'turn/end')
const sleepers = async () =>
  (await processTable())
    .filter((row) => row.command.includes(SLEEP))
    .map((row) => row.pid)

// `--host-unsandboxed`: the background bash job can only run when the Host is
// outside the gate sandbox (see `unsandboxedSpawn`).
const hostSandbox = !process.argv.includes('--host-unsandboxed')
const report = await runGate(
  hostSandbox ? 'b2-targeted-cancel' : 'b2-targeted-cancel-host-unsandboxed',
  {
    scripts,
    title: 'session.cancel on the background Session only',
    hostSandbox,
  },
  async (ctx) => {
    const h = ctx.harness
    const bg = await h.boundSession('b2-bg', 'developer')
    await gitWorkspace(bg.agent.canonicalRoot)
    const fg = await h.boundSession('b2-fg', 'research')
    const approvals = openApprovals(h.mux)
    await until(() => approvals.state.clientId, '$events ready')
    const bgFollow = await h.follow(bg.sessionId)
    const fgFollow = await h.follow(fg.sessionId)
    const answered = []
    let answering = true
    const answerLoop = (async () => {
      while (answering) {
        for (const ask of approvals.state.asked) {
          if (answered.some((row) => row.eventId === ask.eventId)) continue
          const allowed = ['bash', 'subagent'].includes(ask.request?.toolName)
          answered.push({
            eventId: ask.eventId,
            toolName: ask.request?.toolName,
            agentId: ask.agentId === bg.sessionId ? 'bg' : 'other',
            answer: allowed ? 'allowed-once' : 'rejected',
          })
          await h.transport.rpc('$events/result', {
            clientId: approvals.state.clientId,
            eventId: ask.eventId,
            outcome: {
              kind: 'result',
              value: allowed ? 'allowed-once' : 'rejected',
            },
          })
        }
        await delay(25)
      }
    })()

    await h.prompt(bg.sessionId, '⟦gate:b2-bg⟧ start the background work')
    const bgMidStream = await ctx.stub.waitFor(
      (row) =>
        row.kind === 'agent' &&
        row.scriptId === 'b2-bg' &&
        row.step >= 2 &&
        row.hanging,
      'background stream mid-flight after its jobs',
      30_000,
    )
    const hostTree = async () => {
      const table = await processTable()
      return descendants(table, ctx.host.processId).map((row) =>
        row.command.slice(0, 160),
      )
    }
    const sleepBefore = await until(
      async () => {
        const pids = await sleepers()
        return pids.length > 0 ? pids : undefined
      },
      'background sleep job',
      3_000,
      100,
    ).catch(() => [])
    const child = await ctx.stub
      .waitFor(
        (row) =>
          row.kind === 'agent' && row.scriptId === 'b2-child' && row.hanging,
        'subagent stream',
        5_000,
      )
      .catch(() => null)
    const childBeforeCancel = child
      ? { hanging: child.hanging, chunks: child.chunksSent }
      : null
    const toolResultsBeforeCancel = bgFollow.state.events
      .filter((e) => e.type === 'tool/result')
      .map((e) =>
        (e.data?.message?.content ?? [])
          .map((part) => part.text ?? '')
          .join('')
          .slice(0, 300),
      )

    const treeBeforeCancel = await hostTree()
    await h.prompt(fg.sessionId, '⟦gate:b2-fg⟧ foreground keeps going')
    await until(
      () => fgFollow.state.chunks > 0,
      'foreground first chunk',
      20_000,
      10,
    )
    const fgUpstream = ctx.stub.requests.find(
      (row) => row.kind === 'agent' && row.scriptId === 'b2-fg',
    )

    const cancelAt = Date.now()
    const receipt = await h.sessions.cancel(bg.sessionId)
    const receiptMs = Date.now() - cancelAt
    await until(
      () => turnEnds(bgFollow).length > 0,
      'background turn end after cancel',
      15_000,
      10,
    )
    const bgEndMs = Date.now() - cancelAt
    await until(
      () => bgMidStream.closedByClient,
      'background upstream closed',
      10_000,
      10,
    ).catch(() => {})
    const upstreamClosedMs = bgMidStream.endedAt
      ? bgMidStream.endedAt - cancelAt
      : null
    await delay(2_000)
    const sleepAfterCancel = await sleepers()
    const treeAfterCancel = await hostTree()
    const childAfterCancel = child
      ? {
          closedByClient: child.closedByClient,
          endedMs: child.endedAt ? child.endedAt - cancelAt : null,
          hanging: child.hanging,
        }
      : null
    const sessionsAfter = (await h.sessions.list()).map((item) => ({
      role:
        item.sessionId === bg.sessionId
          ? 'bg'
          : item.sessionId === fg.sessionId
            ? 'fg'
            : 'other',
      running: item.running ?? null,
      origin: item.origin ?? item.meta?.origin ?? null,
      parentIsBg: [item.parentSessionId, item.meta?.parentSession].includes(
        bg.sessionId,
      ),
      keys: Object.keys(item),
    }))
    await until(
      () => turnEnds(fgFollow).length > 0,
      'foreground turn end',
      20_000,
      20,
    )
    answering = false
    await answerLoop

    const bgEnd = eventSummary(turnEnds(bgFollow)[0])
    const fgEnd = eventSummary(turnEnds(fgFollow)[0])
    const bgAfterEnd = bgFollow.state.events
      .filter((e) => e.seq > bgEnd.seq)
      .map(eventSummary)
    await ctx.host.stop()
    const sleepAfterHostStop = await sleepers()
    for (const pid of sleepAfterHostStop) process.kill(pid, 'SIGKILL')

    const facts = {
      approvals: answered,
      beforeCancel: {
        backgroundShellJobPids: sleepBefore.length,
        subagentChild: childBeforeCancel,
        toolResults: toolResultsBeforeCancel,
      },
      cancel: {
        receipt,
        receiptMs,
        turnEndMs: bgEndMs,
        upstreamClosedMs,
        upstreamClosedByClient: bgMidStream.closedByClient,
      },
      background: { turnEnd: bgEnd, eventsAfterTurnEnd: bgAfterEnd },
      foreground: {
        turnEnd: fgEnd,
        upstreamChunks: fgUpstream.chunksSent,
        upstreamCompleted: fgUpstream.completed,
        upstreamClosedByClient: fgUpstream.closedByClient,
      },
      backgroundShellJob: {
        aliveBeforeCancel: sleepBefore.length > 0,
        alive2sAfterCancel: sleepAfterCancel.length > 0,
        aliveAfterHostStop: sleepAfterHostStop.length > 0,
        killedByGateCleanup: sleepAfterHostStop.length,
        hostTreeBeforeCancel: treeBeforeCancel,
        hostTreeAfterCancel: treeAfterCancel,
      },
      backgroundEventTypes: bgFollow.state.events.map(
        (e) => `${e.seq}:${e.type}`,
      ),
      backgroundNotices: bgFollow.state.events
        .filter((e) => e.type === 'user/message' && e.seq > bgEnd.seq - 8)
        .map((e) => ({
          seq: e.seq,
          data: JSON.stringify(e.data).slice(0, 900),
        })),
      subagent: childAfterCancel,
      sessionsAfterCancel: sessionsAfter,
      resources: ctx.sampler.window(),
    }
    // Pass covers the targeted stop of the Session's own Turn; job/subagent
    // termination is recorded as an observation, not assumed.
    facts.passed =
      bgEnd.reason?.kind === 'aborted' &&
      bgEnd.reason?.reason?.kind === 'user' &&
      bgMidStream.closedByClient &&
      fgEnd.reason?.kind === 'completed' &&
      fgUpstream.completed &&
      !fgUpstream.closedByClient &&
      fgUpstream.chunksSent === 20
    return facts
  },
)
process.exit(report.passed ? 0 : 1)
