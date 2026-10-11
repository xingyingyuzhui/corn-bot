import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { ClawGateClient } from '../src/claw-gate-client.ts'
import { SessionClient } from '../src/session-client.ts'
import { type ClawRoute, HostTransport } from '../src/transport.ts'

test('RPC allowlist, Cookie and correlation envelope are enforced', async () => {
  let mismatch = false
  const server = createServer((request, response) => {
    assert.equal(request.headers.cookie, 'dsh-auth-test=secret')
    let text = ''
    request.on('data', (chunk) => {
      text += chunk
    })
    request.on('end', () => {
      const body = JSON.parse(text)
      assert.equal(body.type, 'client-request')
      if (body.method === 'session/list')
        assert.deepEqual(body.payload.args, { _request: {} })
      else assert.equal(body.method, '$events/result')
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify({
          type: 'server-response',
          rpcId: mismatch ? 'wrong-id' : body.rpcId,
          result:
            body.method === '$events/result'
              ? { ok: true }
              : { ok: true, value: { items: [] } },
        }),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const origin = `http://127.0.0.1:${address.port}`
    const transport = new HostTransport({
      origin,
      headers: () => ({ Cookie: 'dsh-auth-test=secret' }),
      url: (path) => new URL(path, origin),
    })
    await assert.rejects(
      transport.rpc('credentials/export', {}),
      /not allowed/u,
    )
    const client = new SessionClient(transport)
    assert.deepEqual(await client.list(), [])
    assert.equal(
      await transport.rpc('$events/result', {
        clientId: 'test-client',
        eventId: 'test-event',
        outcome: { kind: 'result', value: 'rejected' },
      }),
      undefined,
    )
    mismatch = true
    await assert.rejects(client.list(), /correlation/u)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test('Claw routes are an exact allowlist; the Gate probe never surfaces audit rows', async () => {
  const paths: string[] = []
  let items: unknown = [{ tool: 'bash', reason: 'private-audit-row' }]
  const server = createServer((request, response) => {
    paths.push(request.url ?? '')
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ ok: true, items }))
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
    for (const route of [
      'gate/audit-export',
      'gate/audit/../audit-export',
      'policy/set',
    ])
      await assert.rejects(
        transport.claw(route as ClawRoute, {}),
        /not allowed/u,
      )
    assert.deepEqual(paths, [])
    const gate = new ClawGateClient(transport)
    assert.equal(await gate.verifyMounted(), undefined)
    items = [{}, {}]
    await assert.rejects(gate.verifyMounted(), /Invalid Claw Gate/u)
    assert.deepEqual(paths, [
      '/api/dsh-claw/gate/audit',
      '/api/dsh-claw/gate/audit',
    ])
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test('duplicate prompt admission shares a single flight; different requests serialize per Session', async () => {
  let active = 0
  let maxActive = 0
  let requests = 0
  const transport = {
    async rpc() {
      requests++
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active--
      return { accepted: true }
    },
  } as unknown as HostTransport
  const client = new SessionClient(transport)
  const request = {
    sessionId: 'corn-session',
    requestId: 'one',
    mode: 'queue' as const,
    content: [{ type: 'text' as const, text: 'test' }],
    clientTimeZone: 'Asia/Shanghai',
  }
  const one = client.prompt(request)
  const duplicate = client.prompt(request)
  const two = client.prompt({ ...request, requestId: 'two' })
  assert.equal(one, duplicate)
  await Promise.all([one, duplicate, two])
  assert.equal(requests, 2)
  assert.equal(maxActive, 1)
})
