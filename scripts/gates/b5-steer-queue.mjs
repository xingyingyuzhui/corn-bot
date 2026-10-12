import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { record } from '../../packages/dsh-adapter/src/remote-error.ts'
import { eventSummary, until } from './lib/gate-env.mjs'
import { runGate } from './lib/gate-session.mjs'

// Run: node scripts/gates/run.mjs scripts/gates/b5-steer-queue.mjs
// ADR-0007 §5.2 scenario 3 (DSH gate B5): three quick revisions while a Turn
// streams — steer, steer, then a queued prompt that is edited and promoted
// with `session/updateQueue`. Step 0 streams slowly and ends in a read-only
// tool call so a step boundary exists; the model's next request shows which
// revisions were claimed, in which order.
const scripts = {
  b5: [
    {
      chunks: Array(20).fill('working '),
      chunkDelayMs: 150,
      toolCall: { name: 'read', arguments: { path: 'b5-missing.txt' } },
    },
    { chunks: ['revised answer'] },
  ],
}
const MARKER = /⟦(\w+):([\w-]+)⟧/g
const textOf = (message) =>
  (message?.content ?? []).map((part) => part?.text ?? '').join('')
const markersOf = (text) =>
  [...text.matchAll(MARKER)].map((m) => `${m[1]}:${m[2]}`)

const report = await runGate(
  'b5-steer-queue',
  { scripts, title: 'steer / updateQueue revisions during a running Turn' },
  async (ctx) => {
    const h = ctx.harness
    const { sessionId } = await h.boundSession('b5', 'research')
    const follow = await h.follow(sessionId)
    const send = async (mode, text) => {
      const requestId = randomUUID()
      const at = Date.now()
      const receipt = record(
        await h.sessions.prompt({
          sessionId,
          requestId,
          mode,
          content: [{ type: 'text', text }],
          clientTimeZone: 'Asia/Shanghai',
        }),
      )
      return {
        mode,
        marker: markersOf(text)[0],
        requestId,
        receipt,
        ms: Date.now() - at,
      }
    }
    const tryRpc = async (label, call) => {
      try {
        return { label, ok: true, value: await call() }
      } catch (caught) {
        return {
          label,
          ok: false,
          error: `${caught.name}: ${caught.message}`.slice(0, 300),
        }
      }
    }

    await h.prompt(sessionId, '⟦gate:b5⟧ start a long answer')
    await until(() => follow.state.chunks >= 3, 'step 0 streaming', 20_000, 10)
    const revisions = []
    revisions.push(await send('steer', '⟦rev:1⟧ first steer'))
    revisions.push(await send('steer', '⟦rev:2⟧ second steer'))
    const queued = await send('queue', '⟦rev:3⟧ queued third')
    revisions.push(queued)
    const inboxBefore =
      record(await h.sessions.projections(sessionId)).values?.inbox ?? null
    const item = [
      ...(inboxBefore?.['next-turn'] ?? []),
      ...(inboxBefore?.['next-step'] ?? []),
    ].find((row) => row?.source?.rpcId === queued.requestId)
    const queueOps = []
    if (item) {
      queueOps.push(
        await tryRpc('edit', () =>
          h.sessions.updateQueue({
            sessionId,
            itemId: item.id,
            action: {
              kind: 'edit',
              content: [{ type: 'text', text: '⟦rev:3e⟧ edited third' }],
            },
          }),
        ),
      )
      queueOps.push(
        await tryRpc('steer', () =>
          h.sessions.updateQueue({
            sessionId,
            itemId: item.id,
            action: { kind: 'steer' },
          }),
        ),
      )
    }
    const inboxAfterOps =
      record(await h.sessions.projections(sessionId)).values?.inbox ?? null
    const step0 = ctx.stub.requests.find(
      (row) => row.kind === 'agent' && row.step === 0,
    )
    const revisionsDoneWhileStep0Streaming = step0.hanging || !step0.completed

    await until(
      () => follow.state.events.some((e) => e.type === 'turn/end'),
      'turn end',
      30_000,
      20,
    )
    await delay(1_500)
    const agentRequests = ctx.stub.requests.filter(
      (row) => row.kind === 'agent',
    )
    const events = follow.state.events
    const userMessages = events
      .filter((e) => e.type === 'user/message')
      .map((e) => ({
        seq: e.seq,
        markers: markersOf(textOf(e.data?.message ?? e.data)),
      }))
    const spliced = events
      .filter((e) => e.type === 'agent/inbox/spliced')
      .map((e) => ({ seq: e.seq, data: JSON.stringify(e.data).slice(0, 300) }))
    const turnEnds = events
      .filter((e) => e.type === 'turn/end')
      .map(eventSummary)
    const turnStarts = events
      .filter((e) => e.type === 'turn/start')
      .map(eventSummary)

    const facts = {
      revisions: revisions.map(({ requestId, ...rest }) => rest),
      queueItemFound: Boolean(item),
      queueOps,
      inboxBefore: JSON.stringify(inboxBefore).slice(0, 600),
      inboxAfterOps: JSON.stringify(inboxAfterOps).slice(0, 600),
      revisionsDoneWhileStep0Streaming,
      modelRequests: agentRequests.map((row) => ({
        step: row.step,
        markers: row.markers,
        toolResults: row.toolResults,
        completed: row.completed,
      })),
      userMessages,
      spliced,
      turnStarts,
      turnEnds,
      resources: ctx.sampler.window(),
    }
    const step1 = agentRequests.find(
      (row) => row.step === 1 && row.toolResults > 0,
    )
    const order = step1 ? step1.markers.filter((m) => m.startsWith('rev:')) : []
    facts.claimedAtStep1 = order
    facts.expectations = {
      revisionsDuringStep0: revisionsDoneWhileStep0Streaming,
      steersClaimedAtNextStep:
        order.includes('rev:1') && order.includes('rev:2'),
      steerOrderPreserved: order.indexOf('rev:1') < order.indexOf('rev:2'),
      editedQueueItemPromoted:
        order.includes('rev:3e') && !order.includes('rev:3'),
      originalQueueTextNeverSent: !agentRequests.some((row) =>
        row.markers.includes('rev:3'),
      ),
      singleTurn: turnStarts.length === 1 && turnEnds.length === 1,
      completed: turnEnds[0]?.reason?.kind === 'completed',
    }
    facts.passed = Object.values(facts.expectations).every(Boolean)
    return facts
  },
)
process.exit(report.passed ? 0 : 1)
