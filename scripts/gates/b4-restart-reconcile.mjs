import { setTimeout as delay } from 'node:timers/promises'
import {
  eventSummary,
  openApprovals,
  processTable,
  readOnlyReconcile,
  until,
} from './lib/gate-env.mjs'
import { runGate } from './lib/gate-session.mjs'

// Run: node scripts/gates/run.mjs scripts/gates/b4-restart-reconcile.mjs
// ADR-0007 §5.2 scenario 6 (DSH gate B4): SIGKILL the Host while S1 streams
// (with one queued inbox item) and S2 waits on a running foreground bash,
// restart on the same home, then reconcile read-only (projections + page, no
// follow). Only afterwards a cold follow is opened, recorded separately.
// The Host runs outside the gate sandbox so the bash process is real (DSH's
// own Seatbelt cannot nest); isolation is loopback config + scrubbed env.
const SLEEP = 'sleep 39.517'
const scripts = {
  'b4-stream': [
    { chunks: ['s1 ', 'streaming ', 'now '], chunkDelayMs: 30, hang: true },
    { chunks: ['after restart'] },
    { chunks: ['after restart'] },
  ],
  'b4-tool': [
    {
      toolCall: {
        name: 'bash',
        arguments: {
          command: SLEEP,
          description: 'gate foreground sleep',
          timeoutMs: 120_000,
        },
      },
    },
    { chunks: ['after tool'] },
  ],
}
const sleepers = async () =>
  (await processTable()).filter((row) => row.command.includes(SLEEP))
const lastSeq = (follow) =>
  Math.max(-1, ...follow.state.events.map((e) => e.seq))
const inboxOf = (projections) =>
  JSON.stringify(
    projections.values?.inbox ?? projections.values?.['agent/inbox'] ?? null,
  ).slice(0, 800)

