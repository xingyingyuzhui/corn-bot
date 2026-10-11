import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { HostAuth } from '../../apps/desktop/src/runtime/host-auth.ts'
import {
  probeDiscoveryCancellation,
  startDiscoveryStub,
} from '../lib/model-audit-cancellation.mjs'
import {
  AuditRefusal,
  FAKE,
  refuseExternalHome,
  verifyRuntimeVersions,
} from '../lib/model-audit-fixtures.mjs'
import { runAudit, scanForFakeKeys } from '../lib/model-audit-report.mjs'
import { buildProfileTemplate } from '../lib/profile-template-build.mjs'

// Run: node scripts/audit/model-config-api-audit.mjs   (takes no home; CORN_DSH_HOME is refused)
// Standalone audit of the RC2 model-configuration Remote surface; not part of `pnpm check`.
// It creates its own temp lab, seeds the profile from a freshly built, verified
// template (locked DSH + Claw release), uses fake credentials only, restores the
// lab to its initial values, then destroys the lab. No provider endpoint is
// contacted: discovery uses the pi-ai catalog and a loopback stub.
try {
  refuseExternalHome(process.argv.slice(2), process.env)
} catch (error) {
  if (!(error instanceof AuditRefusal)) throw error
  console.error(error.message)
  process.exit(2)
}

const REPORT = fileURLToPath(
  new URL('../../.artifacts/model-config-api-audit.json', import.meta.url),
)
const REQUIRED = [
  'runtime-versions',
  'discovery-cancellation',
  'global-default-write',
  'global-default-restart-persistence',
  'lab-restored',
  'fake-key-leak-scan',
]
const REF = {
  file: 'CORN_AUDIT_FAKE_API_KEY',
  env: 'CORN_AUDIT_ENV_API_KEY',
  dotenv: 'CORN_AUDIT_DOTENV_API_KEY',
}
const DEFAULT_NS = 'agent-default-model'
const TARGET = {
  provider: 'deepseek-official',
  model: 'deepseek-v4-pro',
  reasoningEffort: 'max',
}
const CUSTOM = 'corn-audit-gateway'

const wire = []
const hosts = []
let lab
let audit
let home
let profile
let host
let auth
let stub

const record = (step, facts) => audit.record(step, facts)

