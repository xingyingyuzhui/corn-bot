import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  ConversationView,
  FeedItem,
} from '../../../packages/contracts/src/workspace.ts'
import type { SessionPage } from '../../../packages/dsh-adapter/src/session-client.ts'
import type { FollowHandlers } from '../../../packages/dsh-adapter/src/session-follower.ts'
import {
  type AssistantStreamFrame,
  type FollowSnapshot,
  parseFollowFrame,
  type WireEvent,
} from '../../../packages/dsh-adapter/src/session-wire.ts'
import { ConversationFollow } from '../src/workspace/conversation-follow.ts'
import {
  type ApprovalOverlay,
  NOTICE_TEXT,
  opaqueItemIds,
} from '../src/workspace/conversation-items.ts'
import {
  type AdmissionObservation,
  ConversationProjector,
  type ConversationProjectorOptions,
  type EarlierPageRequest,
  type ProjectionUpdate,
} from '../src/workspace/conversation-projector.ts'

// ---------------------------------------------------------------------------
// Wire fixtures (dsh-v0.2.0-rc.2 shapes, fake text only), parsed by the adapter
// ---------------------------------------------------------------------------

const HEADER = {
  version: 1,
  id: 'corn-session',
  createdAt: 1,
  cwd: '/claw/bot',
  isSeeded: false,
  agentPreset: 'wa-bot',
}

type RawEvent = Record<string, unknown>

const raw = (
  seq: number,
  type: string,
  data: unknown,
  extra: Record<string, unknown> = {},
): RawEvent => ({ type, seq, time: 1000 + seq, data, ...extra })

const parseEvent = (event: RawEvent): WireEvent => {
  const frame = parseFollowFrame({ type: 'event', event })
  assert.equal(frame.type, 'event')
  return frame.event
}

const userMessage = (seq: number, text: string, rpcId?: string): RawEvent =>
  raw(
    seq,
    'user/message',
    {
      id: `msg-${seq}`,
      role: 'user',
      content: [{ type: 'text', text }],
      source: rpcId === undefined ? { kind: 'user' } : { kind: 'user', rpcId },
    },
    { surfaceOp: 'append' },
  )

const assistantMessage = (
  seq: number,
  text: string,
  turn = 1,
  step = 0,
  extra: Record<string, unknown> = {},
): RawEvent =>
  raw(
    seq,
    'assistant/message',
    {
      turn,
      step,
      message: {
        id: `msg-${seq}`,
        role: 'assistant',
        content: text.length > 0 ? [{ type: 'text', text }] : [],
        source: { kind: 'model', provider: 'fake', model: 'corn-gate-model' },
      },
      stream: [],
      ...extra,
    },
    { surfaceOp: 'append' },
  )

const turnStart = (seq: number, turn = 1) => raw(seq, 'turn/start', { turn })
const stepStart = (seq: number, turn = 1, step = 0) =>
  raw(seq, 'step/start', { turn, step })
const turnEnd = (seq: number, kind: string, turn = 1) =>
  raw(seq, 'turn/end', { turn, reason: { kind } })

function snapshot(
  records: readonly RawEvent[],
  options: {
    cursor?: number
    hasMore?: boolean
    activeAttempt?: Record<string, unknown>
  } = {},
): FollowSnapshot {
  const cursor =
    options.cursor ?? (records.at(-1)?.seq as number | undefined) ?? -1
  const frame = parseFollowFrame({
    type: 'snapshot',
    header: HEADER,
    cursor,
    records: records.map((event) => ({ type: 'event', event })),
    hasMore: options.hasMore ?? false,
    projections: { asOfSeq: cursor, values: { inbox: [] } },
    assistantStream:
      options.activeAttempt === undefined
        ? { revision: 1 }
        : { revision: 1, activeAttempt: options.activeAttempt },
  })
  assert.equal(frame.type, 'snapshot')
  return frame
}

const streamFrame = (frame: Record<string, unknown>): AssistantStreamFrame => {
  const parsed = parseFollowFrame({ type: 'assistant-stream', frame })
  assert.equal(parsed.type, 'assistant-stream')
  return parsed.frame
}

const start = (
  attemptId: string,
  startedAfterSeq: number,
  turn = 1,
  step = 0,
) =>
  streamFrame({
    type: 'start',
    attemptId,
    revision: 1,
    startedAfterSeq,
    turn,
    step,
  })

const chunk = (
  attemptId: string,
  index: number,
  value: Record<string, unknown>,
) =>
  streamFrame({
    type: 'chunk',
    attemptId,
    revision: 1,
    index,
    time: 5000 + index,
    chunk: value,
  })

const committed = (
  attemptId: string,
  index: number,
  seq: number,
  eventType = 'assistant/message',
) =>
  streamFrame({
    type: 'end',
    attemptId,
    revision: 1,
    index,
    outcome: { kind: 'committed', eventType, seq },
  })

const abandoned = (attemptId: string, index: number) =>
  streamFrame({
    type: 'end',
    attemptId,
    revision: 1,
    index,
    outcome: { kind: 'abandoned' },
  })