const report = await runGate(
  'b4-restart-reconcile',
  {
    scripts,
    title: 'SIGKILL mid-stream and mid-tool, restart, read-only reconcile',
    hostSandbox: false,
  },
  async (ctx) => {
    let h = ctx.harness
    const s1 = await h.boundSession('b4-s1', 'research')
    const s2 = await h.boundSession('b4-s2', 'developer')
    const approvals = openApprovals(h.mux)
    await until(() => approvals.state.clientId, '$events ready')
    const f1 = await h.follow(s1.sessionId)
    const f2 = await h.follow(s2.sessionId)

    await h.prompt(s1.sessionId, '⟦gate:b4-stream⟧ stream until killed')
    const s1Stream = await ctx.stub.waitFor(
      (row) =>
        row.kind === 'agent' && row.scriptId === 'b4-stream' && row.hanging,
      'S1 mid-stream',
      20_000,
    )
    const queuedReceipt = await h.prompt(
      s1.sessionId,
      '⟦q:b4-queued⟧ queued while S1 runs',
    )
    await h.prompt(s2.sessionId, '⟦gate:b4-tool⟧ run the tool')
    const ask = await until(
      () => approvals.state.asked.find((item) => item.agentId === s2.sessionId),
      'S2 approval',
      20_000,
      10,
    )
    await h.transport.rpc('$events/result', {
      clientId: approvals.state.clientId,
      eventId: ask.eventId,
      outcome: { kind: 'result', value: 'allowed-once' },
    })
    const sleepBefore = await until(
      async () => {
        const rows = await sleepers()
        return rows.length ? rows : undefined
      },
      'S2 bash process',
      10_000,
      50,
    )
    await until(() => f1.state.chunks >= 3, 'S1 chunks visible', 5_000, 10)
    const preKill = {
      s1Seq: lastSeq(f1),
      s2Seq: lastSeq(f2),
      s1Inbox: inboxOf(await h.sessions.projections(s1.sessionId)),
      s2HasToolCall: f2.state.events.some((e) => e.type === 'tool/call'),
      s2HasToolResult: f2.state.events.some((e) => e.type === 'tool/result'),
      sleepPids: sleepBefore.map((row) => row.pid),
    }
    const requestsBeforeKill = ctx.stub.requests.length

    const oldPid = ctx.host.processId
    const killAt = Date.now()
    process.kill(oldPid, 'SIGKILL')
    await until(
      async () => !(await processTable()).some((row) => row.pid === oldPid),
      'Host gone',
      5_000,
      20,
    )
    await until(
      () => ctx.hostExits.length > 0,
      'supervisor failure report',
      5_000,
      20,
    ).catch(() => {})
    const supervisorSawExitMs = ctx.hostExits.length
      ? ctx.hostExits[0].at - (killAt - ctx.t0)
      : null
    const orphans = (await sleepers()).map((row) => ({
      pid: row.pid,
      ppid: row.ppid,
    }))
    await ctx.host.stop().catch(() => {})
    const restartAt = Date.now()
    h = await ctx.startHost()
    const restartMs = Date.now() - restartAt
    const requestsAtRestart = ctx.stub.requests.length

    const r1 = await readOnlyReconcile(h.transport, s1.sessionId)
    const r2 = await readOnlyReconcile(h.transport, s2.sessionId)
    await delay(5_000)
    const quietAgentRequests = ctx.stub.requests
      .slice(requestsAtRestart)
      .filter((row) => row.kind === 'agent').length
    const newSleepers = (await sleepers()).filter(
      (row) => !preKill.sleepPids.includes(row.pid),
    ).length
    const tail = (events, seq) =>
      events.filter((e) => e.seq > seq).map(eventSummary)
    const s1Tail = tail(r1.events, preKill.s1Seq)
    const s2Tail = tail(r2.events, preKill.s2Seq)
    const s2ToolResult = r2.events.find((e) => e.type === 'tool/result')

    // Cold follow after the read-only pass: does it activate the queued item?
    const cold = await h.follow(s1.sessionId)
    await delay(5_000)
    const coldRequests = ctx.stub.requests
      .slice(requestsAtRestart)
      .filter((row) => row.kind === 'agent')
    const afterCold = {
      agentRequests: coldRequests.length,
      queuedItemReachedModel: coldRequests.some((row) =>
        row.markers.includes('q:b4-queued'),
      ),
      newTurnStarts: cold.state.events.filter(
        (e) => e.type === 'turn/start' && e.seq > preKill.s1Seq,
      ).length,
      s1InboxAfterCold: inboxOf(await h.sessions.projections(s1.sessionId)),
    }
    for (const row of await sleepers()) process.kill(row.pid, 'SIGKILL')

    const facts = {
      preKill: { ...preKill, queuedReceipt },
      kill: {
        supervisorSawExitMs,
        oldUpstreamClosed: s1Stream.closedByClient,
        orphanedBashProcesses: orphans,
      },
      restart: { restartMs, newPid: ctx.host.processId !== oldPid },
      readOnly: {
        s1: {
          asOfSeq: r1.projections.asOfSeq,
          projectionKeys: Object.keys(r1.projections.values ?? {}),
          tail: s1Tail,
          inbox: inboxOf(r1.projections),
        },
        s2: {
          asOfSeq: r2.projections.asOfSeq,
          tail: s2Tail,
          toolResult: s2ToolResult
            ? {
                seq: s2ToolResult.seq,
                isError: eventSummary(s2ToolResult).isError,
                text: (s2ToolResult.data?.message?.content ?? [])
                  .map((part) => part.text ?? '')
                  .join('')
                  .slice(0, 300),
              }
            : null,
        },
        agentRequestsWithin5s: quietAgentRequests,
        replayedBashProcesses: newSleepers,
      },
      coldFollow: afterCold,
      requestsBeforeKill,
      resources: ctx.sampler.window(),
    }
    const synthetic = (t) => t.some((e) => e.type === 'turn/end')
    facts.expectations = {
      s1SyntheticTurnEnd: synthetic(s1Tail),
      s2SyntheticTurnEnd: synthetic(s2Tail),
      s2InFlightToolMarkedError: s2ToolResult
        ? eventSummary(s2ToolResult).isError === true
        : false,
      noModelReplayOnReadOnly: quietAgentRequests === 0,
      noBashReplay: newSleepers === 0,
      noTurnStartInReadOnlyTail: ![...s1Tail, ...s2Tail].some(
        (e) => e.type === 'turn/start',
      ),
    }
    facts.passed = Object.values(facts.expectations).every(Boolean)
    return facts
  },
)
process.exit(report.passed ? 0 : 1)
