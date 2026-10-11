import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ModelSettingsService } from '../apps/desktop/src/model-settings/service.ts'
import { createGovernedHost } from '../apps/desktop/src/runtime/claw-runtime-check.ts'
import {
  assertIsolatedHome,
  defaultDevelopmentHome,
} from '../apps/desktop/src/runtime/profile-bootstrap.ts'
import { ModelSettingsClient } from '../packages/dsh-adapter/src/model-settings-client.ts'
import { HostTransport } from '../packages/dsh-adapter/src/transport.ts'
import { copyClawProfile, createReviewHome } from './lib/review-fixtures.mjs'

// Run after `pnpm setup:runtime`. Round-trips Corn's model settings through
// the official settings and credentials services of a disposable governed
// Host, across Host restarts. Fake keys only; no model request is sent.
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = assertIsolatedHome(
  process.env.CORN_DSH_HOME || defaultDevelopmentHome(),
)
const FAKE_KEY = 'sk-corn-wp3-FAKE-0000'
const FAKE_ENV_KEY = 'sk-corn-wp3-FAKE-ENV-0000'
const CUSTOM = 'corn-wp3-gateway'
const home = await createReviewHome('model-settings')
await copyClawProfile(source, home)

const steps = []
const replies = []
let host
let auth
const service = new ModelSettingsService({
  authority: () => auth,
  devOverride: () => host?.modelOverride ?? null,
})

async function start(options = { model: null }) {
  host = createGovernedHost(home, options)
  auth = await host.start()
}

async function stop() {
  auth = undefined
  await host?.stop()
  host = undefined
}

function step(name, facts = {}) {
  steps.push({ name, ...facts })
  console.log(`PASS ${name}`)
}

/** Every reply is kept for the leak scan; failures are returned for inspection. */
async function call(promise) {
  const reply = await promise
  replies.push(reply)
  return reply
}

async function ok(promise) {
  const reply = await call(promise)
  assert.equal(reply.ok, true, JSON.stringify(reply))
  return reply.value
}

async function fails(promise, code) {
  const reply = await call(promise)
  assert.equal(reply.ok, false, `expected ${code}`)
  assert.equal(reply.error.code, code, JSON.stringify(reply.error))
  return reply.error
}

const provider = (snapshot, id) => {
  const row = snapshot.providers.find((entry) => entry.id === id)
  assert.ok(row, `provider ${id}`)
  return row
}

async function filesContaining(dir, needle) {
  const hits = []
  for (const entry of await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    if (path.includes(`${sep}node_modules${sep}`)) continue
    if ((await stat(path)).size > 4_000_000) continue
    if ((await readFile(path, 'utf8')).includes(needle))
      hits.push(path.slice(home.length + 1))
  }
  return hits
}