const textDelta = (text: string, index = 0) => ({
  type: 'text-delta',
  index,
  text,
})

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function projector(overrides: Partial<ConversationProjectorOptions> = {}) {
  const observed: AdmissionObservation[] = []
  const instance = new ConversationProjector({
    botId: 'bot_1',
    mintId: opaqueItemIds('conv_1'),
    onAdmissionObserved: (value) => observed.push(value),
    ...overrides,
  })
  return { projector: instance, observed }
}

type MessageItem = Extract<FeedItem, { kind: 'message' }>
type NoticeItem = Extract<FeedItem, { kind: 'notice' }>

const messages = (view: ConversationView): MessageItem[] =>
  view.items.filter((item): item is MessageItem => item.kind === 'message')
const notices = (view: ConversationView): NoticeItem[] =>
  view.items.filter((item): item is NoticeItem => item.kind === 'notice')
const texts = (view: ConversationView) =>
  messages(view).map((item) => ({
    author: item.author,
    text: item.paragraphs.join('\n\n'),
    ...(item.streaming ? { streaming: true } : {}),
  }))
const ids = (view: ConversationView) => view.items.map((item) => item.id)

const viewOf = (update: ProjectionUpdate): ConversationView => {
  assert.ok(update.view, 'expected a changed view')
  return update.view
}

const BASE = [
  turnStart(0),
  stepStart(1),
  userMessage(2, 'hello bot', 'req-1'),
  assistantMessage(3, 'hello human'),
  raw(4, 'step/end', { turn: 1, step: 0 }),
  turnEnd(5, 'completed'),
]

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

test('starts loading with an empty live view', () => {
  const { projector: p } = projector()
  assert.deepEqual(p.view(), {
    botId: 'bot_1',
    state: 'loading',
    readOnly: false,
    items: [],
    hasEarlier: false,
  })
})

test('snapshot only: durable messages, silent events skipped, opaque ids', () => {
  const { projector: p, observed } = projector()
  const view = viewOf(p.snapshot(snapshot(BASE, { hasMore: true })))
  assert.equal(view.state, 'ready')
  assert.equal(view.hasEarlier, true)
  assert.deepEqual(texts(view), [
    { author: 'user', text: 'hello bot' },
    { author: 'bot', text: 'hello human' },
  ])
  assert.equal(view.items.length, 2)
  for (const id of ids(view)) {
    assert.match(id, /^i_[0-9a-f]{32}$/u)
    assert.ok(!id.includes('req-1'))
  }
  assert.deepEqual(observed, [{ requestId: 'req-1', seq: 2 }])
  assert.equal(p.cursor, 5)
})

test('paragraphs split on blank lines like the Renderer', () => {
  const { projector: p } = projector()
  const view = viewOf(
    p.snapshot(snapshot([userMessage(0, 'one\n\ntwo\nlines\n\n\nthree')])),
  )
  assert.deepEqual(messages(view)[0]?.paragraphs, [
    'one',
    'two\nlines',
    'three',
  ])
})

test('injected context and non-text user messages never become bubbles', () => {
  const { projector: p } = projector()
  const injected = raw(
    0,
    'user/message',
    {
      id: 'm0',
      role: 'user',
      content: [{ type: 'text', text: 'AGENTS.md contents' }],
      source: { kind: 'skill' },
    },
    { surfaceOp: 'append' },
  )
  const empty = raw(
    1,
    'user/message',
    {
      id: 'm1',
      role: 'user',
      content: [{ type: 'image', attachment: {} }],
      source: { kind: 'user' },
    },
    { surfaceOp: 'append' },
  )
  const view = viewOf(p.snapshot(snapshot([injected, empty])))
  assert.deepEqual(view.items, [])
  assert.equal(view.state, 'ready')
})

// ---------------------------------------------------------------------------
// Live stream → durable
// ---------------------------------------------------------------------------

