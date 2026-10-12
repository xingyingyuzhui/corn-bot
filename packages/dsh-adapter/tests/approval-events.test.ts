import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  APPROVAL_REASON_MAX_CODE_POINTS,
  ApprovalEvents,
  type ApprovalRequestView,
  parseEventsFrame,
  type UnsupportedWaterfall,
} from '../src/approval-events.ts'
import { HostStreamMux, type HostTransport } from '../src/transport.ts'
import { fakeSocket } from './helpers/fake-socket.ts'

const READY = {
  type: 'ready',
  clientId: 'client-secret-1',
  host: { home: '/Users/x' },
}

const waterfall = (
  eventId: string,
  request: Record<string, unknown>,
  event = 'approval/request',
) => ({
  type: 'waterfall',
  event,
  eventId,
  agentId: 'corn-session',
  request,
})

function harness() {
  const { socket, sent, deliver, fail } = fakeSocket()
  const mux = new HostStreamMux(socket)
  const calls: Array<[string, Record<string, unknown>]> = []
  let rpcFailure: Error | undefined
  const transport = {
    async rpc(endpoint: string, args: Record<string, unknown>) {
      calls.push([endpoint, args])
      if (rpcFailure) throw rpcFailure
      return undefined
    },
  } as unknown as HostTransport
  const seen = {
    ready: [] as number[],
    approvals: [] as ApprovalRequestView[],
    unsupported: [] as UnsupportedWaterfall[],
    cancels: [] as string[],
    errors: [] as Error[],
  }
  const events = ApprovalEvents.open(mux, transport, {
    onReady: (generation) => seen.ready.push(generation),
    onApproval: (request) => seen.approvals.push(request),
    onUnsupported: (value) => seen.unsupported.push(value),
    onCancel: (eventId) => seen.cancels.push(eventId),
    onError: (error) => seen.errors.push(error),
  })
  const open = sent[0]
  assert.ok(open)
  const streamId = String(open.streamId)
  return {
    events,
    sent,
    open,
    calls,
    seen,
    push: (value: unknown) => deliver(streamId, value),
    fail: (code: string) => fail(streamId, code),
    failRpc: (error: Error | undefined) => {
      rpcFailure = error
    },
  }
}

test('$events opens with empty args; approvals are answered with the generation clientId and closed outcomes', async () => {
  const h = harness()
  assert.equal(h.open.endpoint, '$events')
  assert.deepEqual(h.open.payload, { args: {} })
  await assert.rejects(h.events.answer('e1', 'allowed-once'), /not ready/u)
  h.push(READY)
  assert.equal(h.events.ready, true)
  assert.deepEqual(h.seen.ready, [h.events.generation])
  h.push(
    waterfall('e1', {
      toolName: 'bash',
      callId: 'call-1',
      reason: 'run true',
      displayReason: { en: 'Run it?', zh: '运行吗？', fr: 'Exécuter ?' },
    }),
  )
  assert.deepEqual(h.seen.approvals, [
    {
      eventId: 'e1',
      sessionId: 'corn-session',
      toolName: 'bash',
      callId: 'call-1',
      reason: 'run true',
      displayReason: { en: 'Run it?', zh: '运行吗？' },
    },
  ])
  await h.events.answer('e1', 'allowed-once')
  assert.deepEqual(h.calls, [
    [
      '$events/result',
      {
        clientId: 'client-secret-1',
        eventId: 'e1',
        outcome: { kind: 'result', value: 'allowed-once' },
      },
    ],
  ])
  await assert.rejects(h.events.answer('e1', 'rejected'), /not pending/u)
  h.push(waterfall('e2', { toolName: 'bash' }))
  await assert.rejects(
    h.events.answer('e2', 'always' as 'rejected'),
    /Invalid approval answer/u,
  )
  await h.events.answer('e2', 'rejected')
  assert.deepEqual(h.calls.at(-1)?.[1].outcome, {
    kind: 'result',
    value: 'rejected',
  })
  assert.equal(h.calls.length, 2)
})

test('a failed result RPC keeps the event answerable; cancel withdraws it', async () => {
  const h = harness()
  h.push(READY)
  h.push(waterfall('e1', { toolName: 'bash' }))
  h.failRpc(new Error('offline'))
  await assert.rejects(h.events.answer('e1', 'rejected'), /offline/u)
  h.failRpc(undefined)
  h.push({ type: 'cancel', eventId: 'e1' })
  assert.deepEqual(h.seen.cancels, ['e1'])
  await assert.rejects(h.events.answer('e1', 'rejected'), /not pending/u)
  await assert.rejects(h.events.delegate('never-seen'), /not pending/u)
})

