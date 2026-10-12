import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  ModelSettingsError,
  ModelSettingsResult,
  ModelSettingsSnapshot,
} from '../../../packages/contracts/src/model-settings.ts'
import { RemoteError } from '../../../packages/dsh-adapter/src/remote-error.ts'
import type { HostAuthority } from '../../../packages/dsh-adapter/src/transport.ts'
import {
  type DevOverrideFacts,
  deriveKeyRef,
} from '../src/model-settings/projection.ts'
import { ModelSettingsService } from '../src/model-settings/service.ts'
import { FakeModelHost } from './helpers/fake-model-host.ts'

const FAKE_KEY = 'sk-corn-wp3-FAKE-0000'

const authority = (): HostAuthority => ({
  origin: 'http://127.0.0.1:1',
  url: (path) => new URL(path, 'http://127.0.0.1:1'),
  headers: () => ({}),
})

function setup(override: DevOverrideFacts | null = null) {
  const host = new FakeModelHost()
  const world = { authority: authority() as HostAuthority | undefined, host }
  const service = new ModelSettingsService({
    authority: () => world.authority,
    devOverride: () => override,
    api: () => world.host,
  })
  return { world, host, service }
}

function value(result: ModelSettingsResult<ModelSettingsSnapshot>) {
  assert.equal(result.ok, true, JSON.stringify(result))
  return (result as { value: ModelSettingsSnapshot }).value
}

function failure(result: ModelSettingsResult<ModelSettingsSnapshot>) {
  assert.equal(result.ok, false, 'expected a failure')
  return (result as { error: ModelSettingsError }).error
}

const provider = (snapshot: ModelSettingsSnapshot, id: string) => {
  const row = snapshot.providers.find((entry) => entry.id === id)
  assert.ok(row, `provider ${id}`)
  return row
}

test('ref derivation follows the official <ROUTE>_API_KEY rule', () => {
  assert.equal(deriveKeyRef('minimax-cn'), 'MINIMAX_CN_API_KEY')
  assert.equal(
    deriveKeyRef('xiaomi-token-plan-cn'),
    'XIAOMI_TOKEN_PLAN_CN_API_KEY',
  )
  assert.equal(deriveKeyRef('a.b--c'), 'A_B_C_API_KEY')
})

test('keyless Host reads as needs_configuration; the snapshot names no ref, namespace or path', async () => {
  const { service } = setup()
  assert.deepEqual(service.status(), {
    status: 'checking',
    reason: 'reading',
    devOverride: false,
  })
  const snapshot = value(await service.read())
  assert.deepEqual(snapshot.status, {
    status: 'needs_configuration',
    reason: 'credential_missing',
    devOverride: false,
  })
  assert.equal(service.status().status, 'needs_configuration')
  assert.equal(
    snapshot.providers.some((row) => row.id === 'deepseek-account'),
    false,
  )
  assert.deepEqual(provider(snapshot, 'deepseek-official').credential, {
    kind: 'missing',
    writable: true,
  })
  assert.deepEqual(snapshot.protocols, [
    'openai-completions',
    'openai-responses',
    'anthropic-messages',
  ])
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /_API_KEY|apiKeyEnv|llm-pi-ai|llm-deepseek|agent-default-model|settingsPath/u,
  )
})

test('builtin key: one credentials.set on the profile ref, no settings write, read back as stored', async () => {
  const { host, service } = setup()
  const before = value(await service.read())
  const after = value(
    await service.setProviderKey({
      generation: before.generation,
      providerId: 'deepseek-official',
      revision: provider(before, 'deepseek-official').revision,
      key: FAKE_KEY,
    }),
  )
  assert.deepEqual(
    host.writes().map((call) => [call.method, call.args[0]]),
    [['credentials.set', 'DEEPSEEK_API_KEY']],
  )
  assert.equal(host.credentialStore.get('DEEPSEEK_API_KEY')?.value, FAKE_KEY)
  assert.deepEqual(provider(after, 'deepseek-official').credential, {
    kind: 'configured',
    source: 'stored',
    writable: true,
  })
  assert.equal(after.status.status, 'available')
  assert.doesNotMatch(JSON.stringify(after), /FAKE/u)
})

