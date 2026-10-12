import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { CLAW_ADMISSION } from '../apps/desktop/src/runtime/claw-runtime-check.ts'
import { DshHostSupervisor } from '../apps/desktop/src/runtime/dsh-host-supervisor.ts'
import { systemProcessTable } from '../apps/desktop/src/runtime/host-descendants.ts'
import {
  assertIsolatedHome,
  defaultDevelopmentHome,
} from '../apps/desktop/src/runtime/profile-bootstrap.ts'
import {
  createAppRuntime,
  StartupControl,
} from '../apps/desktop/src/runtime/startup-control.ts'
import { ClawRegistryClient } from '../packages/dsh-adapter/src/claw-registry-client.ts'
import { HostTransport } from '../packages/dsh-adapter/src/transport.ts'
import {
  copyClawProfile,
  createReviewHome,
  LOCK,
  PROFILE,
  plantSentinels,
  writeNoClawProfile,
} from './lib/review-fixtures.mjs'

// Run after `pnpm setup:runtime`. Real DSH Host through the App's own runtime
// entry; every profile is a disposable copy, the source home is only read.
// Keyless: Corn model variables must be absent and no env file is provided.
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = assertIsolatedHome(
  process.env.CORN_DSH_HOME || defaultDevelopmentHome(),
)
for (const name of [
  'CORN_MODEL_PROVIDER',
  'CORN_MODEL_ID',
  'CORN_MODEL_API_KEY',
])
  assert.equal(process.env[name], undefined, `${name} must not be set`)

async function until(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (!predicate() && Date.now() < deadline) await delay(50)
  return predicate()
}

async function registryAnswers(auth) {
  try {
    await new ClawRegistryClient(new HostTransport(auth)).revision()
    return true
  } catch {
    return false
  }
}

