import assert from 'node:assert/strict'
import { test } from 'node:test'
import type WebSocket from 'ws'
import { JobClient } from '../src/job-client.ts'
import { SessionClient } from '../src/session-client.ts'
import { HostStreamMux, HostTransport } from '../src/transport.ts'

function fakeSocket() {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const sent: Record<string, unknown>[] = []
  const socket = {
    readyState: 1,
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, handler)
      return socket
    },
    send(text: string) {
      sent.push(JSON.parse(text))
    },
    close() {},
  }
  const deliver = (streamId: string, value: unknown) =>
    handlers.get('message')?.(
      Buffer.from(JSON.stringify({ type: 'item', streamId, value })),
      false,
    )
  return { socket: socket as unknown as WebSocket, sent, deliver }
}

test('job kill uses its exact endpoint and request shape and validates the outcome', async () => {
  const calls: Array<[string, Record<string, unknown>]> = []
  let outcome: unknown = 'requested'
  const transport = {
    async rpc(endpoint: string, args: Record<string, unknown>) {
      calls.push([endpoint, args])
      return { outcome }
    },
  } as unknown as HostTransport
  const jobs = new JobClient(transport)
  assert.equal(await jobs.kill('corn-session', 'bash-1'), 'requested')
  assert.deepEqual(calls, [
    ['job/kill', { request: { sessionId: 'corn-session', jobId: 'bash-1' } }],
  ])
  outcome = 'killed-everything'
  await assert.rejects(jobs.kill('corn-session', 'bash-1'), /Invalid job kill/u)
})

test('job roster resolves the first rows frame, closes its stream and rejects bad rows', async () => {
  const { socket, sent, deliver } = fakeSocket()
  const mux = new HostStreamMux(socket)
  const jobs = new JobClient({} as HostTransport)
  const roster = jobs.rows(mux, 'corn-session')
  const open = sent[0]
  assert.ok(open)
  assert.equal(open.type, 'open')
  assert.equal(open.endpoint, 'job/list')
  assert.deepEqual(open.payload, {
    args: { request: { sessionId: 'corn-session' } },
  })
  deliver(String(open.streamId), {
    type: 'rows',
    jobs: [
      {
        id: 'bash-1',
        kind: 'bash',
        label: 'sleep',
        owner: 'corn-session',
        status: 'running',
        startedAt: 1,
        output: { total: 0, earliest: 0 },
      },
    ],
  })
  assert.deepEqual(await roster, [
    {
      id: 'bash-1',
      kind: 'bash',
      label: 'sleep',
      owner: 'corn-session',
      status: 'running',
      detail: null,
      startedAt: 1,
      finishedAt: null,
    },
  ])
  assert.deepEqual(sent[1], { type: 'cancel', streamId: open.streamId })

  const bad = jobs.rows(mux, 'corn-session')
  deliver(String(sent[2]?.streamId), {
    type: 'rows',
    jobs: [{ id: 'bash-2', kind: 'bash', status: 'exploded', startedAt: 1 }],
  })
  await assert.rejects(bad, /Invalid job row/u)
})

test('child interrupt uses the exact subagents endpoint, continuable mode and an accepted receipt', async () => {
  const calls: Array<[string, Record<string, unknown>]> = []
  let accepted: unknown = true
  const transport = {
    async rpc(endpoint: string, args: Record<string, unknown>) {
      calls.push([endpoint, args])
      return { accepted }
    },
  } as unknown as HostTransport
  const sessions = new SessionClient(transport)
  await sessions.interruptChild({
    parentSessionId: 'corn-parent',
    childSessionId: 'child-1',
  })
  assert.deepEqual(calls, [
    [
      'subagents/interruptByParent',
      {
        childSessionId: 'child-1',
        parentSessionId: 'corn-parent',
        mode: 'continuable',
      },
    ],
  ])
  accepted = false
  await assert.rejects(
    sessions.interruptChild({
      parentSessionId: 'corn-parent',
      childSessionId: 'child-1',
    }),
    /not accepted/u,
  )
})

test('job follow and other job and subagent methods stay outside both allowlists', async () => {
  const { socket } = fakeSocket()
  const mux = new HostStreamMux(socket)
  assert.throws(
    () =>
      mux.open(
        'job/follow',
        {},
        () => {},
        () => {},
      ),
    /not allowed/u,
  )
  assert.throws(
    () =>
      mux.open(
        'job/kill',
        {},
        () => {},
        () => {},
      ),
    /not allowed/u,
  )
  const real = new HostTransport({
    origin: 'http://127.0.0.1:9',
    headers: () => ({}),
    url: (path) => new URL(path, 'http://127.0.0.1:9'),
  })
  for (const endpoint of [
    'job/list',
    'job/follow',
    'job/start',
    'subagents/prompt',
    'workspace/archiveSession',
  ])
    await assert.rejects(real.rpc(endpoint, {}), /not allowed/u)
})
