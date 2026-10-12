import assert from 'node:assert/strict'
import { type TestContext, test } from 'node:test'
import type {
  ApprovalAnswer,
  WorkspaceResult,
} from '../../../packages/contracts/src/workspace.ts'
import type {
  ApprovalEventHandlers,
  ApprovalRequestView,
} from '../../../packages/dsh-adapter/src/approval-events.ts'
import { RemoteError } from '../../../packages/dsh-adapter/src/remote-error.ts'
import type { WireEvent } from '../../../packages/dsh-adapter/src/session-wire.ts'
import {
  APPROVAL_TIMEOUT_MS,
  ApprovalBroker,
  type ApprovalBrokerChange,
  type ApprovalCard,
  type ApprovalChannel,
  approvalFeedItem,
  RECONNECT_DELAY_MS,
  REDELIVERY_GRACE_MS,
} from '../src/workspace/approval-broker.ts'

const SESSION = 'corn-session-a'
const OTHER_SESSION = 'corn-session-b'
const FOREIGN_SESSION = 'not-corn'
const BOT = 'bot_a'
const OTHER_BOT = 'bot_b'

class FakeChannel implements ApprovalChannel {
  readonly answers: Array<{ eventId: string; value: ApprovalAnswer }> = []
  readonly delegated: string[] = []
  closed = false
  answerImpl: () => Promise<void> = () => Promise.resolve()
  readonly generation: number
  readonly handlers: ApprovalEventHandlers

  constructor(generation: number, handlers: ApprovalEventHandlers) {
    this.generation = generation
    this.handlers = handlers
  }

  answer(eventId: string, value: ApprovalAnswer): Promise<void> {
    this.answers.push({ eventId, value })
    return this.answerImpl()
  }

  delegate(eventId: string): Promise<void> {
    this.delegated.push(eventId)
    return Promise.resolve()
  }

  close(): void {
    this.closed = true
  }

  ready(): void {
    this.handlers.onReady(this.generation)
  }

  approval(eventId: string, extra: Partial<ApprovalRequestView> = {}): void {
    this.handlers.onApproval(
      { eventId, sessionId: SESSION, toolName: 'bash', ...extra },
      this.generation,
    )
  }

  cancel(eventId: string): void {
    this.handlers.onCancel(eventId, this.generation)
  }

  fail(): void {
    this.handlers.onError(new RemoteError('corn/disconnected', 'gone'))
  }
}

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const channels: FakeChannel[] = []
  const changes: ApprovalBrokerChange[] = []
  let generation = 100
  let openFails = false
  const broker = new ApprovalBroker({
    openEvents: (handlers) => {
      if (openFails) throw new Error('Host stream is not connected')
      const channel = new FakeChannel(++generation, handlers)
      channels.push(channel)
      return channel
    },
    botForSession: (sessionId) =>
      sessionId === SESSION
        ? BOT
        : sessionId === OTHER_SESSION
          ? OTHER_BOT
          : undefined,
    onChange: (change) => changes.push(change),
  })
  const latest = () => {
    const channel = channels.at(-1)
    assert.ok(channel, 'a channel is open')
    return channel
  }
  const card = (index = 0, sessionId = SESSION): ApprovalCard => {
    const found = broker.cards(sessionId)[index]
    assert.ok(found, `card ${index}`)
    return found
  }
  return {
    broker,
    channels,
    changes,
    latest,
    card,
    setOpenFails: (value: boolean) => {
      openFails = value
    },
    connectReady: () => {
      broker.connect()
      latest().ready()
      return latest()
    },
  }
}

let seq = 0
const event = (type: string, data: unknown, at = seq++): WireEvent => ({
  type,
  seq: at,
  time: 0,
  data,
  ignorable: false,
})
const turnStart = (turn: number) => event('turn/start', { turn })
const turnEnd = (turn: number) =>
  event('turn/end', { turn, reason: 'completed' })
const asked = (id: string, callId?: string) =>
  event('approval/asked', {
    id,
    toolName: 'bash',
    ...(callId === undefined ? {} : { callId }),
  })
const decided = (id: string, outcome: string) =>
  event('approval/decided', { id, outcome })

const okResult: WorkspaceResult<null> = { ok: true, value: null }
const failed = (code: string) => ({ ok: false, error: { code } })
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