/** Existence and shape only; audit rows are never read into the report. */
async function gateAnswers(auth) {
  try {
    const response = await fetch(auth.url('/api/dsh-claw/gate/audit'), {
      method: 'POST',
      headers: { ...auth.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 1 }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    const value = await response.json()
    return (
      response.status === 200 && value.ok === true && Array.isArray(value.items)
    )
  } catch {
    return false
  }
}

async function patchJson(path, change) {
  const value = JSON.parse(await readFile(path, 'utf8'))
  change(value)
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

const legit = (home) => copyClawProfile(source, home)
const modules = (profile, name) => join(profile, 'node_modules', name)
const ISOLATED_GATE = '- id: dsh-claw-gate\n  isolate:\n    tools: true\n'
const NOOP_GATE =
  "export const name = 'dsh-claw-gate'\nexport function apply() {}\n"

/**
 * Real Host started with only the post-authentication admission, so the Gate
 * capability check is shown to stand on its own; never an App or product path.
 */
function runtimeCheckOnly(home, seams) {
  let control
  const host = new DshHostSupervisor(home, {
    ...seams,
    model: null,
    admission: {
      beforeSpawn: async () => {},
      afterAuth: CLAW_ADMISSION.afterAuth,
    },
    onFailure: () => control?.hostFailed(),
  })
  control = new StartupControl({ host })
  return { control, host }
}

const SCENARIOS = [
  {
    name: 'governed-legit-profile-ready',
    prepare: legit,
    expected: { status: 'ready', spawns: 1, registry: true, gate: true },
  },
  {
    name: 'gate-isolated-by-profile-patch',
    async prepare(home) {
      const profile = await legit(home)
      await writeFile(join(profile, 'cordis.patch.yml'), ISOLATED_GATE)
    },
    expected: { status: 'failed', errorCode: 'claw_disabled', spawns: 0 },
  },
  {
    name: 'gate-isolated-by-home-patch',
    async prepare(home) {
      await legit(home)
      await writeFile(join(home, 'cordis.patch.yml'), ISOLATED_GATE)
    },
    expected: { status: 'failed', errorCode: 'claw_disabled', spawns: 0 },
  },
  {
    name: 'gate-remounted-in-isolating-group',
    async prepare(home) {
      const profile = await legit(home)
      await writeFile(
        join(profile, 'cordis.patch.yml'),
        '- insert:\n    - id: corn-attack-realm\n      name: cordis:group\n      group: true\n      isolate:\n        tools: true\n      config:\n        - id: dsh-claw-gate\n          name: dsh-claw-gate\n',
      )
    },
    expected: { status: 'failed', errorCode: 'claw_disabled', spawns: 0 },
  },
  {
    name: 'runtime-check-detects-isolated-gate',
    async prepare(home) {
      const profile = await legit(home)
      await writeFile(join(profile, 'cordis.patch.yml'), ISOLATED_GATE)
    },
    build: runtimeCheckOnly,
    expected: { status: 'failed', errorCode: 'claw_check_failed', spawns: 1 },
  },
  {
    name: 'gate-replaced-by-noop-plugin',
    async prepare(home) {
      const profile = await legit(home)
      await writeFile(
        join(modules(profile, 'dsh-claw-gate'), 'host.js'),
        NOOP_GATE,
      )
    },
    expected: { status: 'failed', errorCode: 'claw_check_failed', spawns: 1 },
  },
  {
    name: 'recovery-revalidates-gate-capability',
    prepare: legit,
    async afterReady({ control, host, profile }) {
      const pid = host.processId
      assert.ok(pid, 'A ready Host has a process id')
      await writeFile(
        join(modules(profile, 'dsh-claw-gate'), 'host.js'),
        NOOP_GATE,
      )
      process.kill(pid, 'SIGKILL')
      await until(
        () =>
          control.view.status === 'failed' ||
          (control.view.status === 'ready' && host.processId !== pid),
        60_000,
      )
    },
    expected: { status: 'failed', errorCode: 'claw_check_failed', spawns: 2 },
  },
  {
    name: 'no-claw-web-profile',
    prepare: writeNoClawProfile,
    expected: { status: 'failed', errorCode: 'claw_missing', spawns: 0 },
  },
  {
    name: 'suite-not-in-bundles',
    async prepare(home) {
      const profile = await legit(home)
      await patchJson(join(profile, 'package.json'), (manifest) => {
        manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(
          (name) => name !== 'dsh-claw-suite',
        )
      })
    },
    expected: { status: 'failed', errorCode: 'claw_disabled', spawns: 0 },
  },
  {
    name: 'suite-version-mismatch',
    async prepare(home) {
      const profile = await legit(home)
      await patchJson(
        join(modules(profile, 'dsh-claw-suite'), 'package.json'),
        (manifest) => {
          manifest.version = '0.3.0-rc.1'
        },
      )
    },
    expected: {
      status: 'failed',
      errorCode: 'claw_version_mismatch',
      spawns: 0,
    },
  },
  {
    name: 'gate-missing',
    async prepare(home) {
      const profile = await legit(home)
      await rm(modules(profile, 'dsh-claw-gate'), { recursive: true })
    },
    expected: { status: 'failed', errorCode: 'claw_missing', spawns: 0 },
  },
  {
    name: 'gate-disabled-by-profile-patch',
    async prepare(home) {
      const profile = await legit(home)
      await writeFile(
        join(profile, 'cordis.patch.yml'),
        '- id: dsh-claw-gate\n  disabled: true\n',
      )
    },
    expected: { status: 'failed', errorCode: 'claw_disabled', spawns: 0 },
  },
  {
    name: 'registry-replaced-by-noop-plugin',
    async prepare(home) {
      const profile = await legit(home)
      await writeFile(
        join(modules(profile, 'dsh-claw-registry'), 'host.js'),
        "export const name = 'dsh-claw-registry'\nexport function apply() {}\n",
      )
    },
    expected: { status: 'failed', errorCode: 'claw_check_failed', spawns: 1 },
  },
  {
    name: 'recovery-revalidates-after-gate-removed',
    prepare: legit,
    async afterReady({ control, host, profile, rebaseline }) {
      const pid = host.processId
      assert.ok(pid, 'A ready Host has a process id')
      await rm(modules(profile, 'dsh-claw-gate'), { recursive: true })
      await rebaseline()
      process.kill(pid, 'SIGKILL')
      await until(
        () =>
          control.view.status === 'failed' ||
          (control.view.status === 'ready' && host.processId !== pid),
        60_000,
      )
    },
    expected: { status: 'failed', errorCode: 'claw_missing', spawns: 1 },
  },
]

async function run(scenario) {
  const home = await createReviewHome(scenario.name)
  const profile = join(home, 'profiles', PROFILE)
  const children = []
  let runtime
  try {
    await scenario.prepare(home)
    const fingerprint = await plantSentinels(home)
    let baseline = await fingerprint()
    const seams = {
      spawnHost: (command, args, options) => {
        const child = spawn(command, args, options)
        children.push(child)
        return child
      },
      processTable: systemProcessTable,
    }
    runtime = scenario.build
      ? scenario.build(home, seams)
      : createAppRuntime(
          {
            home,
            devModelOverrideFile: undefined,
            profileTemplate: undefined,
          },
          seams,
        )
    const { control, host } = runtime
    await control.start()
    const settled = (s) => s === 'ready' || s === 'failed'
    await until(() => settled(control.view.status), 90_000)
    if (scenario.afterReady && control.view.status === 'ready')
      await scenario.afterReady({
        control,
        host,
        profile,
        rebaseline: async () => {
          baseline = await fingerprint()
        },
      })
    const observed = {
      status: control.view.status,
      errorCode: control.view.errorCode ?? null,
      spawns: children.length,
    }
    if (scenario.expected.registry !== undefined)
      observed.registry =
        control.auth !== undefined && (await registryAnswers(control.auth))
    if (scenario.expected.gate !== undefined)
      observed.gate =
        control.auth !== undefined && (await gateAnswers(control.auth))
    // Refused starts publish no Host authority, so no Session or tool call can be dispatched.
    observed.authorityPublished = control.auth !== undefined
    if (observed.status === 'failed') {
      observed.lockReleased = !existsSync(join(home, LOCK))
      observed.childrenExited = children.every(
        (child) => child.exitCode !== null || child.signalCode !== null,
      )
      observed.profileUntouched = (await fingerprint()) === baseline
    }
    const expected = {
      errorCode: null,
      authorityPublished: scenario.expected.status === 'ready',
      ...scenario.expected,
      ...(scenario.expected.status === 'failed'
        ? { lockReleased: true, childrenExited: true, profileUntouched: true }
        : {}),
    }
    const mismatches = Object.entries(expected)
      .filter(([key, value]) => observed[key] !== value)
      .map(([key, value]) => `${key}: expected ${value}, got ${observed[key]}`)
    return {
      name: scenario.name,
      passed: mismatches.length === 0,
      observed,
      mismatches,
    }
  } catch (error) {
    return {
      name: scenario.name,
      passed: false,
      observed: null,
      mismatches: [`threw ${error instanceof Error ? error.name : 'error'}`],
    }
  } finally {
    await runtime?.control.shutdown().catch(() => undefined)
    await rm(home, { recursive: true, force: true })
  }
}

const results = []
for (const scenario of SCENARIOS) {
  const result = await run(scenario)
  results.push(result)
  console.log(
    `${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.passed ? '' : ` — ${result.mismatches.join('; ')}`}`,
  )
}
await mkdir(join(root, '.artifacts', 'review'), {
  recursive: true,
  mode: 0o700,
})
await writeFile(
  join(root, '.artifacts', 'review', 'claw-smoke.json'),
  `${JSON.stringify({ recordedAt: new Date().toISOString(), scenarios: results }, null, 2)}\n`,
  { mode: 0o600 },
)
const failed = results.filter((row) => !row.passed).length
console.log(
  `${results.length - failed}/${results.length} Claw admission scenarios passed.`,
)
process.exitCode = failed === 0 ? 0 : 1