test('catalog route key names the derived ref in settings first, then stores the key', async () => {
  const { host, service } = setup()
  const before = value(await service.read())
  const after = value(
    await service.setProviderKey({
      generation: before.generation,
      providerId: 'xiaomi-token-plan-cn',
      revision: provider(before, 'xiaomi-token-plan-cn').revision,
      key: FAKE_KEY,
    }),
  )
  assert.deepEqual(
    host.writes().map((call) => call.args.slice(0, 2)),
    [
      [
        'llm-pi-ai',
        [
          {
            op: 'set',
            path: ['providers', 'xiaomi-token-plan-cn'],
            value: { apiKeyEnv: 'XIAOMI_TOKEN_PLAN_CN_API_KEY' },
          },
        ],
      ],
      ['XIAOMI_TOKEN_PLAN_CN_API_KEY', '<redacted>'],
    ],
  )
  const row = provider(after, 'xiaomi-token-plan-cn')
  assert.equal(row.active, true)
  assert.equal(row.credential.kind, 'configured')
})

test('settings saved but credential failed is partially_applied with a read-back', async () => {
  const { host, service } = setup()
  const before = value(await service.read())
  host.failures.set(
    'credentials.set',
    new RemoteError('gateway/internal', `boom ${FAKE_KEY}`),
  )
  const result = await service.setProviderKey({
    generation: before.generation,
    providerId: 'anthropic',
    revision: provider(before, 'anthropic').revision,
    key: FAKE_KEY,
  })
  const error = failure(result)
  assert.equal(error.code, 'partially_applied')
  assert.equal(error.failedStep, 'credential')
  assert.equal(error.cause, 'host_error')
  const snapshot = error.snapshot as ModelSettingsSnapshot
  assert.equal(provider(snapshot, 'anthropic').configured, true)
  assert.equal(provider(snapshot, 'anthropic').credential.kind, 'missing')
  assert.doesNotMatch(JSON.stringify(result), /FAKE|boom/u)
  // Retry from the read-back: the profile already names the ref, so only the key is written.
  host.calls.length = 0
  value(
    await service.setProviderKey({
      generation: snapshot.generation,
      providerId: 'anthropic',
      revision: provider(snapshot, 'anthropic').revision,
      key: FAKE_KEY,
    }),
  )
  assert.deepEqual(
    host.writes().map((call) => call.method),
    ['credentials.set'],
  )
})

test('an environment-supplied key is read-only: nothing is written', async () => {
  const { host, service } = setup({
    ref: 'DEEPSEEK_API_KEY',
    lockedNamespaces: [],
  })
  host.credentialStore.set('DEEPSEEK_API_KEY', {
    value: 'sk-corn-wp3-FAKE-ENV-0000',
    source: 'env',
  })
  const before = value(await service.read())
  assert.deepEqual(provider(before, 'deepseek-official').credential, {
    kind: 'configured',
    source: 'dev_override',
    writable: false,
  })
  assert.equal(before.status.devOverride, true)
  for (const result of [
    await service.setProviderKey({
      generation: before.generation,
      providerId: 'deepseek-official',
      revision: 0,
      key: FAKE_KEY,
    }),
    await service.clearProviderKey({
      generation: before.generation,
      providerId: 'deepseek-official',
    }),
  ])
    assert.equal(failure(result).code, 'read_only')
  assert.deepEqual(host.writes(), [])
})

test('an override-locked namespace refuses provider writes before the Host is asked', async () => {
  const { host, service } = setup({
    ref: 'XIAOMI_TOKEN_PLAN_CN_API_KEY',
    lockedNamespaces: ['llm-pi-ai'],
  })
  const before = value(await service.read())
  assert.equal(provider(before, 'anthropic').settingsWritable, false)
  const result = await service.setProviderKey({
    generation: before.generation,
    providerId: 'anthropic',
    revision: 0,
    key: FAKE_KEY,
  })
  assert.equal(failure(result).code, 'read_only')
  assert.deepEqual(host.writes(), [])
})