test('a Corn request becomes a pending card with an opaque handle', (t) => {
  const { broker, connectReady, card } = setup(t)
  const channel = connectReady()
  channel.approval('evt-1', {
    callId: 'call-1',
    reason: 'run /tmp/x',
    displayReason: { en: 'Run a command', zh: '运行命令' },
  })
  const view = card()
  assert.equal(view.status, 'pending')
  assert.equal(view.botId, BOT)
  assert.match(view.handle, /^aph_/)
  assert.notEqual(view.handle, 'evt-1')
  assert.equal(view.timedOut, false)
  const item = approvalFeedItem(view)
  assert.deepEqual(item, {
    kind: 'approval',
    id: view.id,
    handle: view.handle,
    title: 'bash',
    detail: '运行命令',
    status: 'pending',
  })
  assert.doesNotMatch(JSON.stringify(item), /evt-1|call-1/)
  assert.equal(broker.cards(OTHER_SESSION).length, 0)
})

test('only the durable decision settles an answered card', async (t) => {
  const { broker, connectReady, card } = setup(t)
  const channel = connectReady()
  broker.observe(SESSION, [turnStart(1), asked('ask-1', 'call-1')])
  channel.approval('evt-1', { callId: 'call-1' })
  assert.equal(card().askedId, 'ask-1')
  const result = await broker.answer(BOT, card().handle, 'allowed-once')
  assert.deepEqual(result, okResult)
  assert.deepEqual(channel.answers, [
    { eventId: 'evt-1', value: 'allowed-once' },
  ])
  assert.equal(card().status, 'submitting')
  // The Gateway's post-settlement cancel frame is not a decision.
  channel.cancel('evt-1')
  assert.equal(card().status, 'submitting')
  broker.observe(SESSION, [decided('ask-1', 'allowed-once')])
  assert.equal(card().status, 'allowed-once')
  // A repeated identical click after the decision is a no-op.
  assert.deepEqual(
    await broker.answer(BOT, card().handle, 'allowed-once'),
    okResult,
  )
  assert.deepEqual(
    await broker.answer(BOT, card().handle, 'rejected'),
    failed('stale'),
  )
  assert.equal(channel.answers.length, 1)
})

test('a late reply that RPC accepted still ends cancelled when DSH says so', async (t) => {
  const { broker, connectReady, card } = setup(t)
  const channel = connectReady()
  broker.observe(SESSION, [turnStart(1), asked('ask-1', 'call-1')])
  channel.approval('evt-1', { callId: 'call-1' })
  assert.deepEqual(
    await broker.answer(BOT, card().handle, 'allowed-once'),
    okResult,
  )
  broker.observe(SESSION, [decided('ask-1', 'cancelled')])
  assert.equal(card().status, 'cancelled')
})

test('forged and cross-Bot handles are refused without any RPC', async (t) => {
  const { broker, connectReady, card } = setup(t)
  const channel = connectReady()
  channel.approval('evt-1')
  assert.deepEqual(
    await broker.answer(BOT, 'aph_forged', 'allowed-once'),
    failed('not_found'),
  )
  assert.deepEqual(
    await broker.answer(BOT, 'evt-1', 'allowed-once'),
    failed('not_found'),
  )
  assert.deepEqual(
    await broker.answer(OTHER_BOT, card().handle, 'allowed-once'),
    failed('not_found'),
  )
  assert.deepEqual(
    await broker.answer(BOT, card().handle, 'maybe' as ApprovalAnswer),
    failed('validation'),
  )
  assert.equal(channel.answers.length, 0)
  assert.equal(card().status, 'pending')
})

test('requests for non-Corn Sessions and unsupported waterfalls are delegated', (t) => {
  const { broker, connectReady, changes } = setup(t)
  const channel = connectReady()
  channel.approval('evt-foreign', { sessionId: FOREIGN_SESSION })
  channel.handlers.onUnsupported(
    { event: 'user-questions/request', eventId: 'evt-q', sessionId: SESSION },
    channel.generation,
  )
  channel.handlers.onUnsupported(
    {
      event: 'user-questions/request',
      eventId: 'evt-q2',
      sessionId: FOREIGN_SESSION,
    },
    channel.generation,
  )
  assert.deepEqual(channel.delegated, ['evt-foreign', 'evt-q', 'evt-q2'])
  assert.equal(broker.cards(FOREIGN_SESSION).length, 0)
  assert.equal(broker.cards(SESSION).length, 0)
  assert.deepEqual(
    changes.filter((change) => change.kind === 'notice'),
    [
      {
        kind: 'notice',
        sessionId: SESSION,
        notice: 'question-unsupported',
      },
    ],
  )
})