test('live stream then durable settlement shows exactly one reply', () => {
  const { projector: p } = projector()
  p.snapshot(snapshot([userMessage(0, 'hi', 'req-1')]))
  p.event(parseEvent(turnStart(1)))
  p.event(parseEvent(stepStart(2)))
  assert.deepEqual(p.assistantStream(start('att-1', 2)), {})
  assert.deepEqual(
    p.assistantStream(
      chunk('att-1', 0, { type: 'block-start', index: 0, blockType: 'text' }),
    ),
    {},
  )
  let view = viewOf(p.assistantStream(chunk('att-1', 1, textDelta('Hel'))))
  assert.deepEqual(texts(view).at(-1), {
    author: 'bot',
    text: 'Hel',
    streaming: true,
  })
  const streamId = view.items.at(-1)?.id
  view = viewOf(p.assistantStream(chunk('att-1', 2, textDelta('lo'))))
  assert.equal(view.items.at(-1)?.id, streamId, 'bubble id is stable')
  assert.deepEqual(
    p.assistantStream(
      chunk('att-1', 3, { type: 'reasoning-delta', index: 1, text: 'hmm' }),
    ),
    {},
    'reasoning is not shown',
  )
  p.assistantStream(chunk('att-1', 4, { type: 'finish', reason: 'stop' }))

  // The durable settlement is held while its attempt is live: no duplicate.
  assert.deepEqual(p.event(parseEvent(assistantMessage(3, 'Hello'))), {})
  assert.equal(
    messages(p.view()).filter((item) => item.author === 'bot').length,
    1,
  )

  view = viewOf(p.assistantStream(committed('att-1', 5, 3)))
  assert.deepEqual(texts(view), [
    { author: 'user', text: 'hi' },
    { author: 'bot', text: 'Hello' },
  ])
  assert.notEqual(view.items.at(-1)?.id, streamId)
  assert.deepEqual(
    p.event(parseEvent(raw(4, 'step/end', { turn: 1, step: 0 }))),
    {},
  )
  assert.deepEqual(p.event(parseEvent(turnEnd(5, 'completed'))), {})
  assert.equal(p.view().items.length, 2)
})

test('a settlement that arrived before its attempt was known publishes directly', () => {
  const { projector: p } = projector()
  p.snapshot(snapshot([userMessage(0, 'hi')]))
  // Opened mid-attempt with no baseline: chunks of the unknown attempt are ignored.
  assert.deepEqual(p.assistantStream(chunk('att-x', 3, textDelta('lost'))), {})
  const view = viewOf(p.event(parseEvent(assistantMessage(1, 'full answer'))))
  assert.deepEqual(texts(view).at(-1), { author: 'bot', text: 'full answer' })
  assert.deepEqual(p.assistantStream(committed('att-x', 4, 1)), {})
})

test('a retried attempt settles as assistant/attempt and leaves no bubble', () => {
  const { projector: p } = projector()
  p.snapshot(snapshot([userMessage(0, 'hi')]))
  p.assistantStream(start('att-1', 0))
  p.assistantStream(chunk('att-1', 0, textDelta('partial')))
  p.event(
    parseEvent(raw(1, 'assistant/attempt', { turn: 1, step: 0, stream: [] })),
  )
  const view = viewOf(
    p.assistantStream(committed('att-1', 1, 1, 'assistant/attempt')),
  )
  assert.deepEqual(texts(view), [{ author: 'user', text: 'hi' }])
  p.assistantStream(start('att-2', 1))
  p.assistantStream(chunk('att-2', 0, textDelta('second try')))
  assert.deepEqual(texts(p.view()).at(-1), {
    author: 'bot',
    text: 'second try',
    streaming: true,
  })
})

// ---------------------------------------------------------------------------
// Snapshot mid-stream (compact records)
// ---------------------------------------------------------------------------

test('snapshot mid-stream folds compact records into the same live bubble', () => {
  const { projector: p } = projector()
  const activeAttempt = {
    attemptId: 'att-1',
    startedAfterSeq: 2,
    turn: 1,
    step: 0,
    nextIndex: 6,
    stream: [
      {
        type: 'chunk',
        time: 1,
        chunk: { type: 'block-start', index: 0, blockType: 'reasoning' },
      },
      {
        type: 'reasoning-chunks',
        time0: 2,
        index: 0,
        dt: [0],
        texts: ['thinking'],
      },
      {
        type: 'chunk',
        time: 3,
        chunk: { type: 'block-start', index: 1, blockType: 'text' },
      },
      {
        type: 'text-chunks',
        time0: 4,
        index: 1,
        dt: [0, 1],
        texts: ['Hel', 'lo'],
      },
      {
        type: 'tool-call-chunks',
        time0: 6,
        index: 2,
        dt: [0],
        id: 'call-1',
        name: 'bash',
        args: ['{"command":"SECRET-ARGS"}'],
      },
    ],
  }
  const view = viewOf(
    p.snapshot(
      snapshot([userMessage(0, 'hi'), turnStart(1), stepStart(2)], {
        activeAttempt,
      }),
    ),
  )
  assert.deepEqual(texts(view).at(-1), {
    author: 'bot',
    text: 'Hello',
    streaming: true,
  })
  assert.ok(!JSON.stringify(view).includes('SECRET-ARGS'))
  assert.ok(!JSON.stringify(view).includes('thinking'))

  const live = viewOf(
    p.assistantStream(chunk('att-1', 6, textDelta(' world', 1))),
  )
  assert.equal(live.items.at(-1)?.id, view.items.at(-1)?.id)
  assert.deepEqual(texts(live).at(-1), {
    author: 'bot',
    text: 'Hello world',
    streaming: true,
  })

  p.event(parseEvent(assistantMessage(3, 'Hello world')))
  const settled = viewOf(p.assistantStream(committed('att-1', 7, 3)))
  assert.deepEqual(texts(settled), [
    { author: 'user', text: 'hi' },
    { author: 'bot', text: 'Hello world' },
  ])
})