test('default model is validated against the live catalog before replace, then read back', async () => {
  const { host, service } = setup()
  const before = value(await service.read())
  const command = (selection: {
    provider: string
    model: string
    reasoningEffort?: string
  }) => ({
    generation: before.generation,
    revision: before.defaultRevision,
    selection,
  })
  for (const selection of [
    { provider: 'deepseek-official', model: 'not-in-catalog' },
    { provider: 'nobody', model: 'deepseek-flash' },
    {
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      reasoningEffort: 'ultra',
    },
  ])
    assert.equal(
      failure(await service.setDefaultModel(command(selection))).code,
      'model_not_in_catalog',
    )
  assert.deepEqual(host.writes(), [])
  const after = value(
    await service.setDefaultModel(
      command({
        provider: 'deepseek-official',
        model: 'deepseek-v4-pro',
        reasoningEffort: 'max',
      }),
    ),
  )
  assert.deepEqual(
    host.writes().map((call) => call.args),
    [
      [
        'agent-default-model',
        {
          provider: 'deepseek-official',
          model: 'deepseek-v4-pro',
          reasoningEffort: 'max',
        },
        0,
      ],
    ],
  )
  assert.deepEqual(after.defaultModel, {
    provider: 'deepseek-official',
    model: 'deepseek-v4-pro',
    reasoningEffort: 'max',
  })
  // A complete selection without effort replaces, so the old effort cannot survive.
  const plain = value(
    await service.setDefaultModel({
      generation: after.generation,
      revision: after.defaultRevision,
      selection: { provider: 'deepseek-official', model: 'deepseek-flash' },
    }),
  )
  assert.deepEqual(plain.defaultModel, {
    provider: 'deepseek-official',
    model: 'deepseek-flash',
  })
})

test('a stale revision is a recoverable conflict, never a blind overwrite', async () => {
  const { host, service } = setup()
  const before = value(await service.read())
  const row = host.namespaces.get('agent-default-model')
  assert.ok(row)
  row.revision = 3
  const stale = failure(
    await service.setDefaultModel({
      generation: before.generation,
      revision: before.defaultRevision,
      selection: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    }),
  )
  assert.equal(stale.code, 'conflict')
  assert.equal(
    (stale.snapshot as ModelSettingsSnapshot).defaultRevision,
    3,
    'the conflict carries the fresh revision to retry from',
  )
  assert.deepEqual(host.writes(), [])
  // The Host's own fence (another writer between read and write) maps the same way.
  host.before.set('replace', () => {
    row.revision++
  })
  const raced = failure(
    await service.setDefaultModel({
      generation: before.generation,
      revision: 3,
      selection: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    }),
  )
  assert.equal(raced.code, 'conflict')
})

test('a write whose request times out is resolved by reading back, not by retrying', async () => {
  const { host, service } = setup()
  const before = value(await service.read())
  host.before.set('credentials.set', () => {
    host.credentialStore.set('DEEPSEEK_API_KEY', {
      value: FAKE_KEY,
      source: 'file',
    })
  })
  host.failures.set(
    'credentials.set',
    new DOMException('The operation timed out.', 'TimeoutError'),
  )
  const error = failure(
    await service.setProviderKey({
      generation: before.generation,
      providerId: 'deepseek-official',
      revision: 0,
      key: FAKE_KEY,
    }),
  )
  assert.equal(error.code, 'outcome_unknown')
  const snapshot = error.snapshot as ModelSettingsSnapshot
  assert.equal(
    provider(snapshot, 'deepseek-official').credential.kind,
    'configured',
    'the read-back shows what actually landed',
  )
  assert.equal(
    host.writes().filter((call) => call.method === 'credentials.set').length,
    1,
  )
})