test('a double click sends one answer; a different answer is stale', async (t) => {
  const { broker, connectReady, card } = setup(t)
  const channel = connectReady()
  channel.approval('evt-1')
  let release = () => {}
  channel.answerImpl = () =>
    new Promise<void>((resolve) => {
      release = resolve
    })
  const handle = card().handle
  const first = broker.answer(BOT, handle, 'rejected')
  const second = await broker.answer(BOT, handle, 'rejected')
  const conflicting = await broker.answer(BOT, handle, 'allowed-once')
  release()
  assert.deepEqual(await first, okResult)
  assert.deepEqual(second, okResult)
  assert.deepEqual(conflicting, failed('stale'))
  assert.equal(channel.answers.length, 1)
})

test('a cancel frame closes an unanswered request', async (t) => {
  const { broker, connectReady, card } = setup(t)
  const channel = connectReady()
  channel.approval('evt-1')
  channel.cancel('evt-1')
  assert.equal(card().status, 'cancelled')
  assert.deepEqual(
    await broker.answer(BOT, card().handle, 'allowed-once'),
    failed('stale'),
  )
  assert.equal(channel.answers.length, 0)
})

test('an adapter stale refusal means the answer never counted', async (t) => {
  const { broker, connectReady, card } = setup(t)
  const channel = connectReady()
  channel.approval('evt-1')
  channel.answerImpl = () =>
    Promise.reject(new RemoteError('corn/event-stale', 'stale'))
  assert.deepEqual(
    await broker.answer(BOT, card().handle, 'allowed-once'),
    failed('stale'),
  )
  assert.equal(card().status, 'cancelled')
})

test('an uncertain send keeps the card submitting and a re-click retries it', async (t) => {
  const { broker, connectReady, card } = setup(t)
  const channel = connectReady()
  channel.approval('evt-1')
  channel.answerImpl = () =>
    Promise.reject(new RemoteError('corn/timeout', 'timeout'))
  const handle = card().handle
  assert.deepEqual(
    await broker.answer(BOT, handle, 'allowed-once'),
    failed('host_error'),
  )
  assert.equal(card().status, 'submitting')
  channel.answerImpl = () => Promise.resolve()
  assert.deepEqual(await broker.answer(BOT, handle, 'allowed-once'), okResult)
  assert.deepEqual(await broker.answer(BOT, handle, 'allowed-once'), okResult)
  assert.equal(channel.answers.length, 2)
})

test('a new generation retires old handles and re-derives the pending card', async (t) => {
  const { broker, connectReady, card, channels, latest } = setup(t)
  const first = connectReady()
  first.approval('evt-1')
  const before = card()
  first.fail()
  assert.equal(first.closed, true)
  assert.deepEqual(
    await broker.answer(BOT, before.handle, 'allowed-once'),
    failed('stale'),
  )
  t.mock.timers.tick(RECONNECT_DELAY_MS)
  assert.equal(channels.length, 2)
  const second = latest()
  second.ready()
  // Between `ready` and the redelivery the old handle is still stale.
  assert.deepEqual(
    await broker.answer(BOT, before.handle, 'allowed-once'),
    failed('stale'),
  )
  second.approval('evt-1')
  const after = card()
  assert.equal(after.id, before.id)
  assert.notEqual(after.handle, before.handle)
  assert.equal(after.status, 'pending')
  assert.deepEqual(
    await broker.answer(BOT, before.handle, 'allowed-once'),
    failed('stale'),
  )
  assert.deepEqual(await broker.answer(BOT, after.handle, 'rejected'), okResult)
  assert.equal(first.answers.length, 0)
  assert.deepEqual(second.answers, [{ eventId: 'evt-1', value: 'rejected' }])
})

test('an answer lost with its generation is re-sent once on redelivery', async (t) => {
  const { broker, connectReady, card, latest } = setup(t)
  const first = connectReady()
  first.approval('evt-1')
  first.answerImpl = () =>
    new Promise<void>((_, reject) => {
      queueMicrotask(() => {
        first.fail()
        reject(new RemoteError('corn/disconnected', 'gone'))
      })
    })
  assert.deepEqual(
    await broker.answer(BOT, card().handle, 'allowed-once'),
    okResult,
  )
  assert.equal(card().status, 'submitting')
  t.mock.timers.tick(RECONNECT_DELAY_MS)
  const second = latest()
  second.ready()
  second.approval('evt-1')
  await flush()
  assert.deepEqual(second.answers, [
    { eventId: 'evt-1', value: 'allowed-once' },
  ])
  assert.equal(card().status, 'submitting')
  // A second loss does not resend again; the user decides afresh.
  second.fail()
  t.mock.timers.tick(RECONNECT_DELAY_MS)
  const third = latest()
  third.ready()
  third.approval('evt-1')
  assert.equal(third.answers.length, 0)
  assert.equal(card().status, 'pending')
})

