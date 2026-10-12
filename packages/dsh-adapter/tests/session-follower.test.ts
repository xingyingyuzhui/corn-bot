import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type SeqGap, SessionFollower } from '../src/session-follower.ts'
import {
  type AssistantStreamFrame,
  classifyStreamChunk,
  classifyStreamRecord,
  type FollowSnapshot,
  parseFollowFrame,
  type WireEvent,
} from '../src/session-wire.ts'
import { HostStreamMux } from '../src/transport.ts'
import { fakeSocket } from './helpers/fake-socket.ts'

const HEADER = {
  version: 1,
  id: 'corn-session',
  createdAt: 1,
  cwd: '/claw/bot',
  isSeeded: false,
  agentPreset: 'wa-bot',
}

const event = (seq: number, type = 'turn/start', extra = {}) => ({
  type: 'event',
  event: { type, seq, time: 10 + seq, data: { turn: 1 }, ...extra },
})

const snapshot = (cursor: number, extra = {}) => ({
  type: 'snapshot',
  header: HEADER,
  cursor,
  records: cursor < 0 ? [] : [event(cursor - 1), event(cursor)],
  hasMore: false,
  projections: { asOfSeq: cursor, values: { inbox: [] } },
  ...extra,
})

function harness(assistantStream = true) {
  const { socket, sent, deliver, fail } = fakeSocket()
  const mux = new HostStreamMux(socket)
  const seen = {
    snapshots: [] as FollowSnapshot[],
    events: [] as WireEvent[],
    frames: [] as AssistantStreamFrame[],
    gaps: [] as SeqGap[],
    errors: [] as Error[],
  }
  const follower = SessionFollower.open(
    mux,
    { sessionId: 'corn-session', assistantStream, maxMessages: 50 },
    {
      onSnapshot: (value) => seen.snapshots.push(value),
      onEvent: (value) => seen.events.push(value),
      onAssistantStream: (value) => seen.frames.push(value),
      onGap: (value) => seen.gaps.push(value),
      onError: (value) => seen.errors.push(value),
    },
  )
  const open = sent[0]
  assert.ok(open)
  const streamId = String(open.streamId)
  return {
    follower,
    sent,
    seen,
    open,
    push: (value: unknown) => deliver(streamId, value),
    fail: (code: string) => fail(streamId, code),
  }
}

test('follow opens the exact session address and delivers snapshot, contiguous events and stream frames', () => {
  const h = harness()
  assert.equal(h.open.endpoint, 'session/follow')
  assert.deepEqual(h.open.payload, {
    args: {
      request: {
        address: { kind: 'session', sessionId: 'corn-session' },
        assistantStream: true,
        maxMessages: 50,
      },
    },
  })
  h.push(
    snapshot(3, {
      assistantStream: {
        revision: 2,
        activeAttempt: {
          attemptId: 'attempt-1',
          startedAfterSeq: 3,
          turn: 1,
          step: 0,
          nextIndex: 1,
          stream: [
            { type: 'text-chunks', time0: 1, index: 0, dt: [], texts: ['he'] },
          ],
        },
      },
    }),
  )
  assert.equal(h.follower.cursor, 3)
  const opened = h.seen.snapshots[0]
  assert.ok(opened)
  assert.deepEqual(opened.header, {
    sessionId: 'corn-session',
    createdAt: 1,
    isSeeded: false,
    cwd: '/claw/bot',
    agentPreset: 'wa-bot',
  })
  assert.deepEqual(
    opened.records.map((record) => record.seq),
    [2, 3],
  )
  h.push({
    type: 'assistant-stream',
    frame: {
      type: 'chunk',
      attemptId: 'attempt-1',
      revision: 3,
      index: 1,
      time: 20,
      chunk: { type: 'text-delta', index: 0, text: 'llo' },
    },
  })
  h.push(event(4, 'assistant/message', { surfaceOp: 'append' }))
  h.push({
    type: 'assistant-stream',
    frame: {
      type: 'end',
      attemptId: 'attempt-1',
      revision: 4,
      index: 2,
      outcome: { kind: 'committed', eventType: 'assistant/message', seq: 4 },
    },
  })
  h.push(event(5, 'turn/end'))
  assert.deepEqual(
    h.seen.events.map((item) => [item.seq, item.type, item.surfaceOp]),
    [
      [4, 'assistant/message', 'append'],
      [5, 'turn/end', undefined],
    ],
  )
  assert.equal(h.follower.cursor, 5)
  assert.deepEqual(
    h.seen.frames.map((frame) => frame.type),
    ['chunk', 'end'],
  )
  assert.deepEqual(h.seen.gaps, [])
  assert.deepEqual(h.seen.errors, [])
  h.follower.close()
  assert.deepEqual(h.sent.at(-1), { type: 'cancel', streamId: h.open.streamId })
  h.follower.close()
  assert.equal(h.sent.length, 2)
})