test('results are pinned to a Host generation', async () => {
  const { world, service } = setup()
  const first = value(await service.read())
  world.authority = authority()
  world.host = new FakeModelHost()
  assert.equal(service.status().reason, 'reading')
  const stale = failure(
    await service.setProviderKey({
      generation: first.generation,
      providerId: 'deepseek-official',
      revision: 0,
      key: FAKE_KEY,
    }),
  )
  assert.equal(stale.code, 'stale_generation')
  assert.equal(world.host.writes().length, 0)
  const second = value(await service.read())
  assert.equal(second.generation, first.generation + 1)
  // A Host change during the write leaves the outcome unknown and returns no old-generation state.
  world.host.before.set('credentials.set', () => {
    world.authority = authority()
  })
  const lost = failure(
    await service.setProviderKey({
      generation: second.generation,
      providerId: 'deepseek-official',
      revision: 0,
      key: FAKE_KEY,
    }),
  )
  assert.equal(lost.code, 'outcome_unknown')
  assert.equal(lost.snapshot, undefined)
  world.authority = undefined
  assert.deepEqual(service.status(), {
    status: 'checking',
    reason: 'runtime_not_ready',
    devOverride: false,
  })
  assert.equal(failure(await service.read()).code, 'runtime_unavailable')
})

test('writes are serialized in Main', async () => {
  const { host, service } = setup()
  const before = value(await service.read())
  let active = 0
  let peak = 0
  const slow = async () => {
    active++
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active--
  }
  host.before.set('credentials.set', slow)
  host.before.set('credentials.unset', slow)
  const results = await Promise.all([
    service.setProviderKey({
      generation: before.generation,
      providerId: 'deepseek-official',
      revision: 0,
      key: FAKE_KEY,
    }),
    service.clearProviderKey({
      generation: before.generation,
      providerId: 'deepseek-official',
    }),
  ])
  assert.equal(peak, 1)
  assert.deepEqual(
    host.writes().map((call) => call.method),
    ['credentials.set', 'credentials.unset'],
  )
  assert.equal(
    provider(value(results[1]), 'deepseek-official').credential.kind,
    'missing',
  )
})

test('custom provider: schema-checked create, edit, then removal also clears its own key', async () => {
  const { host, service } = setup()
  const before = value(await service.read())
  const fields = {
    displayName: 'Corn Gateway',
    protocol: 'openai-completions',
    baseURL: 'http://127.0.0.1:9/v1',
    models: [{ id: 'corn-model' }],
  }
  const create = (overrides: Record<string, unknown>) =>
    service.saveCustomProvider({
      generation: before.generation,
      mode: 'create',
      providerId: 'corn-gw',
      revision: before.customRevision,
      fields,
      ...overrides,
    })
  assert.equal(
    failure(await create({ fields: { ...fields, protocol: 'gopher' } })).code,
    'invalid_input',
  )
  assert.equal(
    failure(await create({ providerId: 'anthropic' })).code,
    'provider_exists',
  )
  assert.deepEqual(host.writes(), [])
  const created = value(await create({ key: FAKE_KEY }))
  const row = provider(created, 'corn-gw')
  assert.equal(row.kind, 'custom')
  assert.deepEqual(row.custom, fields)
  assert.equal(row.credential.kind, 'configured')
  assert.deepEqual(host.writes()[0]?.args[1], [
    {
      op: 'set',
      path: ['providers', 'corn-gw'],
      value: {
        displayName: 'Corn Gateway',
        api: 'openai-completions',
        baseURL: 'http://127.0.0.1:9/v1',
        models: [{ id: 'corn-model' }],
        apiKeyEnv: 'CORN_GW_API_KEY',
      },
    },
  ])
  const edited = value(
    await service.saveCustomProvider({
      generation: created.generation,
      mode: 'update',
      providerId: 'corn-gw',
      revision: row.revision,
      fields: { ...fields, displayName: '', models: [{ id: 'corn-model-2' }] },
    }),
  )
  assert.deepEqual(provider(edited, 'corn-gw').custom?.models, [
    { id: 'corn-model-2' },
  ])
  assert.equal(
    failure(
      await service.saveCustomProvider({
        generation: edited.generation,
        mode: 'update',
        providerId: 'anthropic',
        revision: provider(edited, 'anthropic').revision,
        fields,
      }),
    ).code,
    'unsupported_provider',
  )
  const removed = value(
    await service.removeCustomProvider({
      generation: edited.generation,
      providerId: 'corn-gw',
      revision: provider(edited, 'corn-gw').revision,
    }),
  )
  assert.equal(
    removed.providers.some((entry) => entry.id === 'corn-gw'),
    false,
  )
  assert.equal(host.credentialStore.has('CORN_GW_API_KEY'), false)
})

