import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HostAuth } from '../../apps/desktop/src/runtime/host-auth.ts'
import { TEMPLATE_MANIFEST } from '../../apps/desktop/src/runtime/profile-template.ts'
import {
  AuditRefusal,
  refuseExternalHome,
  verifyRuntimeVersions,
} from '../lib/model-audit-fixtures.mjs'
import { runAudit } from '../lib/model-audit-report.mjs'

// Run: node scripts/audit/packaged-model-config-probe.mjs "<path>/Corn Bot.app"
// Read-only against the app: boots its bundled runtime keyless from its bundled
// profile template in an audit-owned temp lab, reads the model-configuration
// Remotes and destroys the lab. Nothing is written through the Host, and the
// app tree is fingerprinted before and after to prove it was not modified.
let app
try {
  ;[app] = refuseExternalHome(process.argv.slice(2), process.env, {
    positional: 1,
  })
  if (!app.endsWith('.app'))
    throw new AuditRefusal(
      'Refusing a non-app argument: pass the packaged Corn Bot.app path',
    )
} catch (error) {
  if (!(error instanceof AuditRefusal)) throw error
  console.error(error.message)
  process.exit(2)
}

const REPORT = fileURLToPath(
  new URL('../../.artifacts/packaged-model-config-probe.json', import.meta.url),
)
const resources = join(app, 'Contents', 'Resources')
const cli = join(resources, 'node_modules', '@deepseek-ai', 'dsh')
const template = join(resources, 'profile-template')

/** Path, type, mode, size and mtime of every entry in the app bundle. */
async function fingerprintApp() {
  const hash = createHash('sha256')
  let entries = 0
  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name)
      const info = await lstat(path)
      entries++
      hash.update(
        `${path.slice(app.length)}\0${info.mode}\0${info.size}\0${info.mtimeMs}\n`,
      )
      if (info.isDirectory()) await walk(path)
    }
  }
  await walk(app)
  return { digest: hash.digest('hex'), entries }
}

async function probe(lab, audit) {
  const before = await fingerprintApp()
  await lab.seedProfile(template)
  const versions = await verifyRuntimeVersions({
    profile: lab.profile,
    dshManifest: join(cli, 'package.json'),
  })
  const manifest = JSON.parse(
    await readFile(join(template, TEMPLATE_MANIFEST), 'utf8'),
  )
  assert.equal(manifest.dshVersion, versions.dsh)
  assert.equal(manifest.clawVersion, versions.claw)
  audit.facts.versions = versions
  audit.pass('runtime-versions', {
    dsh: versions.dsh,
    claw: versions.claw,
    clawComponents: versions.clawComponents,
    templateManifestMatches: true,
  })

  const host = await lab.startHost({
    command: join(app, 'Contents', 'MacOS', 'Corn Bot'),
    args: [join(cli, 'lib', 'bin.js')],
    electron: true,
  })
  const auth = await HostAuth.exchange(host.launch)
  const rpc = async (endpoint, args) => {
    const response = await fetch(auth.url(`/api/${endpoint}`), {
      method: 'POST',
      headers: { ...auth.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: randomUUID(),
        method: endpoint,
        payload: { args },
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
    const result = (await response.json()).result
    assert.equal(result.ok, true, `${endpoint} failed`)
    return result.value
  }
  const settings = await rpc('settings/describe', {})
  const defaultModel = settings.namespaces.find(
    (row) => row.ns === 'agent-default-model',
  )
  const configurable = await rpc('llm/listConfigurableProviders', {})
  const catalog = await rpc('session/modelCatalog', {})
  const observed = {
    runtime: `packaged Corn Bot.app bundled DSH ${versions.dsh}, Claw ${versions.claw}`,
    settings: {
      writable: settings.writable,
      namespaces: settings.namespaces.length,
      agentDefaultModel: {
        autoGenerate: defaultModel.autoGenerate,
        value: defaultModel.value,
        revision: defaultModel.revision,
      },
    },
    credentials: await rpc('credentials/describe', {
      refs: ['DEEPSEEK_API_KEY'],
    }),
    llm: {
      listProviders: await rpc('llm/listProviders', {}),
      configurable: configurable.length,
      configurableNamespaces: [
        ...new Set(configurable.map((row) => row.settingsNs)),
      ],
    },
    modelCatalog: {
      default: catalog.default,
      routableProviders: catalog.routableProviders,
    },
  }
  audit.record('packaged read-only probe', { observed })
  audit.pass('packaged-read', {
    namespaces: observed.settings.namespaces,
    configurableProviders: observed.llm.configurable,
    defaultModel: `${catalog.default.provider}/${catalog.default.model}`,
  })
  await host.stop()

  const after = await fingerprintApp()
  assert.deepEqual(after, before, 'the app bundle changed during the probe')
  audit.pass('app-unmodified', { entries: after.entries })
}

const report = await runAudit({
  label: 'packaged',
  reportPath: REPORT,
  required: ['runtime-versions', 'packaged-read', 'app-unmodified'],
  handleSignals: true,
  body: probe,
})
console.log(
  JSON.stringify(
    {
      status: report.status,
      durationMs: report.durationMs,
      versions: report.facts?.versions,
      observed: report.evidence?.find(
        (row) => row.step === 'packaged read-only probe',
      )?.observed,
      capabilities: Object.fromEntries(
        Object.entries(report.capabilities).map(([name, row]) => [
          name,
          row.status,
        ]),
      ),
      cleanup: report.cleanup,
      problems: report.problems,
    },
    null,
    2,
  ),
)
process.exitCode = report.exitCode