// ---------------------------------------------------------------------------
// Continuity, reconnect and duplicates
// ---------------------------------------------------------------------------

test('seq gap rebaselines; the fresh snapshot rebuilds without duplicates', () => {
  const { projector: p, observed } = projector()
  p.snapshot(snapshot(BASE.slice(0, 3)))
  p.assistantStream(start('att-1', 2))
  p.assistantStream(chunk('att-1', 0, textDelta('provisional')))
  const before = ids(p.view())

  const update = p.event(parseEvent(assistantMessage(4, 'skipped seq 3')))
  assert.equal(update.rebaseline, 'seq-gap')
  const reconnecting = viewOf(update)
  assert.equal(reconnecting.state, 'reconnecting')
  assert.deepEqual(texts(reconnecting), [{ author: 'user', text: 'hello bot' }])
  // Nothing is applied until the reopened snapshot.
  assert.deepEqual(p.event(parseEvent(raw(3, 'step/end', {}))), {})
  assert.deepEqual(p.assistantStream(chunk('att-1', 1, textDelta('x'))), {})

  const rebuilt = viewOf(p.snapshot(snapshot(BASE)))
  assert.equal(rebuilt.state, 'ready')
  assert.deepEqual(texts(rebuilt), [
    { author: 'user', text: 'hello bot' },
    { author: 'bot', text: 'hello human' },
  ])
  assert.equal(ids(rebuilt)[0], before[0], 'ids survive a rebuild')
  assert.equal(new Set(ids(rebuilt)).size, rebuilt.items.length)
  assert.deepEqual(
    observed.map((value) => value.seq),
    [2, 2],
    'observation repeats per rebuild for an idempotent receiver',
  )
  assert.equal(p.diagnostics().rebaselines, 1)
})

test('duplicate and out-of-order events are ignored', () => {
  const { projector: p } = projector()
  p.snapshot(snapshot(BASE))
  const view = p.view()
  assert.deepEqual(p.event(parseEvent(assistantMessage(3, 'again'))), {})
  assert.deepEqual(p.event(parseEvent(userMessage(0, 'old'))), {})
  assert.equal(p.view(), view)
  assert.deepEqual(p.snapshot(snapshot(BASE)), {}, 'same snapshot, same view')
})

test('a surface replace rebaselines instead of patching', () => {
  const { projector: p } = projector()
  p.snapshot(snapshot(BASE))
  const update = p.event(
    parseEvent(
      raw(
        6,
        'user/message',
        {
          id: 'summary',
          role: 'user',
          content: [{ type: 'text', text: 'summary' }],
          source: { kind: 'compaction' },
        },
        {
          surfaceOp: { op: 'replace', startSeq: 2, endSeq: 3 },
          sourceEventSeqs: [2, 3],
        },
      ),
    ),
  )
  assert.equal(update.rebaseline, 'surface-replace')
  assert.equal(p.view().state, 'reconnecting')
  assert.equal(messages(p.view()).length, 2)
})

test('stream continuity breaks rebaseline', () => {
  const skip = projector().projector
  skip.snapshot(snapshot([userMessage(0, 'hi')]))
  skip.assistantStream(start('att-1', 0))
  skip.assistantStream(chunk('att-1', 0, textDelta('a')))
  assert.equal(
    skip.assistantStream(chunk('att-1', 2, textDelta('c'))).rebaseline,
    'stream-continuity',
  )
  assert.deepEqual(texts(skip.view()), [{ author: 'user', text: 'hi' }])

  const twice = projector().projector
  twice.snapshot(snapshot([userMessage(0, 'hi')]))
  twice.assistantStream(start('att-1', 0))
  assert.equal(
    twice.assistantStream(start('att-2', 0)).rebaseline,
    'stream-continuity',
  )

  const mismatch = projector().projector
  mismatch.snapshot(snapshot([userMessage(0, 'hi')]))
  mismatch.assistantStream(start('att-1', 0))
  mismatch.event(parseEvent(assistantMessage(1, 'answer')))
  assert.equal(
    mismatch.assistantStream(committed('att-1', 0, 7)).rebaseline,
    'stream-continuity',
  )
  // The held durable reply is a fact and survives the rebaseline.
  assert.deepEqual(texts(mismatch.view()).at(-1), {
    author: 'bot',
    text: 'answer',
  })

  const lastIndex = projector().projector
  lastIndex.snapshot(snapshot([userMessage(0, 'hi')]))
  lastIndex.assistantStream(start('att-1', 0))
  lastIndex.assistantStream(chunk('att-1', 0, textDelta('a')))
  assert.equal(
    lastIndex.assistantStream(abandoned('att-1', 3)).rebaseline,
    'stream-continuity',
  )
})

