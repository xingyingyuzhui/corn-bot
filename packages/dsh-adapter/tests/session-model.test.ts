import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { SessionClient } from '../src/session-client.ts'
import { HostTransport } from '../src/transport.ts'

const SELECTION = {
  sessionId: 'corn-session',
  provider: 'deepseek-official',
  model: 'deepseek-reasoner',
}

/** A SessionClient over a fake transport that records arguments and answers `value`. */
function clientAnswering(value: unknown) {
  const calls: Array<readonly [string, Record<string, unknown>]> = []
  const transport = {
    async rpc(endpoint: string, args: Record<string, unknown>) {
      calls.push([endpoint, args])
      return value
    },
  } as unknown as HostTransport
  return { client: new SessionClient(transport), calls }
}

test('session model selection always sends the session scope and returns the Host selection', async () => {
  const { client, calls } = clientAnswering({
    selected: {
      provider: 'deepseek-official',
      model: 'deepseek-reasoner',
      reasoningEffort: 'high',
    },
    scope: 'session',
  })
  assert.deepEqual(await client.selectSessionModel(SELECTION), {
    provider: 'deepseek-official',
    model: 'deepseek-reasoner',
    reasoningEffort: 'high',
  })
  assert.deepEqual(calls, [
    ['session/selectModel', { request: { ...SELECTION, scope: 'session' } }],
  ])
})

test('a reply that is not session-scoped or names another model is refused', async () => {
  const selected = { provider: 'deepseek-official', model: 'deepseek-reasoner' }
  for (const [label, value, request] of [
    // What an unpatched Host answers: it dropped `scope` and saved the default.
    ['unpatched Host', { selected }, SELECTION],
    ['default scope', { selected, scope: 'default' }, SELECTION],
    [
      'other model',
      { selected: { ...selected, model: 'deepseek-chat' }, scope: 'session' },
      SELECTION,
    ],
    [
      'other effort',
      { selected: { ...selected, reasoningEffort: 'high' }, scope: 'session' },
      { ...SELECTION, reasoningEffort: 'max' },
    ],
    [
      'malformed effort',
      { selected: { ...selected, reasoningEffort: 1 }, scope: 'session' },
      SELECTION,
    ],
  ] as const) {
    const { client } = clientAnswering(value)
    await assert.rejects(client.selectSessionModel(request), Error, label)
  }
})

test('the transport refuses selectModel unless it is session-scoped, before any request', async () => {
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const origin = `http://127.0.0.1:${address.port}`
    const transport = new HostTransport({
      origin,
      headers: () => ({}),
      url: (path) => new URL(path, origin),
    })
    for (const args of [
      { request: SELECTION },
      { request: { ...SELECTION, scope: 'default' } },
      { request: null },
      {},
    ])
      await assert.rejects(
        transport.rpc('session/selectModel', args),
        /Session-scoped model selection/u,
      )
    assert.equal(requests, 0)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