test('a request not redelivered after reconnect is closed after the grace', async (t) => {
  const { broker, connectReady, card, latest } = setup(t)
  const first = connectReady()
  first.approval('evt-1')
  first.fail()
  t.mock.timers.tick(RECONNECT_DELAY_MS)
  latest().ready()
  assert.equal(card().status, 'pending')
  t.mock.timers.tick(REDELIVERY_GRACE_MS)
  assert.equal(card().status, 'cancelled')
  latest().approval('evt-1')
  assert.deepEqual(
    await broker.answer(BOT, card().handle, 'allowed-once'),
    failed('stale'),
  )
})

test('the 30-minute timeout rejects exactly once', async (t) => {
  const { broker, connectReady, card, changes } = setup(t)
  const channel = connectReady()
  channel.approval('evt-1')
  t.mock.timers.tick(APPROVAL_TIMEOUT_MS - 1)
  assert.equal(channel.answers.length, 0)
  t.mock.timers.tick(1)
  assert.deepEqual(channel.answers, [{ eventId: 'evt-1', value: 'rejected' }])
  assert.equal(card().timedOut, true)
  assert.equal(card().status, 'submitting')
  t.mock.timers.tick(APPROVAL_TIMEOUT_MS * 2)
  assert.equal(channel.answers.length, 1)
  assert.deepEqual(
    await broker.answer(BOT, card().handle, 'allowed-once'),
    failed('stale'),
  )
  assert.deepEqual(
    await broker.answer(BOT, card().handle, 'rejected'),
    okResult,
  )
  assert.equal(channel.answers.length, 1)
  assert.equal(
    changes.filter(
      (change) =>
        change.kind === 'notice' && change.notice === 'approval-timed-out',
    ).length,
    1,
  )
})

test('the timeout leaves an answer the Host already took to the journal', async (t) => {
  const { broker, connectReady, card } = setup(t)
  const channel = connectReady()
  channel.approval('evt-1')
  assert.deepEqual(
    await broker.answer(BOT, card().handle, 'allowed-once'),
    okResult,
  )
  t.mock.timers.tick(APPROVAL_TIMEOUT_MS)
  assert.equal(channel.answers.length, 1)
  assert.equal(card().timedOut, false)
})

test('a timeout due while detached rejects the redelivery once', (t) => {
  const { connectReady, card, latest } = setup(t)
  const first = connectReady()
  first.approval('evt-1')
  first.fail()
  t.mock.timers.tick(APPROVAL_TIMEOUT_MS)
  const second = latest()
  second.ready()
  second.approval('evt-1')
  assert.deepEqual(second.answers, [{ eventId: 'evt-1', value: 'rejected' }])
  assert.equal(card().timedOut, true)
  t.mock.timers.tick(APPROVAL_TIMEOUT_MS)
  assert.equal(second.answers.length, 1)
})

test('stopping a turn makes its approvals stale and never answers them', async (t) => {
  const { broker, connectReady, card } = setup(t)
  const channel = connectReady()
  broker.observe(SESSION, [turnStart(1)])
  channel.approval('evt-1')
  broker.stopTurn(SESSION)
  assert.equal(card().status, 'cancelled')
  assert.deepEqual(
    await broker.answer(BOT, card().handle, 'allowed-once'),
    failed('stale'),
  )
  // A request of the stopped turn that races in is closed on arrival.
  channel.approval('evt-2')
  assert.equal(card(1).status, 'cancelled')
  t.mock.timers.tick(APPROVAL_TIMEOUT_MS)
  assert.equal(channel.answers.length, 0)
  const stoppedHandle = card().handle
  // A later turn/end, including one replayed with the next turn, does not lift the fence.
  broker.observe(SESSION, [turnEnd(1), turnStart(2)])
  channel.approval('evt-3')
  const raced = broker.cards(SESSION).at(-1)
  assert.ok(raced)
  assert.equal(
    broker.cards(SESSION).find((view) => view.status === 'pending'),
    undefined,
  )
  assert.deepEqual(
    await broker.answer(BOT, raced.handle, 'allowed-once'),
    failed('stale'),
  )
  assert.deepEqual(
    await broker.answer(BOT, raced.handle, 'rejected'),
    failed('stale'),
  )
  assert.equal(channel.answers.length, 0)
  // Explicit resume allows a new turn. Handles closed by the stop stay dead.
  broker.resumeSession(SESSION)
  channel.approval('evt-4')
  const fresh = broker.cards(SESSION).find((view) => view.status === 'pending')
  assert.ok(fresh)
  assert.deepEqual(await broker.answer(BOT, fresh.handle, 'rejected'), okResult)
  assert.deepEqual(
    await broker.answer(BOT, stoppedHandle, 'allowed-once'),
    failed('stale'),
  )
  assert.equal(channel.answers.length, 1)
})