test('disconnect drops provisional text and never counts it as a reply', () => {
  const { projector: p } = projector()
  p.snapshot(snapshot([userMessage(0, 'hi')]))
  p.assistantStream(start('att-1', 0))
  p.assistantStream(chunk('att-1', 0, textDelta('half an ans')))
  const update = p.rebaseline('disconnected')
  assert.equal(update.rebaseline, 'disconnected')
  const view = viewOf(update)
  assert.equal(view.state, 'reconnecting')
  assert.deepEqual(texts(view), [{ author: 'user', text: 'hi' }])
  assert.ok(messages(view).every((item) => item.streaming !== true))
})

test('fail keeps history and reports error', () => {
  const { projector: p } = projector()
  p.snapshot(snapshot(BASE))
  const view = viewOf(p.fail())
  assert.equal(view.state, 'error')
  assert.equal(messages(view).length, 2)
})

// ---------------------------------------------------------------------------
// History backfill
// ---------------------------------------------------------------------------

const HISTORY = [
  turnStart(0),
  userMessage(1, 'first question'),
  assistantMessage(2, 'first answer'),
  turnEnd(3, 'completed'),
  turnStart(4, 2),
  userMessage(5, 'second question'),
  assistantMessage(6, 'second answer', 2),
  turnEnd(7, 'completed', 2),
]

test('page backfill prepends in order without duplicates', () => {
  const { projector: p } = projector()
  p.snapshot(snapshot(HISTORY.slice(4), { hasMore: true }))
  const request = p.earlierPage()
  assert.deepEqual(request, { throughSeq: 7, beforeSeq: 4 })
  if (request === null) return

  // A page that does not join the window is dropped.
  const gapped: SessionPage = {
    records: HISTORY.slice(0, 2).map(parseEvent),
    hasMore: false,
  }
  assert.deepEqual(p.applyEarlier(request, gapped), {})

  const page: SessionPage = {
    records: HISTORY.slice(0, 4).map(parseEvent),
    hasMore: false,
  }
  const view = viewOf(p.applyEarlier(request, page))
  assert.deepEqual(
    texts(view).map((item) => item.text),
    ['first question', 'first answer', 'second question', 'second answer'],
  )
  assert.equal(view.hasEarlier, false)
  assert.equal(p.earlierPage(), null)
  // Replaying the same page against a moved anchor is stale.
  assert.deepEqual(p.applyEarlier(request, page), {})

  // A rebuild that still joins keeps the backfilled history.
  const rebuilt = p.snapshot(
    snapshot([...HISTORY.slice(5), userMessage(8, 'third')], { hasMore: true }),
  )
  assert.deepEqual(
    texts(viewOf(rebuilt)).map((item) => item.text),
    [
      'first question',
      'first answer',
      'second question',
      'second answer',
      'third',
    ],
  )
  assert.equal(viewOf(rebuilt).hasEarlier, false)
})

test('a rebuild that no longer joins backfilled history drops it', () => {
  const { projector: p } = projector()
  p.snapshot(snapshot(HISTORY.slice(0, 4), { hasMore: false }))
  const view = viewOf(
    p.snapshot(snapshot(HISTORY.slice(6), { cursor: 7, hasMore: true })),
  )
  assert.deepEqual(
    texts(view).map((item) => item.text),
    ['second answer'],
  )
  assert.equal(view.hasEarlier, true)
})

// ---------------------------------------------------------------------------
// Unknown kinds, cancellation, tools, approvals, turn ends
// ---------------------------------------------------------------------------

test('unknown chunk kinds and event types never crash', () => {
  const { projector: p } = projector()
  p.snapshot(snapshot([userMessage(0, 'hi')]))
  p.assistantStream(start('att-1', 0))
  assert.deepEqual(
    p.assistantStream(
      chunk('att-1', 0, { type: 'citation-delta', index: 0, url: 'x' }),
    ),
    {},
  )
  assert.deepEqual(p.assistantStream(chunk('att-1', 1, { nope: true })), {})
  p.assistantStream(chunk('att-1', 2, textDelta('ok')))
  assert.equal(p.diagnostics().unknownChunks, 2)
  assert.deepEqual(texts(p.view()).at(-1), {
    author: 'bot',
    text: 'ok',
    streaming: true,
  })

  const q = projector().projector
  const view = viewOf(
    q.snapshot(
      snapshot([
        raw(0, 'vendor/ignorable', { secret: 'HOST-RAW' }, { ignorable: true }),
        raw(1, 'vendor/required', { secret: 'HOST-RAW' }),
        raw(2, 'session/title', { title: 'HOST-RAW' }),
      ]),
    ),
  )
  assert.deepEqual(
    view.items.map((item) => item.kind === 'notice' && item.text),
    [NOTICE_TEXT.unsupported],
  )
  assert.ok(!JSON.stringify(view).includes('HOST-RAW'))
  assert.equal(q.diagnostics().unknownEvents, 2)
})

