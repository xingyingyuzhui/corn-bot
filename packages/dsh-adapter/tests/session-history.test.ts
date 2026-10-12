import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionClient } from '../src/session-client.ts'
import type { HostTransport } from '../src/transport.ts'

function clientAnswering(value: unknown) {
  const calls: Array<[string, Record<string, unknown>]> = []
  const transport = {
    async rpc(endpoint: string, args: Record<string, unknown>) {
      calls.push([endpoint, args])
      return value
    },
  } as unknown as HostTransport
  return { client: new SessionClient(transport), calls }
}

const record = (seq: number) => ({
  type: 'event',
  event: {
    type: 'user/message',
    seq,
    time: seq,
    data: {},
    surfaceOp: 'append',
  },
})

test('session rows parse list facts; agentPreset is not a list field', async () => {
  const { client, calls } = clientAnswering({
    items: [
      {
        sessionId: 'corn-parent',
        updatedAt: 5,
        agentAvailable: true,
        running: true,
        blank: false,
        cwd: '/claw/bot',
        agentPreset: 'wa-ignored',
        projections: { kind: 'sequenced', asOfSeq: 3, values: {} },
      },
      {
        sessionId: 'child-1',
        updatedAt: 4,
        agentAvailable: false,
        running: false,
        blank: true,
        parentSessionId: 'corn-parent',
        origin: 'subagent',
      },
    ],
  })
  assert.deepEqual(await client.sessionRows(), [
    {
      sessionId: 'corn-parent',
      updatedAt: 5,
      running: true,
      agentAvailable: true,
      blank: false,
      cwd: '/claw/bot',
    },
    {
      sessionId: 'child-1',
      updatedAt: 4,
      running: false,
      agentAvailable: false,
      blank: true,
      parentSessionId: 'corn-parent',
      origin: 'subagent',
    },
  ])
  assert.deepEqual(calls, [['session/list', { _request: {} }]])
  for (const row of [
    {
      sessionId: '',
      updatedAt: 1,
      agentAvailable: false,
      running: false,
      blank: true,
    },
    {
      sessionId: 's',
      updatedAt: 1,
      agentAvailable: false,
      running: 'no',
      blank: true,
    },
    {
      sessionId: 's',
      updatedAt: 1,
      agentAvailable: false,
      running: false,
      blank: true,
      origin: 'fork',
    },
    {
      sessionId: 's',
      updatedAt: 1,
      agentAvailable: false,
      running: false,
      blank: true,
      cwd: 1,
    },
  ])
    await assert.rejects(
      clientAnswering({ items: [row] }).client.sessionRows(),
      /Invalid Session row/u,
    )
})

test('page sends the exact address and cut and validates contiguous records within the cut', async () => {
  const { client, calls } = clientAnswering({
    records: [record(2), record(3)],
    hasMore: true,
  })
  const page = await client.page({
    sessionId: 'corn-session',
    throughSeq: 9,
    beforeSeq: 4,
    maxMessages: 20,
  })
  assert.deepEqual(
    page.records.map((item) => item.seq),
    [2, 3],
  )
  assert.equal(page.hasMore, true)
  assert.deepEqual(calls, [
    [
      'session/page',
      {
        request: {
          address: { kind: 'session', sessionId: 'corn-session' },
          throughSeq: 9,
          beforeSeq: 4,
          maxMessages: 20,
        },
      },
    ],
  ])
  const empty = clientAnswering({ records: [], hasMore: false })
  assert.deepEqual(
    await empty.client.page({ sessionId: 's', throughSeq: -1 }),
    {
      records: [],
      hasMore: false,
    },
  )
  assert.deepEqual(empty.calls[0]?.[1], {
    request: { address: { kind: 'session', sessionId: 's' }, throughSeq: -1 },
  })

  for (const value of [
    { records: [record(2), record(4)], hasMore: false },
    { records: [record(5)], hasMore: false },
    { records: [record(1)] },
    { records: {}, hasMore: false },
  ])
    await assert.rejects(
      clientAnswering(value).client.page({
        sessionId: 's',
        throughSeq: 4,
        beforeSeq: 5,
      }),
      /Invalid/u,
    )
  await assert.rejects(
    clientAnswering({ records: [record(4)], hasMore: false }).client.page({
      sessionId: 's',
      throughSeq: 9,
      beforeSeq: 4,
    }),
    /cut/u,
  )
  for (const request of [
    { sessionId: '', throughSeq: 0 },
    { sessionId: 's', throughSeq: -2 },
    { sessionId: 's', throughSeq: 1.5 },
    { sessionId: 's', throughSeq: 1, beforeSeq: -1 },
    { sessionId: 's', throughSeq: 1, maxMessages: 0 },
  ])
    await assert.rejects(client.page(request), /Invalid page request/u)
})