test('resumeSession lifts the stop fence without a turn end', (t) => {
  const { broker, connectReady } = setup(t)
  const channel = connectReady()
  broker.stopTurn(SESSION)
  broker.resumeSession(SESSION)
  channel.approval('evt-1')
  assert.equal(broker.cards(SESSION)[0]?.status, 'pending')
})

test('a stop before the first snapshot keeps old turn ends from unlocking the current ask', async (t) => {
  const { broker, connectReady } = setup(t)
  const channel = connectReady()
  broker.stopTurn(SESSION)
  broker.observe(SESSION, [
    turnStart(1),
    turnEnd(1),
    turnStart(2),
    turnEnd(2),
    turnStart(3),
    asked('ask-now', 'call-now'),
  ])
  channel.approval('evt-now', { callId: 'call-now' })
  const view = broker.cards(SESSION).at(-1)
  assert.ok(view)
  assert.notEqual(view.status, 'pending')
  assert.deepEqual(
    await broker.answer(BOT, view.handle, 'allowed-once'),
    failed('stale'),
  )
  assert.deepEqual(
    await broker.answer(BOT, view.handle, 'rejected'),
    failed('stale'),
  )
  assert.equal(channel.answers.length, 0)
  assert.equal(channel.delegated.length, 0)
})

test('a live request is settled by the same snapshot that ends its turn', async (t) => {
  const { broker, connectReady } = setup(t)
  const channel = connectReady()
  channel.approval('evt-1', { callId: 'call-1' })
  const handle = broker.cards(SESSION)[0]?.handle
  assert.ok(handle)
  broker.observe(SESSION, [
    turnStart(1),
    asked('ask-1', 'call-1'),
    decided('ask-1', 'cancelled'),
    turnEnd(1),
  ])
  assert.equal(
    broker.cards(SESSION).find((view) => view.status === 'pending'),
    undefined,
  )
  assert.deepEqual(
    await broker.answer(BOT, handle, 'allowed-once'),
    failed('stale'),
  )
  assert.equal(channel.answers.length, 0)
})

test('an unmatched request cannot capture the next turn ask', (t) => {
  const { broker, connectReady, card } = setup(t)
  const channel = connectReady()
  broker.observe(SESSION, [turnStart(1)])
  channel.approval('evt-old')
  const stale = card().handle
  broker.observe(SESSION, [turnEnd(1), turnStart(2), asked('ask-new')])
  assert.notEqual(card().askedId, 'ask-new')
  channel.approval('evt-new')
  const fresh = broker.cards(SESSION).find((view) => view.askedId === 'ask-new')
  assert.ok(fresh)
  assert.notEqual(fresh.handle, stale)
  assert.equal(card().status, 'cancelled')
})

test('a new generation does not lift a stop', async (t) => {
  const { broker, connectReady, latest } = setup(t)
  const first = connectReady()
  broker.observe(SESSION, [turnStart(1)])
  first.approval('evt-1')
  broker.stopTurn(SESSION)
  first.fail()
  t.mock.timers.tick(RECONNECT_DELAY_MS)
  const second = latest()
  second.ready()
  broker.observe(SESSION, [turnEnd(1), turnStart(2)])
  second.approval('evt-2')
  const view = broker.cards(SESSION).at(-1)
  assert.ok(view)
  assert.deepEqual(
    await broker.answer(BOT, view.handle, 'allowed-once'),
    failed('stale'),
  )
  assert.equal(second.answers.length, 0)
})

test('requests of an ended turn are pruned and their handles go stale', async (t) => {
  const { broker, connectReady, card } = setup(t)
  const channel = connectReady()
  broker.observe(SESSION, [turnStart(1), asked('ask-1', 'call-1')])
  channel.approval('evt-1', { callId: 'call-1' })
  const handle = card().handle
  broker.observe(SESSION, [turnEnd(1)])
  assert.equal(broker.cards(SESSION).length, 0)
  assert.deepEqual(
    await broker.answer(BOT, handle, 'allowed-once'),
    failed('stale'),
  )
  assert.deepEqual(
    await broker.answer(OTHER_BOT, handle, 'allowed-once'),
    failed('not_found'),
  )
  assert.equal(channel.answers.length, 0)
})