test('cancel mid-stream keeps the interrupted prefix once and says stopped', () => {
  const { projector: p } = projector()
  p.snapshot(snapshot([userMessage(0, 'hi'), turnStart(1), stepStart(2)]))
  p.assistantStream(start('att-1', 2))
  p.assistantStream(chunk('att-1', 0, textDelta('partial')))
  p.event(
    parseEvent(assistantMessage(3, 'partial', 1, 0, { interrupted: true })),
  )
  p.assistantStream(committed('att-1', 1, 3))
  const view = viewOf(p.event(parseEvent(turnEnd(4, 'aborted'))))
  assert.deepEqual(texts(view), [
    { author: 'user', text: 'hi' },
    { author: 'bot', text: 'partial' },
  ])
  assert.deepEqual(
    notices(view).map(({ tone, text }) => ({ tone, text })),
    [{ tone: 'info', text: NOTICE_TEXT.turnAborted }],
  )
})

test('an abandoned attempt drops its text; the aborted turn leaves a notice', () => {
  const { projector: p } = projector()
  p.snapshot(snapshot([userMessage(0, 'hi'), turnStart(1)]))
  p.assistantStream(start('att-1', 1))
  p.assistantStream(chunk('att-1', 0, textDelta('never kept')))
  const dropped = viewOf(p.assistantStream(abandoned('att-1', 1)))
  assert.deepEqual(texts(dropped), [{ author: 'user', text: 'hi' }])
  const view = viewOf(p.event(parseEvent(turnEnd(2, 'aborted'))))
  assert.equal(notices(view)[0]?.text, NOTICE_TEXT.turnAborted)
})

test('a turn that ends without an end frame drops the provisional bubble', () => {
  const { projector: p } = projector()
  p.snapshot(snapshot([userMessage(0, 'hi'), turnStart(1)]))
  p.assistantStream(start('att-1', 1))
  p.assistantStream(chunk('att-1', 0, textDelta('dangling')))
  const view = viewOf(p.event(parseEvent(turnEnd(2, 'interrupted'))))
  assert.ok(messages(view).every((item) => item.streaming !== true))
  assert.deepEqual(
    notices(view).map(({ tone, text }) => ({ tone, text })),
    [{ tone: 'error', text: NOTICE_TEXT.turnInterrupted }],
  )
})

test('turn end reasons map to fixed notices', () => {
  const { projector: p } = projector()
  const view = viewOf(
    p.snapshot(
      snapshot([
        turnEnd(0, 'completed'),
        turnEnd(1, 'error'),
        turnEnd(2, 'max-tokens'),
        turnEnd(3, 'blocked'),
        turnEnd(4, 'forked'),
        turnEnd(5, 'from-a-newer-host'),
      ]),
    ),
  )
  assert.deepEqual(
    notices(view).map(({ tone, text }) => ({ tone, text })),
    [
      { tone: 'error', text: NOTICE_TEXT.turnError },
      { tone: 'info', text: NOTICE_TEXT.turnMaxTokens },
      { tone: 'info', text: NOTICE_TEXT.turnBlocked },
      { tone: 'info', text: NOTICE_TEXT.turnEnded },
    ],
  )
})

test('tool calls show only the tool type, never arguments or output', () => {
  const { projector: p } = projector()
  p.snapshot(snapshot([userMessage(0, 'run it'), turnStart(1), stepStart(2)]))
  p.assistantStream(start('att-1', 2))
  p.assistantStream(
    chunk('att-1', 0, {
      type: 'block-start',
      index: 0,
      blockType: 'tool-call',
    }),
  )
  assert.deepEqual(
    p.assistantStream(
      chunk('att-1', 1, {
        type: 'tool-call-delta',
        index: 0,
        id: 'call-1',
        name: 'bash',
        argumentsDelta: '{"command":"SECRET-ARGS"}',
      }),
    ),
    {},
  )
  assert.equal(p.diagnostics().unknownChunks, 0)
  const toolOnly = raw(
    3,
    'assistant/message',
    {
      turn: 1,
      step: 0,
      message: {
        id: 'm3',
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            id: 'call-1',
            name: 'bash',
            arguments: '{"command":"SECRET-ARGS"}',
          },
        ],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
      stream: [],
    },
    { surfaceOp: 'append' },
  )
  p.event(parseEvent(toolOnly))
  p.assistantStream(committed('att-1', 2, 3))
  let view = viewOf(
    p.event(
      parseEvent(
        raw(4, 'tool/call', {
          turn: 1,
          step: 0,
          callId: 'call-1',
          name: 'bash',
          arguments: '{"command":"SECRET-ARGS"}',
        }),
      ),
    ),
  )
  assert.deepEqual(
    notices(view).map(({ tone, text }) => ({ tone, text })),
    [{ tone: 'info', text: '正在使用工具 bash' }],
  )
  const noticeId = notices(view)[0]?.id
  view = viewOf(
    p.event(
      parseEvent(
        raw(
          5,
          'tool/result',
          {
            turn: 1,
            step: 0,
            message: {
              id: 'm5',
              role: 'tool',
              content: [{ type: 'text', text: 'SECRET-OUTPUT' }],
              source: { kind: 'tool', callId: 'call-1' },
              toolCallId: 'call-1',
              isError: true,
            },
            error: { name: 'Exit', code: '1', reason: 'SECRET-REASON' },
          },
          { surfaceOp: 'append' },
        ),
      ),
    ),
  )
  assert.deepEqual(
    notices(view).map(({ id, tone, text }) => ({ id, tone, text })),
    [{ id: noticeId, tone: 'error', text: '工具 bash执行失败' }],
  )
  const json = JSON.stringify(view)
  for (const secret of ['SECRET-ARGS', 'SECRET-OUTPUT', 'SECRET-REASON'])
    assert.ok(!json.includes(secret), secret)
  // Tool-only assistant messages add no empty bubble.
  assert.deepEqual(texts(view), [{ author: 'user', text: 'run it' }])

  const odd = projector().projector
  const oddView = viewOf(
    odd.snapshot(
      snapshot([
        raw(0, 'tool/call', {
          turn: 1,
          step: 0,
          callId: 'c',
          name: 'rm -rf /; echo',
          arguments: '{}',
        }),
      ]),
    ),
  )
  assert.equal(notices(oddView)[0]?.text, '正在使用工具')
})

