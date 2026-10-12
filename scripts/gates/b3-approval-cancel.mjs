import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { eventSummary, openApprovals, until } from './lib/gate-env.mjs'
import { runGate } from './lib/gate-session.mjs'

// Run: node scripts/gates/run.mjs scripts/gates/b3-approval-cancel.mjs -- --host-unsandboxed
// ADR-0007 §5.2 scenario 5 (DSH gate B3): a bash call waits on approval, the
// Session is cancelled without answering, then a late `allowed-once` arrives
// for the withdrawn request. The command writes a sentinel inside the
// disposable workspace, so "never ran" is checked on disk, not only in events.
// `--host-unsandboxed` lets the command actually run if it were (wrongly)
// released; under the gate sandbox DSH's own bash Seatbelt cannot nest.
const SENTINEL = 'b3-sentinel.txt'
const scripts = {
  b3: [
    {
      toolCall: {
        name: 'bash',
        arguments: {
          command: `printf gate > ${SENTINEL}`,
          description: 'gate sentinel write',
        },
      },
    },
    { chunks: ['continued after the tool'] },
  ],
}
const hostSandbox = !process.argv.includes('--host-unsandboxed')
const report = await runGate(
  hostSandbox ? 'b3-approval-cancel' : 'b3-approval-cancel-host-unsandboxed',
  {
    scripts,
    title: 'Pending approval, Session cancel, late allowed-once',
    hostSandbox,
  },
  async (ctx) => {
    const h = ctx.harness
    const session = await h.boundSession('b3', 'developer')
    const sentinel = join(session.agent.canonicalRoot, SENTINEL)
    const approvals = openApprovals(h.mux)
    await until(() => approvals.state.clientId, '$events ready')
    const follow = await h.follow(session.sessionId)
    const seen = (type) => follow.state.events.find((e) => e.type === type)

    await h.prompt(session.sessionId, '⟦gate:b3⟧ write the sentinel')
    const ask = await until(
      () =>
        approvals.state.asked.find(
          (item) => item.agentId === session.sessionId,
        ),
      'approval request',
      20_000,
      10,
    )
    await until(() => seen('approval/asked'), 'approval/asked event', 5_000, 10)
    const requestsAtCancel = ctx.stub.requests.length

    const cancelAt = Date.now()
    const receipt = await h.sessions.cancel(session.sessionId)
    await until(() => seen('turn/end'), 'turn end after cancel', 15_000, 5)
    const turnEndMs = Date.now() - cancelAt
    await until(
      () => seen('approval/decided'),
      'approval/decided',
      5_000,
      5,
    ).catch(() => {})
    const decidedMs = seen('approval/decided') ? Date.now() - cancelAt : null
    await until(
      () => approvals.state.withdrawn.has(ask.eventId),
      '$events cancel frame',
      5_000,
      5,
    ).catch(() => {})
    const withdrawnMs = approvals.state.withdrawn.has(ask.eventId)
      ? Date.now() - cancelAt
      : null

    let late
    try {
      late = {
        ok: true,
        value: await h.transport.rpc('$events/result', {
          clientId: approvals.state.clientId,
          eventId: ask.eventId,
          outcome: { kind: 'result', value: 'allowed-once' },
        }),
      }
    } catch (caught) {
      late = {
        ok: false,
        error: `${caught.name}: ${caught.message}`.slice(0, 300),
        code: caught.code ?? null,
      }
    }
    await delay(2_000)

    const end = eventSummary(seen('turn/end'))
    const decided = seen('approval/decided')
    const toolResult = follow.state.events.find((e) => e.type === 'tool/result')
    const facts = {
      approval: { toolName: ask.request?.toolName ?? null },
      cancel: { receipt, turnEndMs, decidedMs, withdrawnMs },
      turnEnd: end,
      decided: decided
        ? {
            outcome: decided.data?.outcome ?? null,
            sameId: decided.data?.id === seen('approval/asked').data?.id,
          }
        : null,
      toolResult: toolResult
        ? {
            isError: eventSummary(toolResult).isError ?? null,
            text: (toolResult.data?.message?.content ?? [])
              .map((part) => part.text ?? '')
              .join('')
              .slice(0, 300),
          }
        : null,
      lateAllowedOnce: late,
      afterLate: {
        sentinelExists: existsSync(sentinel),
        stubRequestsAfterCancel: ctx.stub.requests.length - requestsAtCancel,
        eventsAfterTurnEnd: follow.state.events
          .filter((e) => e.seq > end.seq)
          .map(eventSummary),
      },
      resources: ctx.sampler.window(),
    }
    facts.passed =
      end.reason?.kind === 'aborted' &&
      Boolean(decided) &&
      JSON.stringify(decided.data?.outcome ?? '').includes('cancel') &&
      !facts.afterLate.sentinelExists &&
      facts.afterLate.stubRequestsAfterCancel === 0 &&
      facts.afterLate.eventsAfterTurnEnd.length === 0
    return facts
  },
)
process.exit(report.passed ? 0 : 1)