/** Raw Connection RPC; failures are returned as observed envelopes rather than thrown. */
async function rpc(endpoint, args, signal) {
  const rpcId = randomUUID()
  const response = await fetch(auth.url(`/api/${endpoint}`), {
    method: 'POST',
    headers: { ...auth.headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method: endpoint,
      payload: { args },
    }),
    redirect: 'error',
    signal: signal ?? AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  wire.push(text)
  let envelope
  try {
    envelope = JSON.parse(text)
  } catch {
    return {
      http: response.status,
      ok: false,
      code: null,
      message: text,
      contentType: response.headers.get('content-type'),
    }
  }
  assert.equal(envelope.rpcId, rpcId)
  const result = envelope.result ?? { ok: true }
  return result.ok === false
    ? {
        http: response.status,
        ok: false,
        code: result.error.code,
        message: result.error.message,
        details: result.error.details,
      }
    : { http: response.status, ok: true, value: result.value }
}

async function claw(path, body) {
  const response = await fetch(auth.url(`/api/dsh-claw/registry/${path}`), {
    method: 'POST',
    headers: { ...auth.headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  wire.push(text)
  return { http: response.status, ...JSON.parse(text) }
}

const value = (result) => {
  assert.equal(result.ok, true, `${result.code}: ${result.message}`)
  return result.value
}
const failure = ({ http, code, message, details, contentType }) => ({
  http,
  code,
  message,
  details,
  contentType,
})

async function boot({ env = {}, overlay = [] } = {}) {
  host = await lab.startHost({ env, overlay })
  hosts.push(host)
  auth = await HostAuth.exchange(host.launch)
}

async function halt() {
  await host?.stop()
  host = undefined
  auth = undefined
}

async function restart(options) {
  await halt()
  await boot(options)
}

const namespace = async (ns) =>
  value(await rpc('settings/describe', {})).namespaces.find(
    (row) => row.ns === ns,
  )
const catalogDefault = async () =>
  value(await rpc('session/modelCatalog', {})).default
const profilePatchRow = async (id) => {
  const text = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')
  return text.includes(`id: ${id}`)
}
const fileMode = async (path) => ((await stat(path)).mode & 0o777).toString(8)

async function eventually(read, predicate, label, ms = 10_000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const current = await read()
    if (predicate(current)) return current
    await delay(100)
  }
  throw new Error(`Deadline exceeded: ${label}`)
}

async function auditBody(ownedLab, run) {
  lab = ownedLab
  audit = run
  home = lab.home
  profile = lab.profile
  const template = join(lab.root, 'template')
  await buildProfileTemplate(template)
  await lab.seedProfile(template)
  const versions = await verifyRuntimeVersions({ profile })
  audit.facts.versions = versions
  audit.pass('runtime-versions', {
    dsh: versions.dsh,
    claw: versions.claw,
    clawComponents: versions.clawComponents,
  })
  await mkdir(join(home, 'documents'), { mode: 0o700 })
  stub = await startDiscoveryStub({ fakeKey: FAKE.discovery })
  lab.track(() => stub.close())

  // Phase A: first keyless boot.
  await boot()
  const described = value(await rpc('settings/describe', {}))
  record('settings.describe', {
    request: 'settings/describe {}',
    observed: {
      writable: described.writable,
      hasDocument: described.hasDocument,
      namespaces: described.namespaces.map((row) => ({
        ns: row.ns,
        autoGenerate: row.autoGenerate,
        revision: row.revision,
        secrets: row.secrets.length,
      })),
    },
  })
  const initialDefault = described.namespaces.find(
    (row) => row.ns === DEFAULT_NS,
  )
  assert.ok(initialDefault, 'agent-default-model must be a settings namespace')
  record('settings.describe agent-default-model', {
    observed: {
      autoGenerate: initialDefault.autoGenerate,
      value: initialDefault.value,
      base: initialDefault.base,
      user: initialDefault.user,
      revision: initialDefault.revision,
      fields: Object.keys(
        initialDefault.schema.refs[initialDefault.schema.uid].dict,
      ),
    },
  })
  record('settings.describe llm schemas', {
    observed: Object.fromEntries(
      ['llm-deepseek', 'llm-pi-ai'].map((ns) => {
        const row = described.namespaces.find((item) => item.ns === ns)
        return [
          ns,
          {
            autoGenerate: row.autoGenerate,
            fields: Object.keys(row.schema.refs[row.schema.uid].dict),
            credentialRefFields: Object.values(row.schema.refs)
              .filter((node) => node.meta?.role === 'credential-ref')
              .map((node) => node.meta.default ?? null),
          },
        ]
      }),
    ),
  })

  const providers = value(await rpc('llm/listProviders', {}))
  const configurable = value(await rpc('llm/listConfigurableProviders', {}))
  record('llm.listProviders + listConfigurableProviders (keyless)', {
    observed: {
      listProviders: providers,
      configurableCount: configurable.length,
      configurableNamespaces: [
        ...new Set(configurable.map((row) => row.settingsNs)),
      ],
      sample: configurable.filter((row) =>
        ['deepseek', 'openai', 'xiaomi-token-plan-cn'].includes(row.provider),
      ),
      inactive: configurable.filter(
        (row) => !providers.some((item) => item.id === row.provider),
      ).length,
    },
  })
  const catalog = value(await rpc('session/modelCatalog', {}))
  record('session.modelCatalog (keyless)', {
    observed: {
      default: catalog.default,
      routableProviders: catalog.routableProviders,
      groups: catalog.groups.map((group) => ({
        id: group.id,
        models: group.models.map((model) => model.id),
      })),
      failures: catalog.failures,
    },
  })
  record('claw registry/models (before)', {
    observed: { official: (await claw('models', {})).official },
  })

  const piCatalogRoute = configurable.find(
    (row) => row.settingsNs === 'llm-pi-ai' && row.provider === 'deepseek',
  )
  const fromCatalog = await rpc('llm/discoverModels', {
    settingsNs: 'llm-pi-ai',
    request: { provider: piCatalogRoute.provider },
  })
  record('llm.discoverModels catalog route (no network)', {
    request: `llm/discoverModels { settingsNs: 'llm-pi-ai', request: { provider: '${piCatalogRoute.provider}' } }`,
    observed: {
      ok: fromCatalog.ok,
      models: fromCatalog.value?.map((model) => model.id),
    },
  })
  record('llm.discoverModels unknown namespace', {
    observed: failure(
      await rpc('llm/discoverModels', {
        settingsNs: 'corn-audit-missing',
        request: { provider: 'x' },
      }),
    ),
  })
  const deepseekDiscovery = await rpc('llm/discoverModels', {
    settingsNs: 'llm-deepseek',
    request: { provider: 'deepseek-official' },
  })
  record('llm.discoverModels llm-deepseek namespace', {
    observed: deepseekDiscovery.ok
      ? { ok: true, models: deepseekDiscovery.value.map((model) => model.id) }
      : failure(deepseekDiscovery),
  })
  const discovered = await rpc('llm/discoverModels', {
    settingsNs: 'llm-pi-ai',
    request: {
      baseURL: `http://127.0.0.1:${stub.port}/v1`,
      api: 'openai-completions',
      apiKey: FAKE.discovery,
    },
  })
  record('llm.discoverModels loopback stub with one-shot fake key', {
    request:
      "llm/discoverModels { settingsNs: 'llm-pi-ai', request: { baseURL: 'http://127.0.0.1:<stub>/v1', api: 'openai-completions', apiKey: '<FAKE>' } }",
    observed: {
      ok: discovered.ok,
      models: discovered.value?.map((model) => model.id),
      stubSawBearerFakeKey: stub.seen.authorized,
      fakeKeyEchoed: JSON.stringify(discovered).includes(FAKE.discovery),
    },
  })
  // Discovery HTTP only: settings/credentials writes are not cancellable and a
  // timed-out write stays an unknown outcome that must be read back.
  const { capability, status, ...cancellation } =
    await probeDiscoveryCancellation({
      stub,
      call: (signal) =>
        rpc(
          'llm/discoverModels',
          {
            settingsNs: 'llm-pi-ai',
            request: {
              baseURL: `http://127.0.0.1:${stub.port}/hang/v1`,
              api: 'openai-completions',
              apiKey: FAKE.discovery,
            },
          },
          signal,
        ),
    })
  record('llm.discoverModels cancellation (client aborts HTTP RPC)', {
    observed: cancellation,
  })
  audit.pass(capability, cancellation)

  // Harmless settings round-trip: ui-theme.fontSize (presentation only).
  const theme = await namespace('ui-theme')
  const updated = value(
    await rpc('settings/update', {
      ns: 'ui-theme',
      patch: { fontSize: 15 },
      expectedRevision: theme.revision,
    }),
  )
  const stale = await rpc('settings/update', {
    ns: 'ui-theme',
    patch: { fontSize: 16 },
    expectedRevision: theme.revision,
  })
  const mutated = value(
    await rpc('settings/mutate', {
      ns: 'ui-theme',
      ops: [{ op: 'unset', path: ['fontSize'] }],
      expectedRevision: updated.revision,
    }),
  )
  record('settings.update/mutate round-trip ui-theme.fontSize', {
    request: [
      `settings/update { ns: 'ui-theme', patch: { fontSize: 15 }, expectedRevision: ${theme.revision} }`,
      `settings/update (same stale expectedRevision ${theme.revision})`,
      `settings/mutate { ns: 'ui-theme', ops: [{ op: 'unset', path: ['fontSize'] }], expectedRevision: ${updated.revision} }`,
    ],
    observed: {
      before: {
        value: theme.value,
        user: theme.user,
        revision: theme.revision,
      },
      afterUpdate: {
        value: updated.value,
        user: updated.user,
        revision: updated.revision,
      },
      staleWrite: failure(stale),
      afterMutateUnset: {
        value: mutated.value,
        user: mutated.user,
        revision: mutated.revision,
      },
      profilePatchHasRowAfterRevert: await profilePatchRow('ui-theme'),
    },
  })
  record('settings refusals', {
    observed: {
      unknownNamespace: failure(
        await rpc('settings/update', {
          ns: 'corn-audit-missing',
          patch: { a: 1 },
          expectedRevision: undefined,
        }),
      ),
      nonVolatileField: failure(
        await rpc('settings/update', {
          ns: 'ui-theme',
          patch: { notAField: 1 },
          expectedRevision: undefined,
        }),
      ),
      schemaViolation: failure(
        await rpc('settings/update', {
          ns: 'ui-theme',
          patch: { fontSize: 99 },
          expectedRevision: undefined,
        }),
      ),
      unknownMethod: failure(await rpc('settings/notAMethod', {})),
    },
  })

  // Gate: global default model through the public settings Remote.
  const beforeWrite = await namespace(DEFAULT_NS)
  const written = value(
    await rpc('settings/update', {
      ns: DEFAULT_NS,
      patch: TARGET,
      expectedRevision: beforeWrite.revision,
    }),
  )
  assert.deepEqual(written.value, TARGET)
  assert.deepEqual(await catalogDefault(), TARGET)
  const officialAfterWrite = (await claw('models', {})).official
  assert.deepEqual(officialAfterWrite, TARGET)
  const staleDefault = await rpc('settings/update', {
    ns: DEFAULT_NS,
    patch: { model: 'deepseek-flash' },
    expectedRevision: beforeWrite.revision,
  })
  assert.equal(staleDefault.code, 'settings/conflict')
  record('GATE write global default via settings.update', {
    request: `settings/update { ns: '${DEFAULT_NS}', patch: ${JSON.stringify(TARGET)}, expectedRevision: ${beforeWrite.revision} }`,
    observed: {
      returnedView: {
        value: written.value,
        user: written.user,
        revision: written.revision,
      },
      sessionModelCatalogDefault: await catalogDefault(),
      clawRegistryModelsOfficial: officialAfterWrite,
      profilePatchHasRow: await profilePatchRow(DEFAULT_NS),
      profilePatchMode: await fileMode(join(profile, 'cordis.patch.yml')),
      staleRevisionWrite: failure(staleDefault),
    },
  })
  audit.pass('global-default-write', {
    returnedValueIsTarget: true,
    sessionModelCatalogDefaultIsTarget: true,
    clawRegistryOfficialIsTarget: true,
    staleRevisionConflict: true,
  })

  // Credentials with a fake key.
  const describeRefs = async (refs) =>
    value(await rpc('credentials/describe', { refs }))
  const credentialsFile = join(home, '.credentials.yaml')
  const beforeSet = await describeRefs([REF.file])
  const set = await rpc('credentials/set', { ref: REF.file, value: FAKE.file })
  assert.equal(set.ok, true)
  const afterSet = await describeRefs([REF.file])
  const stored = await readFile(credentialsFile, 'utf8')
  record('credentials.describe/set (fake key)', {
    request: [
      `credentials/describe { refs: ['${REF.file}'] }`,
      `credentials/set { ref: '${REF.file}', value: '<FAKE>' }`,
    ],
    observed: {
      before: beforeSet,
      setResult: { ok: set.ok, value: set.value ?? null },
      after: afterSet,
      file: '$DSH_HOME/.credentials.yaml',
      fileMode: await fileMode(credentialsFile),
      homeMode: await fileMode(home),
      fileHoldsRefName: stored.includes(`${REF.file}:`),
      fileHoldsPlaintextFakeValue: stored.includes(FAKE.file),
    },
  })
  const tooMany = Array.from(
    { length: 65 },
    (_, index) => `CORN_AUDIT_${index}`,
  )
  record('credentials refusals', {
    observed: {
      invalidRef: failure(
        await rpc('credentials/set', { ref: 'bad-ref', value: FAKE.file }),
      ),
      emptyValue: failure(
        await rpc('credentials/set', { ref: REF.file, value: '' }),
      ),
      describeOver64: failure(
        await rpc('credentials/describe', { refs: tooMany }),
      ),
    },
  })

  // Configurable-but-inactive -> active: hand-declared pi-ai route keyed to the fake ref.
  const piBefore = await namespace('llm-pi-ai')
  const declared = await rpc('settings/mutate', {
    ns: 'llm-pi-ai',
    ops: [
      {
        op: 'set',
        path: ['providers', CUSTOM],
        value: {
          displayName: 'Corn Audit Gateway',
          api: 'openai-completions',
          baseURL: `http://127.0.0.1:${stub.port}/v1`,
          apiKeyEnv: REF.file,
          models: [{ id: 'corn-audit-model', name: 'Corn Audit Model' }],
        },
      },
    ],
    expectedRevision: piBefore.revision,
  })
  const customState = async () => ({
    configurable:
      value(await rpc('llm/listConfigurableProviders', {})).find(
        (row) => row.provider === CUSTOM,
      ) ?? null,
    routable: value(await rpc('llm/listProviders', {})).some(
      (row) => row.id === CUSTOM,
    ),
    catalogGroup:
      value(await rpc('session/modelCatalog', {}))
        .groups.find((group) => group.id === CUSTOM)
        ?.models.map((model) => model.id) ?? null,
  })
  const customActive = declared.ok
    ? await eventually(customState, (state) => state.routable, 'custom route')
    : null
  record('llm-pi-ai hand-declared provider via settings.mutate', {
    request: `settings/mutate { ns: 'llm-pi-ai', ops: [{ op: 'set', path: ['providers', '${CUSTOM}'], value: { displayName, api: 'openai-completions', baseURL: '<loopback>', apiKeyEnv: '${REF.file}', models: [{ id: 'corn-audit-model' }] } }], expectedRevision: ${piBefore.revision} }`,
    observed: declared.ok
      ? { revision: declared.value.revision, ...customActive }
      : failure(declared),
  })

  // Phase B: restart in the same Corn home and read everything back.
  await restart()
  const afterRestart = await namespace(DEFAULT_NS)
  record('GATE restart read-back', {
    observed: {
      settingsValue: afterRestart.value,
      settingsUser: afterRestart.user,
      revisionAfterRestart: afterRestart.revision,
      sessionModelCatalogDefault: await catalogDefault(),
      clawRegistryModelsOfficial: (await claw('models', {})).official,
      credential: await describeRefs([REF.file]),
      customProvider: await customState(),
    },
  })
  assert.deepEqual(afterRestart.value, TARGET)
  assert.deepEqual(await catalogDefault(), TARGET)
  assert.deepEqual((await claw('models', {})).official, TARGET)
  audit.pass('global-default-restart-persistence', {
    settingsValueIsTarget: true,
    sessionModelCatalogDefaultIsTarget: true,
    clawRegistryOfficialIsTarget: true,
    revisionAfterRestart: afterRestart.revision,
  })

  const invalidModel = await rpc('settings/update', {
    ns: DEFAULT_NS,
    patch: {
      provider: 'deepseek-official',
      model: 'corn-audit-not-in-catalog',
    },
    expectedRevision: afterRestart.revision,
  })
  record('global default accepts a model outside the catalog', {
    observed: invalidModel.ok
      ? {
          accepted: true,
          value: invalidModel.value.value,
          sessionModelCatalogDefault: await catalogDefault(),
        }
      : failure(invalidModel),
  })
  const revert = value(
    await rpc('settings/replace', {
      ns: DEFAULT_NS,
      section: {},
      expectedRevision: (await namespace(DEFAULT_NS)).revision,
    }),
  )
  record('global default revert via settings.replace {}', {
    observed: {
      value: revert.value,
      user: revert.user,
      profilePatchHasRow: await profilePatchRow(DEFAULT_NS),
    },
  })

  // session.selectModel side effect on the global default.
  const sessionId = `corn-audit-${randomUUID()}`
  value(
    await rpc('session/create', {
      request: { sessionId, cwd: join(home, 'documents') },
    }),
  )
  const selected = value(
    await rpc('session/selectModel', {
      request: {
        sessionId,
        provider: 'deepseek-official',
        model: 'deepseek-v4-pro',
      },
    }),
  )
  const sideEffect = await eventually(
    catalogDefault,
    (selection) => selection.model === 'deepseek-v4-pro',
    'selectModel background default save',
  ).catch(() => null)
  record('session.selectModel global-default side effect', {
    request: `session/selectModel { request: { sessionId, provider: 'deepseek-official', model: 'deepseek-v4-pro' } }`,
    observed: {
      selected,
      defaultAfter: sideEffect,
      profilePatchHasRow: await profilePatchRow(DEFAULT_NS),
    },
  })
  value(
    await rpc('settings/replace', {
      ns: DEFAULT_NS,
      section: {},
      expectedRevision: (await namespace(DEFAULT_NS)).revision,
    }),
  )

  const piNow = await namespace('llm-pi-ai')
  value(
    await rpc('settings/mutate', {
      ns: 'llm-pi-ai',
      ops: [{ op: 'unset', path: ['providers', CUSTOM] }],
      expectedRevision: piNow.revision,
    }),
  )
  const unset = await rpc('credentials/unset', { ref: REF.file })
  record('credentials.unset + custom provider removal', {
    observed: {
      unset: { ok: unset.ok },
      credential: await describeRefs([REF.file]),
      fileStillHoldsFakeValue: (
        await readFile(credentialsFile, 'utf8')
      ).includes(FAKE.file),
      customProvider: await eventually(
        customState,
        (state) => !state.routable,
        'custom route withdrawn',
      ),
    },
  })

  // Phase C: inherited-environment and .env layers.
  await writeFile(join(home, '.env'), `${REF.dotenv}=${FAKE.dotenv}\n`, {
    mode: 0o600,
  })
  await restart({ env: { [REF.env]: FAKE.env } })
  record('credentials env/.env precedence', {
    observed: {
      describe: await describeRefs([REF.env, REF.dotenv]),
      setShadowedByEnv: failure(
        await rpc('credentials/set', { ref: REF.env, value: FAKE.file }),
      ),
      unsetShadowedByEnv: failure(
        await rpc('credentials/unset', { ref: REF.env }),
      ),
    },
  })
  await rm(join(home, '.env'), { force: true })

  // Phase D: Corn's development route overlay owns llm-pi-ai config.
  await restart({
    overlay: [
      {
        id: 'llm-pi-ai',
        config: {
          providers: {
            'xiaomi-token-plan-cn': {
              apiKeyEnv: 'XIAOMI_TOKEN_PLAN_CN_API_KEY',
            },
          },
        },
      },
    ],
  })
  const overlaid = await namespace('llm-pi-ai')
  record('settings write under a command-line overlay', {
    observed: failure(
      await rpc('settings/mutate', {
        ns: 'llm-pi-ai',
        ops: [
          {
            op: 'set',
            path: ['providers', 'deepseek', 'apiKeyEnv'],
            value: REF.file,
          },
        ],
        expectedRevision: overlaid.revision,
      }),
    ),
  })

  // Phase E: missing services.
  await restart({ overlay: [{ id: 'settings', disabled: true }] })
  record('settings service absent', {
    observed: {
      describe: failure(await rpc('settings/describe', {})),
      modelCatalog: await rpc('session/modelCatalog', {}).then((result) =>
        result.ok
          ? { ok: true, default: result.value.default }
          : failure(result),
      ),
    },
  })
  await halt()
  let credentialsAbsent
  try {
    await boot({ overlay: [{ id: 'credentials', disabled: true }] })
    credentialsAbsent = failure(
      await rpc('credentials/describe', { refs: [REF.file] }),
    )
  } catch (error) {
    credentialsAbsent = { bootFailed: error.message }
  }
  record('credentials service absent', { observed: credentialsAbsent })
  await halt()

  // Restore to the lab's initial values, then scan. Destroying the lab is runAudit's job.
  await boot()
  const finalDefault = await namespace(DEFAULT_NS)
  assert.deepEqual(finalDefault.user, {})
  assert.equal((await describeRefs([REF.file]))[REF.file].configured, false)
  assert.equal((await customState()).routable, false)
  await halt()
  audit.pass('lab-restored', {
    globalDefaultUserEmpty: true,
    fakeCredentialUnset: true,
    customProviderWithdrawn: true,
  })
  const leaks = await scanForFakeKeys({
    texts: {
      wire: wire.join('\n'),
      'host-output': hosts.flatMap((item) => item.output).join(''),
    },
    tree: home,
  })
  record('fake-key leak scan', {
    observed: {
      scanned: ['wire responses', 'Host stdout/stderr', 'lab home tree'],
      leaks,
    },
  })
  assert.deepEqual(leaks, [])
  audit.pass('fake-key-leak-scan', { leaks: 0 })
}

const report = await runAudit({
  label: 'api',
  reportPath: REPORT,
  required: REQUIRED,
  handleSignals: true,
  body: auditBody,
})
console.log(
  JSON.stringify({
    status: report.status,
    durationMs: report.durationMs,
    versions: report.facts?.versions,
    capabilities: Object.fromEntries(
      Object.entries(report.capabilities).map(([name, row]) => [
        name,
        row.status,
      ]),
    ),
    cleanup: report.cleanup,
    problems: report.problems,
  }),
)
process.exitCode = report.exitCode
