import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { ClawRegistryClient } from '../src/claw-registry-client.ts'
import { type ClawRoute, HostTransport } from '../src/transport.ts'

const AGENT = {
  agentId: 'wa_1',
  workspaceId: '1',
  slug: 'corn-bot',
  kind: 'claw',
  canonicalRoot: '/home/claw/corn-bot',
  title: 'Corn Bot',
  preset: 'research',
  dshPreset: 'wa-1',
  policyVersion: 2,
  policy: { preset: 'research', shell: 'deny' },
  model: { provider: 'p', model: 'm' },
  status: 'active',
  createdAt: '2026-10-12T10:00:00.000Z',
  updatedAt: '2026-10-12T10:00:01.000Z',
  sessionIds: ['corn-s1'],
  sessionCount: 1,
  workspacePresent: true,
  declared: { preset: 'research', enforced: false },
  files: { root: '/home/claw/corn-bot', soul: '/home/claw/corn-bot/SOUL.md' },
}

const BINDING = {
  sessionId: 'corn-s1',
  agentId: 'wa_1',
  workspaceId: '1',
  presetId: 'wa-1',
  state: 'ready',
  source: 'create',
  createdAt: '2026-10-12T10:00:02.000Z',
  updatedAt: '2026-10-12T10:00:03.000Z',
}

function registryAnswering(value: Record<string, unknown>) {
  const calls: Array<[string, Record<string, unknown>]> = []
  const transport = {
    async registry(action: string, body: Record<string, unknown>) {
      calls.push([action, body])
      return value
    },
  } as unknown as HostTransport
  return { client: new ClawRegistryClient(transport), calls }
}

test('registry list parses agents and bindings and drops Host paths, policy and model', async () => {
  const { client, calls } = registryAnswering({
    ok: true,
    home: '/home',
    clawHome: '/home/claw',
    revision: 7,
    main: { agentId: 'main' },
    agents: [AGENT],
    bindings: [BINDING],
    pending: [],
    claims: [],
  })
  assert.deepEqual(await client.list(), {
    revision: 7,
    agents: [
      {
        agentId: 'wa_1',
        workspaceId: '1',
        canonicalRoot: '/home/claw/corn-bot',
        dshPreset: 'wa-1',
        title: 'Corn Bot',
        status: 'active',
        policyPreset: 'research',
        createdAt: Date.parse('2026-10-12T10:00:00.000Z'),
        sessionIds: ['corn-s1'],
        workspacePresent: true,
      },
    ],
    bindings: [
      {
        sessionId: 'corn-s1',
        agentId: 'wa_1',
        workspaceId: '1',
        presetId: 'wa-1',
        state: 'ready',
        source: 'create',
        createdAt: Date.parse('2026-10-12T10:00:02.000Z'),
        updatedAt: Date.parse('2026-10-12T10:00:03.000Z'),
      },
    ],
  })
  assert.deepEqual(calls, [['list', {}]])
})

test('one malformed registry row rejects the whole list', async () => {
  const bad: Record<string, unknown>[] = [
    { revision: 1.5, agents: [], bindings: [] },
    { revision: 1, agents: {}, bindings: [] },
    { revision: 1, agents: [{ ...AGENT, agentId: 'main' }], bindings: [] },
    {
      revision: 1,
      agents: [{ ...AGENT, dshPreset: 'standard' }],
      bindings: [],
    },
    { revision: 1, agents: [{ ...AGENT, status: 'deleted' }], bindings: [] },
    {
      revision: 1,
      agents: [{ ...AGENT, createdAt: 'yesterday' }],
      bindings: [],
    },
    { revision: 1, agents: [{ ...AGENT, sessionIds: [''] }], bindings: [] },
    { revision: 1, agents: [], bindings: [{ ...BINDING, state: 'bound' }] },
    { revision: 1, agents: [], bindings: [{ ...BINDING, source: 'manual' }] },
  ]
  for (const value of bad) {
    const { client } = registryAnswering(value)
    await assert.rejects(client.list(), JSON.stringify(value))
  }
})

test('policy sends the exact preset shape and verifies the applied preset', async () => {
  const { client, calls } = registryAnswering({
    agent: { ...AGENT, preset: 'developer' },
  })
  await client.policy('wa_1', 'developer')
  assert.deepEqual(calls, [
    ['policy', { agentId: 'wa_1', policy: { preset: 'developer' } }],
  ])
  const stale = registryAnswering({ agent: { ...AGENT, preset: 'research' } })
  await assert.rejects(stale.client.policy('wa_1', 'developer'), /not applied/u)
})

test('registry/policy is the only new Claw route and admits only {agentId, policy: {preset}}', async () => {
  const bodies: unknown[] = []
  const server = createServer((request, response) => {
    let text = ''
    request.on('data', (chunk) => {
      text += chunk
    })
    request.on('end', () => {
      bodies.push({ url: request.url, body: JSON.parse(text) })
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify({
          ok: true,
          agent: { agentId: 'wa_1', preset: 'research' },
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
      headers: () => ({}),
      url: (path) => new URL(path, origin),
    })
    for (const route of [
      'registry/model',
      'registry/session/adopt',
      'registry/skills',
      'registry/archive',
      'registry/policy/../model',
    ])
      await assert.rejects(
        transport.claw(route as ClawRoute, { agentId: 'wa_1' }),
        /not allowed/u,
        route,
      )
    for (const body of [
      { agentId: 'wa_1', policy: { preset: 'full' } },
      { agentId: 'wa_1', policy: { preset: 'reviewer' } },
      { agentId: 'wa_1', policy: { preset: 'research', shell: 'allow' } },
      { agentId: 'wa_1', policy: { preset: 'developer', approval: 'never' } },
      { agentId: 'wa_1', policy: { preset: 'research' }, expectedRevision: 1 },
      { agentId: 'main', policy: { preset: 'research' } },
      { agentId: 'wa_1', policy: 'research' },
      { agentId: 'wa_1', policy: ['research'] },
      { agentId: 'wa_1' },
    ])
      await assert.rejects(
        transport.claw('registry/policy', body),
        /research or developer/u,
        JSON.stringify(body),
      )
    assert.deepEqual(bodies, [])
    await new ClawRegistryClient(transport).policy('wa_1', 'research')
    assert.deepEqual(bodies, [
      {
        url: '/api/dsh-claw/registry/policy',
        body: { agentId: 'wa_1', policy: { preset: 'research' } },
      },
    ])
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