test('a durable seq gap is reported once, closes the stream and drops the gapped event', () => {
  const h = harness(false)
  assert.deepEqual(h.open.payload, {
    args: {
      request: {
        address: { kind: 'session', sessionId: 'corn-session' },
        maxMessages: 50,
      },
    },
  })
  h.push(snapshot(-1))
  h.push(event(0))
  h.push(event(2))
  h.push(event(3))
  assert.deepEqual(h.seen.gaps, [{ expected: 1, received: 2 }])
  assert.deepEqual(
    h.seen.events.map((item) => item.seq),
    [0],
  )
  assert.equal(h.follower.closed, true)
  assert.deepEqual(h.sent.at(-1), { type: 'cancel', streamId: h.open.streamId })
})

test('a replayed or repeated seq is a gap, not a duplicate delivery', () => {
  const h = harness()
  h.push(snapshot(3))
  h.push(event(3))
  assert.deepEqual(h.seen.gaps, [{ expected: 4, received: 3 }])
  assert.deepEqual(h.seen.events, [])
})

test('protocol violations close the follow with an error and never reach the shared mux', () => {
  const cases: Array<[string, unknown[]]> = [
    ['event before snapshot', [event(0)]],
    ['stream before snapshot', [{ type: 'assistant-stream', frame: {} }]],
    ['second snapshot', [snapshot(1), snapshot(1)]],
    ['unknown frame', [snapshot(1), { type: 'mystery' }]],
    ['non-object frame', [snapshot(1), 'text']],
  ]
  for (const [label, frames] of cases) {
    const h = harness()
    for (const frame of frames) h.push(frame)
    assert.equal(h.seen.errors.length, 1, label)
    assert.match(String(h.seen.errors[0]?.message), /Invalid|before|Duplicate/u)
    assert.equal(h.follower.closed, true, label)
  }
})

test('a throwing consumer callback ends only this follow', () => {
  const { socket, sent, deliver } = fakeSocket()
  const mux = new HostStreamMux(socket)
  const errors: Error[] = []
  const follower = SessionFollower.open(
    mux,
    { sessionId: 'corn-session' },
    {
      onSnapshot: () => {
        throw new Error('consumer bug')
      },
      onEvent: () => {},
      onGap: () => {},
      onError: (error) => {
        errors.push(error)
        throw new Error('second bug')
      },
    },
  )
  deliver(String(sent[0]?.streamId), snapshot(1))
  assert.equal(follower.closed, true)
  assert.deepEqual(
    errors.map((error) => error.message),
    ['consumer bug'],
  )
  const other = SessionFollower.open(
    mux,
    { sessionId: 'corn-other' },
    {
      onSnapshot: () => {},
      onEvent: () => {},
      onGap: () => {},
      onError: () => {},
    },
  )
  assert.equal(other.closed, false)
})

test('a Host stream error is terminal and reported to the follower', () => {
  const h = harness()
  h.push(snapshot(1))
  h.fail('session/not-found')
  assert.equal(h.seen.errors.length, 1)
  assert.equal(
    (h.seen.errors[0] as Error & { code?: string }).code,
    'session/not-found',
  )
  assert.equal(h.follower.closed, true)
})