try {
  await start()
  const first = await ok(service.read())
  assert.deepEqual(first.status, {
    status: 'needs_configuration',
    reason: 'credential_missing',
    devOverride: false,
  })
  assert.deepEqual(provider(first, 'deepseek-official').credential, {
    kind: 'missing',
    writable: true,
  })
  step('keyless Host reads as needs_configuration', {
    providers: first.providers.length,
    default: first.defaultModel,
  })

  const keyed = await ok(
    service.setProviderKey({
      generation: first.generation,
      providerId: 'deepseek-official',
      revision: provider(first, 'deepseek-official').revision,
      key: FAKE_KEY,
    }),
  )
  assert.deepEqual(provider(keyed, 'deepseek-official').credential, {
    kind: 'configured',
    source: 'stored',
    writable: true,
  })
  assert.equal(keyed.status.status, 'available')
  step('credentials.set → describe reports a stored key')

  const pro = keyed.catalog
    .find((group) => group.providerId === 'deepseek-official')
    ?.models.find((model) => model.id !== keyed.defaultModel?.model)
  assert.ok(pro, 'a second DeepSeek model in the live catalog')
  const effort = pro.efforts.at(-1)
  await fails(
    service.setDefaultModel({
      generation: keyed.generation,
      revision: keyed.defaultRevision,
      selection: { provider: 'deepseek-official', model: 'not-in-catalog' },
    }),
    'model_not_in_catalog',
  )
  const chosen = {
    provider: 'deepseek-official',
    model: pro.id,
    ...(effort ? { reasoningEffort: effort } : {}),
  }
  const defaulted = await ok(
    service.setDefaultModel({
      generation: keyed.generation,
      revision: keyed.defaultRevision,
      selection: chosen,
    }),
  )
  assert.deepEqual(defaulted.defaultModel, chosen)
  await fails(
    service.setDefaultModel({
      generation: defaulted.generation,
      revision: keyed.defaultRevision,
      selection: first.defaultModel,
    }),
    'conflict',
  )
  step('default model replace validated, read back; stale revision conflicts', {
    chosen,
  })

  const protocol = defaulted.protocols[0]
  assert.ok(protocol, 'the pi-ai schema offers a protocol')
  const custom = await ok(
    service.saveCustomProvider({
      generation: defaulted.generation,
      mode: 'create',
      providerId: CUSTOM,
      revision: defaulted.customRevision,
      fields: {
        displayName: 'Corn WP3 gateway',
        protocol,
        baseURL: 'http://127.0.0.1:9/v1',
        models: [{ id: 'corn-wp3-model' }],
      },
      key: FAKE_KEY,
    }),
  )
  assert.equal(provider(custom, CUSTOM).kind, 'custom')
  assert.equal(provider(custom, CUSTOM).credential.kind, 'configured')
  step('custom provider saved via settings.mutate + credentials.set', {
    protocol,
  })

  const credentialsFile = join(home, '.credentials.yaml')
  const fileMode = (await stat(credentialsFile)).mode & 0o777
  const homeMode = (await stat(home)).mode & 0o777
  assert.equal(fileMode, 0o600)
  assert.equal(homeMode, 0o700)
  step('credential store is a 0600 file in a 0700 home', {
    file: '.credentials.yaml',
    fileMode: fileMode.toString(8),
    homeMode: homeMode.toString(8),
  })

  await stop()
  assert.equal(service.status().reason, 'runtime_not_ready')
  await start()
  await fails(
    service.setProviderKey({
      generation: custom.generation,
      providerId: 'deepseek-official',
      revision: 0,
      key: FAKE_KEY,
    }),
    'stale_generation',
  )
  const restarted = await ok(service.read())
  assert.equal(restarted.generation, custom.generation + 1)
  assert.equal(
    provider(restarted, 'deepseek-official').credential.kind,
    'configured',
  )
  assert.deepEqual(restarted.defaultModel, chosen)
  assert.equal(provider(restarted, CUSTOM).credential.kind, 'configured')
  step('Host restart: new generation, stale command refused, state persists')

  const removed = await ok(
    service.removeCustomProvider({
      generation: restarted.generation,
      providerId: CUSTOM,
      revision: provider(restarted, CUSTOM).revision,
    }),
  )
  assert.equal(
    removed.providers.some((row) => row.id === CUSTOM),
    false,
  )
  const settings = new ModelSettingsClient(new HostTransport(auth))
  await settings.replace('agent-default-model', {}, removed.defaultRevision)
  const cleared = await ok(
    service.clearProviderKey({
      generation: removed.generation,
      providerId: 'deepseek-official',
    }),
  )
  assert.deepEqual(cleared.defaultModel, first.defaultModel)
  assert.equal(
    provider(cleared, 'deepseek-official').credential.kind,
    'missing',
  )
  await stop()
  await start()
  const restored = await ok(service.read())
  assert.deepEqual(restored.status, first.status)
  assert.deepEqual(restored.defaultModel, first.defaultModel)
  assert.equal(
    restored.providers.some((row) => row.id === CUSTOM),
    false,
  )
  assert.deepEqual(await filesContaining(home, FAKE_KEY), [])
  step('restore: custom removed, default reset, key unset; survives restart')

  await stop()
  await start({
    model: {
      route: 'deepseek-official',
      model: 'deepseek-flash',
      apiKey: FAKE_ENV_KEY,
    },
  })
  const overridden = await ok(service.read())
  assert.equal(overridden.status.devOverride, true)
  assert.deepEqual(provider(overridden, 'deepseek-official').credential, {
    kind: 'configured',
    source: 'dev_override',
    writable: false,
  })
  await fails(
    service.setProviderKey({
      generation: overridden.generation,
      providerId: 'deepseek-official',
      revision: provider(overridden, 'deepseek-official').revision,
      key: FAKE_KEY,
    }),
    'read_only',
  )
  await fails(
    service.clearProviderKey({
      generation: overridden.generation,
      providerId: 'deepseek-official',
    }),
    'read_only',
  )
  step('development override is labelled and read-only')
  await stop()

  const text = JSON.stringify(replies)
  assert.doesNotMatch(text, /FAKE/u, 'a reply carried a key')
  assert.doesNotMatch(text, /_API_KEY|apiKeyEnv|credentials\.yaml/u)
  assert.deepEqual(await filesContaining(home, FAKE_ENV_KEY), [])
  step('no key in any reply; the override key was never persisted', {
    replies: replies.length,
  })
} finally {
  await stop()
  await rm(home, { recursive: true, force: true })
}

const artifacts = join(root, '.artifacts')
await mkdir(artifacts, { recursive: true, mode: 0o700 })
await writeFile(
  join(artifacts, 'model-settings-smoke.json'),
  `${JSON.stringify({ recordedAt: new Date().toISOString(), steps }, null, 2)}\n`,
  { mode: 0o600 },
)
console.log(`${steps.length} model settings steps passed.`)