test('approvals render from the journal; only the durable decision is terminal', () => {
  const overlays = new Map<string, ApprovalOverlay>([
    ['appr-1', { handle: 'h_live', status: 'submitting' }],
  ])
  const { projector: p } = projector({
    approvalOverlay: (ref) => overlays.get(ref.approvalId),
  })
  const asked = raw(0, 'approval/asked', {
    id: 'appr-1',
    toolName: 'bash',
    callId: 'call-1',
    reason: 'SECRET-REASON /Users/someone',
  })
  let view = viewOf(p.snapshot(snapshot([asked])))
  const card = view.items[0]
  assert.equal(card?.kind, 'approval')
  if (card?.kind !== 'approval') return
  assert.equal(card.handle, 'h_live')
  assert.equal(card.status, 'submitting')
  assert.equal(card.detail, '工具 bash')
  assert.ok(!JSON.stringify(view).includes('SECRET-REASON'))

  overlays.set('appr-1', { handle: 'h_live', status: 'pending' })
  view = viewOf(p.refresh())
  assert.equal(
    view.items[0]?.kind === 'approval' && view.items[0].status,
    'pending',
  )

  view = viewOf(
    p.event(
      parseEvent(
        raw(1, 'approval/decided', { id: 'appr-1', outcome: 'cancelled' }),
      ),
    ),
  )
  assert.equal(
    view.items[0]?.kind === 'approval' && view.items[0].status,
    'cancelled',
  )
  overlays.set('appr-1', { handle: 'h_live', status: 'submitting' })
  assert.deepEqual(
    p.refresh(),
    {},
    'a live overlay cannot reopen a decided card',
  )

  const q = projector().projector
  const unavailable = viewOf(
    q.snapshot(
      snapshot([
        raw(0, 'approval/asked', { id: 'a', toolName: 'bash' }),
        raw(1, 'approval/decided', { id: 'a', outcome: 'unavailable' }),
      ]),
    ),
  )
  const settled = unavailable.items[0]
  assert.equal(settled?.kind === 'approval' && settled.status, 'cancelled')
  assert.equal(settled?.kind === 'approval' && settled.handle, settled?.id)
})

// ---------------------------------------------------------------------------
// Admissions
// ---------------------------------------------------------------------------

test('a pending send shows once and hands its id to the durable message', () => {
  const messageIds = new Map([['req-7', 'msg_corn_7']])
  const { projector: p, observed } = projector({
    messageIdFor: (requestId) => messageIds.get(requestId),
  })
  p.snapshot(snapshot([userMessage(0, 'earlier')]))
  let view = viewOf(
    p.setAdmissions([
      {
        messageId: 'msg_corn_7',
        requestId: 'req-7',
        text: 'queued text',
        delivery: 'accepted',
      },
      {
        messageId: 'msg_corn_8',
        requestId: 'req-8',
        text: 'failed text',
        delivery: 'failed',
        failure: '未确认送达',
      },
    ]),
  )
  assert.deepEqual(
    messages(view).map(({ id, delivery, failure }) => ({
      id,
      delivery,
      failure,
    })),
    [
      { id: messages(view)[0]?.id, delivery: undefined, failure: undefined },
      { id: 'msg_corn_7', delivery: 'accepted', failure: undefined },
      { id: 'msg_corn_8', delivery: 'failed', failure: '未确认送达' },
    ],
  )

  p.event(parseEvent(turnStart(1)))
  view = viewOf(p.event(parseEvent(userMessage(2, 'queued text', 'req-7'))))
  const sevens = messages(view).filter((item) => item.id === 'msg_corn_7')
  assert.equal(sevens.length, 1)
  assert.equal(
    sevens[0]?.delivery,
    undefined,
    'durable messages carry no delivery',
  )
  assert.deepEqual(observed.at(-1), { requestId: 'req-7', seq: 2 })
  assert.equal(messages(view).at(-1)?.id, 'msg_corn_8')

  // The admission store dropping the observed row changes nothing visible.
  assert.deepEqual(
    p.setAdmissions([
      {
        messageId: 'msg_corn_8',
        requestId: 'req-8',
        text: 'failed text',
        delivery: 'failed',
        failure: '未确认送达',
      },
    ]),
    {},
  )
})

