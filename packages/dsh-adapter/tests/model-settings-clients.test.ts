import assert from 'node:assert/strict'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { CredentialsClient } from '../src/credentials-client.ts'
import { ModelCatalogClient } from '../src/model-catalog-client.ts'
import { ModelSettingsClient } from '../src/model-settings-client.ts'
import { RemoteError } from '../src/remote-error.ts'
import { HostTransport } from '../src/transport.ts'

interface Seen {
  readonly path: string
  readonly method: string
  readonly args: unknown
}

async function body(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Answers like the RC2 Remote gateway; `reply` picks the result per method. */
async function host(reply: (method: string, args: unknown) => unknown) {
  const seen: Seen[] = []
  const server = createServer(async (request, response) => {
    const envelope = await body(request)
    const method = String(envelope.method)
    const args = (envelope.payload as { args: unknown }).args
    seen.push({ path: request.url ?? '', method, args })
    response.setHeader('content-type', 'application/json')
    response.end(
      JSON.stringify({
        type: 'server-response',
        rpcId: envelope.rpcId,
        result: { ok: true, value: reply(method, args) },
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${port}`
  const transport = new HostTransport({
    origin,
    url: (path) => new URL(path, origin),
    headers: () => ({ cookie: 'dsh_session=fixture' }),
  })
  return {
    seen,
    transport,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

test('the allowlist admits the model services but not update, documents, export or discovery', async () => {
  const fixture = await host(() => null)
  try {
    const allowed = [
      'settings/describe',
      'settings/replace',
      'settings/mutate',
      'credentials/describe',
      'credentials/set',
      'credentials/unset',
      'llm/listProviders',
      'llm/listConfigurableProviders',
      'session/modelCatalog',
    ]
    for (const endpoint of allowed) await fixture.transport.rpc(endpoint, {})
    for (const endpoint of [
      'settings/update',
      'settings/openSettingsDocument',
      'settings/saveSettingsDocument',
      'credentials/export',
      'credentials/get',
      'llm/discoverModels',
      'llm/discoverConfigurableModels',
    ])
      await assert.rejects(
        fixture.transport.rpc(endpoint, {}),
        (error: unknown) =>
          error instanceof RemoteError && error.code === 'corn/endpoint-denied',
        endpoint,
      )
    assert.deepEqual(
      fixture.seen.map((call) => call.method),
      allowed,
    )
  } finally {
    await fixture.close()
  }
})

test('settings and credential writes send the official argument shapes', async () => {
  const fixture = await host((method) => {
    if (method === 'settings/replace' || method === 'settings/mutate')
      return {
        ns: 'agent-default-model',
        schema: { uid: 1, refs: { '1': { type: 'object' } } },
        value: {},
        base: {},
        user: {},
        revision: 4,
      }
    return null
  })
  try {
    const settings = new ModelSettingsClient(fixture.transport)
    const credentials = new CredentialsClient(fixture.transport)
    const view = await settings.replace(
      'agent-default-model',
      { provider: 'deepseek-official', model: 'deepseek-flash' },
      3,
    )
    assert.equal(view.revision, 4)
    await settings.mutate(
      'llm-pi-ai',
      [{ op: 'unset', path: ['providers', 'corn-gw'] }],
      2,
    )
    await credentials.set('CORN_GW_API_KEY', 'sk-corn-wp3-FAKE-0000')
    await credentials.unset('CORN_GW_API_KEY')
    assert.deepEqual(
      fixture.seen.map(({ path, args }) => [path, args]),
      [
        [
          '/api/settings/replace',
          {
            ns: 'agent-default-model',
            section: { provider: 'deepseek-official', model: 'deepseek-flash' },
            expectedRevision: 3,
          },
        ],
        [
          '/api/settings/mutate',
          {
            ns: 'llm-pi-ai',
            ops: [{ op: 'unset', path: ['providers', 'corn-gw'] }],
            expectedRevision: 2,
          },
        ],
        [
          '/api/credentials/set',
          { ref: 'CORN_GW_API_KEY', value: 'sk-corn-wp3-FAKE-0000' },
        ],
        ['/api/credentials/unset', { ref: 'CORN_GW_API_KEY' }],
      ],
    )
    await assert.rejects(
      credentials.set('BAD-REF', 'x'),
      (error: unknown) =>
        error instanceof RemoteError && error.code === 'corn/invalid-ref',
    )
    assert.equal(
      fixture.seen.length,
      4,
      'an invalid ref never reaches the Host',
    )
  } finally {
    await fixture.close()
  }
})

test('credential describe is chunked and keeps only status fields', async () => {
  const fixture = await host((_method, args) => {
    const refs = (args as { refs: string[] }).refs
    return Object.fromEntries(
      refs.map((ref) => [
        ref,
        { configured: true, source: 'file', writable: true, value: 'leak' },
      ]),
    )
  })
  try {
    const refs = Array.from(
      { length: 70 },
      (_, index) => `REF_${index}_API_KEY`,
    )
    const described = await new CredentialsClient(fixture.transport).describe(
      refs,
    )
    assert.deepEqual(
      fixture.seen.map(({ args }) => (args as { refs: string[] }).refs.length),
      [64, 6],
    )
    assert.equal(Object.keys(described).length, 70)
    assert.deepEqual(described.REF_0_API_KEY, {
      configured: true,
      source: 'file',
      writable: true,
    })
  } finally {
    await fixture.close()
  }
})

test('describe, provider lists and catalog are shape-checked', async () => {
  const fixture = await host((method) => {
    switch (method) {
      case 'settings/describe':
        return { writable: true, namespaces: [{ ns: 'x' }] }
      case 'session/modelCatalog':
        return {
          default: { provider: 'deepseek-official', model: 'deepseek-flash' },
          routableProviders: ['deepseek-official'],
          groups: [
            {
              id: 'deepseek-official',
              name: 'DeepSeek',
              models: [
                {
                  id: 'deepseek-flash',
                  name: 'Flash',
                  reasoning: {
                    efforts: [{ id: 'off' }, { id: 'high' }],
                    defaultEffort: 'high',
                  },
                },
              ],
            },
          ],
          failures: [],
        }
      default:
        return null
    }
  })
  try {
    await assert.rejects(
      new ModelSettingsClient(fixture.transport).describe(),
      (error: unknown) =>
        error instanceof RemoteError && error.code === 'corn/invalid-response',
    )
    const catalog = await new ModelCatalogClient(fixture.transport).read()
    assert.deepEqual(catalog.default, {
      provider: 'deepseek-official',
      model: 'deepseek-flash',
    })
    assert.deepEqual(catalog.groups[0]?.models[0]?.efforts, ['off', 'high'])
  } finally {
    await fixture.close()
  }
})