test('without callId, requests match asks of the open turn in order', (t) => {
  const { broker, connectReady, card } = setup(t)
  const channel = connectReady()
  // A replayed window: an older turn's asks must never capture live requests.
  broker.observe(SESSION, [
    turnStart(1),
    asked('old-1'),
    decided('old-1', 'rejected'),
    asked('old-2'),
    turnEnd(1),
    turnStart(2),
    asked('ask-a'),
  ])
  channel.approval('evt-a')
  channel.approval('evt-b')
  assert.equal(card(0).askedId, 'ask-a')
  assert.equal(card(1).askedId, undefined)
  broker.observe(SESSION, [asked('ask-b')])
  assert.equal(card(1).askedId, 'ask-b')
  broker.observe(SESSION, [decided('ask-b', 'rejected')])
  assert.equal(card(0).status, 'pending')
  assert.equal(card(1).status, 'rejected')
})

test('callId matching tolerates out-of-order asks and overlapping windows', (t) => {
  const { broker, connectReady, card } = setup(t)
  const channel = connectReady()
  const start = turnStart(1)
  const askB = asked('ask-b', 'call-b')
  const askA = asked('ask-a', 'call-a')
  channel.approval('evt-a', { callId: 'call-a' })
  channel.approval('evt-b', { callId: 'call-b' })
  broker.observe(SESSION, [start, askB])
  broker.observe(SESSION, [start, askB, askA])
  assert.equal(card(0).askedId, 'ask-a')
  assert.equal(card(1).askedId, 'ask-b')
  // `unavailable` is DSH failing closed: shown as not answered.
  broker.observe(SESSION, [decided('ask-a', 'unavailable')])
  assert.equal(card(0).status, 'cancelled')
})

test('a request decided before its waterfall arrives settles on arrival', async (t) => {
  const { broker, connectReady, card } = setup(t)
  const channel = connectReady()
  broker.observe(SESSION, [
    turnStart(1),
    asked('ask-1', 'call-1'),
    decided('ask-1', 'cancelled'),
  ])
  channel.approval('evt-1', { callId: 'call-1' })
  assert.equal(card().status, 'cancelled')
  assert.deepEqual(
    await broker.answer(BOT, card().handle, 'allowed-once'),
    failed('stale'),
  )
})

test('disconnect closes everything and stops reconnecting', async (t) => {
  const { broker, connectReady, card, channels } = setup(t)
  const channel = connectReady()
  channel.approval('evt-1')
  broker.disconnect()
  assert.equal(channel.closed, true)
  assert.equal(card().status, 'cancelled')
  assert.deepEqual(
    await broker.answer(BOT, card().handle, 'allowed-once'),
    failed('stale'),
  )
  t.mock.timers.tick(RECONNECT_DELAY_MS * 10)
  assert.equal(channels.length, 1)
})

test('a failed open is retried until the stream comes up', (t) => {
  const { broker, channels, setOpenFails } = setup(t)
  setOpenFails(true)
  broker.connect()
  assert.equal(channels.length, 0)
  t.mock.timers.tick(RECONNECT_DELAY_MS)
  assert.equal(channels.length, 0)
  setOpenFails(false)
  t.mock.timers.tick(RECONNECT_DELAY_MS)
  assert.equal(channels.length, 1)
  broker.connect()
  assert.equal(channels.length, 1)
})

test('frames of a replaced generation are ignored', (t) => {
  const { broker, connectReady, latest } = setup(t)
  const first = connectReady()
  broker.disconnect()
  broker.connect()
  latest().ready()
  first.approval('evt-old')
  first.ready()
  assert.equal(broker.cards(SESSION).length, 0)
  assert.equal(first.delegated.length, 0)
})

test('forgetSession drops cards and refuses their handles', async (t) => {
  const { broker, connectReady, card } = setup(t)
  const channel = connectReady()
  channel.approval('evt-1')
  const handle = card().handle
  broker.forgetSession(SESSION)
  assert.equal(broker.cards(SESSION).length, 0)
  assert.deepEqual(
    await broker.answer(BOT, handle, 'allowed-once'),
    failed('stale'),
  )
  assert.equal(channel.answers.length, 0)
})