test('unsupported waterfalls and unreadable approval requests are delegated with next', async () => {
  const h = harness()
  h.push(READY)
  h.push(waterfall('q1', { questions: [] }, 'user-questions/request'))
  h.push(waterfall('a1', { reason: 'no tool name' }))
  h.push(waterfall('a2', { toolName: 'bash', displayReason: { zh: '缺 en' } }))
  h.push(waterfall('a3', { toolName: 'bash', callId: 7 }))
  assert.deepEqual(
    h.seen.unsupported.map((item) => [
      item.event,
      item.eventId,
      item.sessionId,
    ]),
    [
      ['user-questions/request', 'q1', 'corn-session'],
      ['approval/request', 'a1', 'corn-session'],
      ['approval/request', 'a2', 'corn-session'],
      ['approval/request', 'a3', 'corn-session'],
    ],
  )
  assert.deepEqual(h.seen.approvals, [])
  await h.events.delegate('q1')
  assert.deepEqual(h.calls, [
    [
      '$events/result',
      { clientId: 'client-secret-1', eventId: 'q1', outcome: { kind: 'next' } },
    ],
  ])
})

test('reason and displayReason are truncated by code points', () => {
  const long = '路'.repeat(APPROVAL_REASON_MAX_CODE_POINTS + 10)
  const frame = parseEventsFrame(
    waterfall('e1', {
      toolName: 'bash',
      reason: long,
      displayReason: { en: long, zh: long },
    }),
  )
  assert.equal(frame.type, 'approval')
  if (frame.type !== 'approval') return
  const reason = frame.request.reason ?? ''
  assert.equal([...reason].length, APPROVAL_REASON_MAX_CODE_POINTS + 1)
  assert.ok(reason.endsWith('…'))
  assert.equal(frame.request.displayReason?.en, reason)
  assert.equal(frame.request.displayReason?.zh, reason)
})

test('$events frames are validated like the official client', () => {
  const bad: unknown[] = [
    { type: 'ready', clientId: '', host: { home: '/' } },
    { type: 'ready', clientId: 'c', host: {} },
    { type: 'ready', clientId: 'c', host: { home: '/' }, extra: 1 },
    { type: 'cancel', eventId: '' },
    { type: 'cancel', eventId: 'e', reason: 'x' },
    { type: 'emit', event: 'x', args: {} },
    { ...waterfall('e', { toolName: 'bash' }), agentId: '' },
    { ...waterfall('e', { toolName: 'bash' }), extra: true },
    waterfall('e', { toolName: 'bash', agent: {} }),
    waterfall('e', { toolName: 'bash', signal: {} }),
    {
      type: 'waterfall',
      event: 'approval/request',
      eventId: 'e',
      agentId: 'a',
      request: [],
    },
    { type: 'notify' },
    null,
  ]
  for (const frame of bad)
    assert.throws(
      () => parseEventsFrame(frame),
      (error: Error & { code?: string }) =>
        error.code === 'corn/invalid-response',
      JSON.stringify(frame),
    )
  assert.deepEqual(
    parseEventsFrame({
      type: 'emit',
      event: 'api-session/status',
      args: ['s', true],
    }),
    {
      type: 'emit',
      event: 'api-session/status',
    },
  )
})

test('protocol errors close the generation without exposing the clientId', async () => {
  const h = harness()
  h.push(waterfall('e1', { toolName: 'bash' }))
  assert.equal(h.seen.errors.length, 1)
  assert.equal(h.events.closed, true)
  assert.deepEqual(h.sent.at(-1), { type: 'cancel', streamId: h.open.streamId })

  const again = harness()
  again.push(READY)
  again.push(READY)
  assert.equal(again.events.closed, true)
  assert.doesNotMatch(String(again.seen.errors[0]?.message), /client-secret/u)
  await assert.rejects(again.events.answer('e1', 'rejected'), /not ready/u)

  const failed = harness()
  failed.push(READY)
  failed.push(waterfall('e1', { toolName: 'bash' }))
  failed.fail('gateway/service-unavailable')
  assert.equal(failed.events.ready, false)
  await assert.rejects(failed.events.answer('e1', 'rejected'), /not ready/u)
  assert.deepEqual(failed.calls, [])
})

test('each $events stream is its own generation', () => {
  const one = harness()
  const two = harness()
  assert.notEqual(one.events.generation, two.events.generation)
})
