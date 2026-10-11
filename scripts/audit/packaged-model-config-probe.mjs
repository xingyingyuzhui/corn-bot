import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HostAuth } from '../../apps/desktop/src/runtime/host-auth.ts'
import { parseReadinessLine } from '../../apps/desktop/src/runtime/host-readiness.ts'
import {
  CORN_PROFILE,
  claimCornHome,
  cornHostEnvironment,
  writeIsolationPatch,
} from '../../apps/desktop/src/runtime/profile-bootstrap.ts'
import { materializeProfile } from '../../apps/desktop/src/runtime/profile-template.ts'

// Run: node scripts/audit/packaged-model-config-probe.mjs "<path>/Corn Bot.app"
// Read-only: boots the app's bundled runtime keyless from its bundled profile
// template in a fresh Corn-owned temp home, reads the model-configuration
// Remotes, and deletes the home. Nothing is written through the Host.
const app = process.argv[2]
assert.ok(app?.endsWith('.app'), 'Pass the packaged Corn Bot.app path')
const resources = join(app, 'Contents', 'Resources')
const cli = join(resources, 'node_modules', '@deepseek-ai', 'dsh')
assert.equal(
  JSON.parse(await readFile(join(cli, 'package.json'), 'utf8')).version,
  '0.2.0-rc.2',
)
const parent = join(homedir(), '.corn-bot-dev', 'wt-model-audit')
const home = await mkdtemp(join(parent, 'packaged-'))
let child
let exited
try {
  await claimCornHome(home)
  await materializeProfile(
    join(resources, 'profile-template'),
    join(home, 'profiles', CORN_PROFILE),
  )
  const patch = await writeIsolationPatch(home, null)
  child = spawn(
    join(app, 'Contents', 'MacOS', 'Corn Bot'),
    [
      join(cli, 'lib', 'bin.js'),
      CORN_PROFILE,
      '--patch',
      patch,
      '--no-open',
      '--port',
      '0',
    ],
    {
      cwd: home,
      env: { ...cornHostEnvironment(home, null), ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  exited = new Promise((resolve) => child.once('close', resolve))
  const launch = await new Promise((resolve, reject) => {
    let pending = ''
    const timer = setTimeout(
      () => reject(new Error('Packaged Host readiness deadline exceeded')),
      45_000,
    )
    child.once('close', () => {
      clearTimeout(timer)
      reject(new Error('Packaged Host exited before readiness'))
    })
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      pending += chunk
      const lines = pending.split(/\r?\n/u)
      pending = lines.pop() || ''
      for (const line of lines) {
        const url = parseReadinessLine(line)
        if (url) {
          clearTimeout(timer)
          resolve(url)
        }
      }
    })
    child.stderr.resume()
  })
  const auth = await HostAuth.exchange(launch)
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
  console.log(
    JSON.stringify(
      {
        runtime: 'packaged Corn Bot.app bundled DSH 0.2.0-rc.2',
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
      },
      null,
      2,
    ),
  )
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
    await exited
  }
  await rm(home, { recursive: true, force: true })
}