// ---------------------------------------------------------------------------
// ConversationFollow: reopen and backfill
// ---------------------------------------------------------------------------

function followHarness(pages: SessionPage[] = []) {
  const streams: { handlers: FollowHandlers; closed: boolean }[] = []
  const reopens: { reason: string; reopen: () => void; cancelled: boolean }[] =
    []
  const views: ConversationView[] = []
  const pageRequests: EarlierPageRequest[] = []
  const { projector: p } = projector()
  const follow = new ConversationFollow({
    projector: p,
    openFollow: (handlers) => {
      const stream = { handlers, closed: false }
      streams.push(stream)
      return {
        close: () => {
          stream.closed = true
        },
      }
    },
    page: async (request) => {
      pageRequests.push(request)
      const page = pages.shift()
      assert.ok(page, 'unexpected page request')
      return page
    },
    onView: (view) => views.push(view),
    scheduleReopen: (reason, reopen) => {
      const entry = { reason, reopen, cancelled: false }
      reopens.push(entry)
      return () => {
        entry.cancelled = true
      }
    },
  })
  return { follow, projector: p, streams, reopens, views, pageRequests }
}

test('follow: a gap closes the stream, reopens once and rebuilds cleanly', () => {
  const h = followHarness()
  h.follow.start()
  assert.equal(h.streams.length, 1)
  const first = h.streams[0]
  assert.ok(first)
  first.handlers.onSnapshot(snapshot(BASE.slice(0, 3)))
  first.handlers.onAssistantStream?.(start('att-1', 2))
  first.handlers.onAssistantStream?.(chunk('att-1', 0, textDelta('live')))
  assert.equal(h.views.at(-1)?.items.length, 2)

  first.handlers.onGap({ expected: 3, received: 5 })
  assert.equal(h.views.at(-1)?.state, 'reconnecting')
  assert.equal(h.reopens.length, 1)
  assert.equal(h.reopens[0]?.reason, 'seq-gap')
  // Late frames from the dead stream are ignored.
  first.handlers.onEvent(parseEvent(raw(3, 'step/end', {})))
  first.handlers.onError(new Error('late'))
  assert.equal(h.reopens.length, 1)
  h.follow.start()
  assert.equal(h.streams.length, 1, 'start does not race a pending reopen')

  h.reopens[0]?.reopen()
  assert.equal(h.streams.length, 2)
  h.streams[1]?.handlers.onSnapshot(snapshot(BASE))
  const view = h.views.at(-1)
  assert.equal(view?.state, 'ready')
  assert.deepEqual(view && texts(view), [
    { author: 'user', text: 'hello bot' },
    { author: 'bot', text: 'hello human' },
  ])
})

test('follow: projector-detected breaks and errors close and reschedule', () => {
  const h = followHarness()
  h.follow.start()
  const first = h.streams[0]
  assert.ok(first)
  first.handlers.onSnapshot(snapshot([userMessage(0, 'hi')]))
  first.handlers.onAssistantStream?.(start('att-1', 0))
  first.handlers.onAssistantStream?.(start('att-2', 0))
  assert.equal(first.closed, true)
  assert.equal(h.reopens[0]?.reason, 'stream-continuity')

  h.reopens[0]?.reopen()
  const second = h.streams[1]
  assert.ok(second)
  second.handlers.onSnapshot(snapshot([userMessage(0, 'hi')]))
  second.handlers.onError(new Error('socket closed'))
  assert.equal(h.reopens[1]?.reason, 'disconnected')
  assert.equal(h.views.at(-1)?.state, 'reconnecting')

  h.follow.stop()
  assert.equal(h.reopens[1]?.cancelled, true)
  h.reopens[1]?.reopen()
  assert.equal(h.streams.length, 2, 'no reopen after stop')
})

test('follow: loadEarlier pages once per anchor and merges', async () => {
  const h = followHarness([
    { records: HISTORY.slice(0, 4).map(parseEvent), hasMore: false },
  ])
  assert.equal(await h.follow.loadEarlier(), 'none')
  h.follow.start()
  h.streams[0]?.handlers.onSnapshot(
    snapshot(HISTORY.slice(4), { hasMore: true }),
  )
  const [a, b] = await Promise.all([
    h.follow.loadEarlier(),
    h.follow.loadEarlier(),
  ])
  assert.equal(a, 'loaded')
  assert.equal(b, 'loaded')
  assert.deepEqual(h.pageRequests, [{ throughSeq: 7, beforeSeq: 4 }])
  const view = h.views.at(-1)
  assert.equal(view?.hasEarlier, false)
  assert.equal(view && messages(view).length, 4)
  assert.equal(await h.follow.loadEarlier(), 'none')
})