test('follow frame parser accepts wire variants and rejects malformed shapes', () => {
  const ignorable = parseFollowFrame(
    event(0, 'future/thing', {
      ignorable: true,
      surfaceOp: { op: 'unknown' },
      sourceEventSeqs: 'opaque',
    }),
  )
  assert.equal(ignorable.type, 'event')
  assert.deepEqual(ignorable.type === 'event' && ignorable.event, {
    type: 'future/thing',
    seq: 0,
    time: 10,
    data: { turn: 1 },
    ignorable: true,
  })
  const replace = parseFollowFrame(
    event(4, 'assistant/message', {
      surfaceOp: { op: 'replace', startSeq: 1, endSeq: 3 },
      sourceEventSeqs: [1, 2],
    }),
  )
  assert.deepEqual(replace.type === 'event' && replace.event.surfaceOp, {
    op: 'replace',
    startSeq: 1,
    endSeq: 3,
  })
  const abandoned = parseFollowFrame({
    type: 'assistant-stream',
    frame: {
      type: 'end',
      attemptId: 'a',
      revision: 1,
      index: 0,
      outcome: { kind: 'abandoned' },
    },
  })
  assert.equal(abandoned.type, 'assistant-stream')
  const subagent = parseFollowFrame(
    snapshot(1, {
      header: {
        ...HEADER,
        origin: 'subagent',
        parentSession: 'corn-parent',
        delegationDepth: 1,
      },
    }),
  )
  assert.equal(
    subagent.type === 'snapshot' && subagent.header.parentSessionId,
    'corn-parent',
  )

  const bad: unknown[] = [
    event(-1),
    event(1.5),
    { type: 'event', event: { type: 'x', seq: 0, time: 1 } },
    event(0, 'x', { surfaceOp: 'prepend' }),
    event(0, 'x', { sourceEventSeqs: [-1] }),
    event(0, 'x', { ignorable: false }),
    snapshot(1, { header: { ...HEADER, id: '' } }),
    snapshot(1, { header: { ...HEADER, origin: 'fork' } }),
    snapshot(1, { header: { ...HEADER, isSeeded: 'no' } }),
    snapshot(1, { cursor: 0 }),
    snapshot(3, { records: [event(1), event(3)] }),
    snapshot(1, { records: [{ type: 'transient', event: {} }] }),
    snapshot(1, { projections: { asOfSeq: 1 } }),
    snapshot(1, { hasMore: 'yes' }),
    snapshot(1, { assistantStream: { revision: -1 } }),
    snapshot(1, {
      assistantStream: { revision: 1, activeAttempt: { attemptId: 'a' } },
    }),
    {
      type: 'assistant-stream',
      frame: {
        type: 'chunk',
        attemptId: 'a',
        revision: 1,
        index: -1,
        time: 1,
        chunk: {},
      },
    },
    {
      type: 'assistant-stream',
      frame: {
        type: 'start',
        attemptId: '',
        revision: 1,
        startedAfterSeq: 0,
        turn: 1,
        step: 0,
      },
    },
    {
      type: 'assistant-stream',
      frame: {
        type: 'end',
        attemptId: 'a',
        revision: 1,
        index: 0,
        outcome: { kind: 'committed', eventType: 'tool/result', seq: 1 },
      },
    },
    {
      type: 'assistant-stream',
      frame: { type: 'pause', attemptId: 'a', revision: 1 },
    },
  ]
  for (const frame of bad)
    assert.throws(
      () => parseFollowFrame(frame),
      (error: Error & { code?: string }) =>
        error.code === 'corn/invalid-response',
      JSON.stringify(frame),
    )
})

test('stream chunk and compact record classification exposes only text and reasoning', () => {
  assert.deepEqual(
    classifyStreamChunk({ type: 'text-delta', index: 0, text: 'hi' }),
    {
      kind: 'text',
      index: 0,
      text: 'hi',
    },
  )
  assert.deepEqual(
    classifyStreamChunk({ type: 'reasoning-delta', index: 1, text: 'hm' }),
    { kind: 'reasoning', index: 1, text: 'hm' },
  )
  assert.deepEqual(
    classifyStreamChunk({
      type: 'tool-call-delta',
      index: 2,
      id: 'call-1',
      argumentsDelta: '{"command":"secret"}',
    }),
    { kind: 'other', type: 'tool-call-delta' },
  )
  assert.deepEqual(classifyStreamChunk({ type: 'text-delta', index: 0 }), {
    kind: 'other',
    type: 'text-delta',
  })
  assert.deepEqual(classifyStreamChunk(null), {
    kind: 'other',
    type: 'invalid',
  })
  assert.deepEqual(
    classifyStreamRecord({
      type: 'text-chunks',
      time0: 1,
      index: 0,
      dt: [1],
      texts: ['hel', 'lo'],
    }),
    { kind: 'text', index: 0, text: 'hello' },
  )
  assert.deepEqual(
    classifyStreamRecord({
      type: 'chunk',
      time: 1,
      chunk: { type: 'finish', reason: { kind: 'stop' } },
    }),
    { kind: 'other', type: 'finish' },
  )
  assert.deepEqual(
    classifyStreamRecord({ type: 'tool-call-chunks', index: 0, args: ['x'] }),
    { kind: 'other', type: 'tool-call-chunks' },
  )
})