test('custom read-back compares every saved field; another writer between write and read is readback_mismatch', async () => {
  const fields = {
    displayName: 'Corn Gateway',
    protocol: 'openai-completions',
    baseURL: 'http://127.0.0.1:9/v1',
    models: [{ id: 'wanted-model' }, { id: 'second', name: 'Second' }],
  }
  const tampers: Array<[string, (profile: Record<string, unknown>) => void]> = [
    [
      'protocol',
      (profile) => Object.assign(profile, { api: 'anthropic-messages' }),
    ],
    [
      'model id',
      (profile) =>
        Object.assign(profile, {
          models: [{ id: 'other-model' }, { id: 'second', name: 'Second' }],
        }),
    ],
    [
      'model name',
      (profile) =>
        Object.assign(profile, {
          models: [{ id: 'wanted-model' }, { id: 'second', name: 'Renamed' }],
        }),
    ],
    [
      'model order',
      (profile) =>
        Object.assign(profile, {
          models: [{ id: 'second', name: 'Second' }, { id: 'wanted-model' }],
        }),
    ],
    [
      'extra model',
      (profile) =>
        Object.assign(profile, { models: [...fields.models, { id: 'third' }] }),
    ],
    [
      'display name',
      (profile) => Object.assign(profile, { displayName: 'Someone else' }),
    ],
  ]
  for (const [label, tamper] of tampers) {
    const { host, service } = setup()
    const before = value(await service.read())
    host.before.set('describe', () => {
      if (!host.calls.some((call) => call.method === 'mutate')) return
      const providers = host.namespaces.get('llm-pi-ai')?.user.providers as
        | Record<string, Record<string, unknown>>
        | undefined
      const profile = providers?.['corn-gw']
      if (profile) tamper(profile)
      host.before.delete('describe')
    })
    const error = failure(
      await service.saveCustomProvider({
        generation: before.generation,
        mode: 'create',
        providerId: 'corn-gw',
        revision: before.customRevision,
        fields,
      }),
    )
    assert.equal(error.code, 'readback_mismatch', label)
    const actual = provider(error.snapshot as ModelSettingsSnapshot, 'corn-gw')
    assert.equal(actual.custom?.baseURL, fields.baseURL, label)
    assert.notDeepEqual(actual.custom, fields, label)
  }
  // Normalization that the parser and projection share is not a difference.
  const { service } = setup()
  const before = value(await service.read())
  const saved = value(
    await service.saveCustomProvider({
      generation: before.generation,
      mode: 'create',
      providerId: 'corn-gw',
      revision: before.customRevision,
      fields: { ...fields, displayName: '' },
    }),
  )
  assert.equal(provider(saved, 'corn-gw').custom?.displayName, '')
})

test('raw Host failures map to closed codes; no key, message or stack leaves the service', async () => {
  const { host, service } = setup()
  const logged: unknown[] = []
  const original = { ...console }
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const)
    console[level] = (...args: unknown[]) => logged.push(args)
  try {
    const before = value(await service.read())
    const replies: unknown[] = []
    for (const error of [
      new RemoteError('gateway/bad-request', `issue near ${FAKE_KEY}`),
      new RemoteError(
        'settings/rejected',
        'Configuration is overridden by a command-line overlay',
      ),
      new TypeError(`fetch failed ${FAKE_KEY}`),
      new RemoteError('corn/http-500', 'Host rejected'),
    ]) {
      host.failures.set('credentials.set', error)
      replies.push(
        await service.setProviderKey({
          generation: before.generation,
          providerId: 'deepseek-official',
          revision: 0,
          key: FAKE_KEY,
        }),
      )
    }
    assert.deepEqual(
      replies.map((reply) => failure(reply as never).code),
      ['invalid_input', 'read_only', 'outcome_unknown', 'outcome_unknown'],
    )
    host.failures.set('describe', new Error(`stack ${FAKE_KEY}`))
    replies.push(await service.read())
    const text = JSON.stringify(replies)
    assert.doesNotMatch(text, /FAKE|stack|issue|overlay|fetch/u)
    assert.deepEqual(logged, [])
  } finally {
    Object.assign(console, original)
  }
})
