import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertIsolatedHome,
  defaultDevelopmentHome,
} from '../apps/desktop/src/runtime/profile-bootstrap.ts'
import {
  copyClawProfile,
  createReviewHome,
  plantSentinels,
  writeNoClawProfile,
} from './lib/review-fixtures.mjs'

// Run after `pnpm build` and `pnpm setup:runtime`. Development Electron with
// a fresh userData, a disposable home and a Corn-only model env file per case.
// Only fake credentials are written; no real key is ever read.
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const electron = createRequire(import.meta.url)('electron')
const source = assertIsolatedHome(
  process.env.CORN_DSH_HOME || defaultDevelopmentHome(),
)
assert.ok(
  existsSync(join(root, 'apps/desktop/dist/apps/desktop/src/main.js')),
  'Run pnpm build first',
)
const FAKE_CREDENTIAL = 'corn-review-fake-credential'
const artifacts = join(root, '.artifacts')
const review = join(artifacts, 'review')

async function envFile(scratch, text, mode = 0o600) {
  const path = join(scratch, 'model.env')
  await writeFile(path, text)
  await chmod(path, mode)
  return path
}

const failedConfig = (errorCode) => ({
  exit: 1,
  status: 'failed',
  errorCode,
  hostSpawns: 0,
  bridgeVerified: true,
  clawReady: false,
})

const SCENARIOS = [
  {
    name: 'config-missing-key',
    model: (scratch) =>
      envFile(
        scratch,
        'CORN_MODEL_PROVIDER=deepseek-official\nCORN_MODEL_ID=review-model\n',
      ),
    expected: failedConfig('model_config_invalid'),
  },
  {
    name: 'config-unknown-route',
    model: (scratch) =>
      envFile(
        scratch,
        `CORN_MODEL_PROVIDER=unknown-route\nCORN_MODEL_ID=review-model\nCORN_MODEL_API_KEY=${FAKE_CREDENTIAL}\n`,
      ),
    expected: failedConfig('model_config_invalid'),
  },
  {
    name: 'config-group-readable',
    model: (scratch) =>
      envFile(
        scratch,
        `CORN_MODEL_PROVIDER=deepseek-official\nCORN_MODEL_ID=review-model\nCORN_MODEL_API_KEY=${FAKE_CREDENTIAL}\n`,
        0o644,
      ),
    expected: failedConfig('model_config_permissions'),
  },
  {
    name: 'config-unreadable-directory',
    async model(scratch) {
      const path = join(scratch, 'model.env')
      await mkdir(path)
      return path
    },
    expected: failedConfig('model_config_unreadable'),
  },
  {
    name: 'no-claw-profile',
    prepare: writeNoClawProfile,
    expected: failedConfig('claw_missing'),
  },
  {
    name: 'governed-ready',
    prepare: (home) => copyClawProfile(source, home),
    expected: {
      exit: 0,
      status: 'ready',
      hostSpawns: 1,
      bridgeVerified: true,
      clawReady: true,
    },
  },
  {
    name: 'crash-recovery-revalidated',
    crash: true,
    prepare: (home) => copyClawProfile(source, home),
    expected: {
      exit: 0,
      status: 'ready',
      hostSpawns: 2,
      bridgeVerified: true,
      clawReady: true,
      rendererDuringRecovery: 'recovering',
      recovered: true,
      hostReplaced: true,
      clawReadyAfterRecovery: true,
    },
  },
]

async function launch(env, userData) {
  const child = spawn(
    electron,
    ['apps/desktop', `--user-data-dir=${userData}`],
    {
      cwd: root,
      env,
      stdio: 'ignore',
    },
  )
  const timer = setTimeout(() => child.kill('SIGKILL'), 150_000)
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (exit, signal) => resolve(signal ? signal : exit))
  })
  clearTimeout(timer)
  return code
}

async function run(scenario) {
  const scratch = await mkdtemp(join(tmpdir(), 'corn-review-desktop-'))
  const home = await createReviewHome(scenario.name)
  const report = scenario.crash
    ? 'm0-electron-crash-smoke.json'
    : 'm0-electron-smoke.json'
  const screenshot = scenario.crash
    ? 'm0-electron-crash.png'
    : 'm0-electron.png'
  try {
    await scenario.prepare?.(home)
    const fingerprint = scenario.prepare
      ? await plantSentinels(home)
      : undefined
    const baseline = await fingerprint?.()
    const modelEnvFile = scenario.model
      ? await scenario.model(scratch)
      : join(scratch, 'absent-model.env')
    await rm(join(artifacts, report), { force: true })
    const startedAt = Date.now()
    const exit = await launch(
      {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        CORN_DESKTOP_SMOKE: '1',
        ...(scenario.crash ? { CORN_DESKTOP_CRASH_SMOKE: '1' } : {}),
        CORN_DSH_HOME: home,
        CORN_MODEL_ENV_FILE: modelEnvFile,
      },
      join(scratch, 'user-data'),
    )
    const path = join(artifacts, report)
    const fresh =
      existsSync(path) && (await stat(path)).mtimeMs >= startedAt - 1_000
    if (!fresh)
      return {
        name: scenario.name,
        passed: false,
        observed: { exit },
        mismatches: [
          'no fresh smoke report (no window reached the self-check)',
        ],
      }
    const text = await readFile(path, 'utf8')
    const facts = JSON.parse(text)
    await copyFile(path, join(review, `desktop-${scenario.name}.json`))
    if (existsSync(join(artifacts, screenshot)))
      await copyFile(
        join(artifacts, screenshot),
        join(review, `desktop-${scenario.name}.png`),
      )
    const observed = {
      exit,
      ...Object.fromEntries(
        Object.keys(scenario.expected)
          .filter((key) => key !== 'exit')
          .map((key) => [key, facts[key] ?? null]),
      ),
    }
    const mismatches = Object.entries(scenario.expected)
      .filter(([key, value]) => observed[key] !== value)
      .map(([key, value]) => `${key}: expected ${value}, got ${observed[key]}`)
    if (text.includes(FAKE_CREDENTIAL))
      mismatches.push('report leaks the model credential')
    if (/(?:tp|sk)-[A-Za-z0-9]{8,}/u.test(text))
      mismatches.push('report contains a key-shaped value')
    if (scenario.expected.status === 'failed') {
      const safe =
        typeof facts.message === 'string' &&
        facts.message.length > 0 &&
        !/[\\/]|token|cookie|stack/iu.test(facts.message)
      if (!safe) mismatches.push('failed message is not a safe user string')
      if (!scenario.prepare && existsSync(join(home, 'profiles')))
        mismatches.push('a bad configuration still seeded a profile')
    }
    if (fingerprint && (await fingerprint()) !== baseline)
      mismatches.push('profile or sentinels changed')
    return {
      name: scenario.name,
      passed: mismatches.length === 0,
      observed,
      mismatches,
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  }
}

await mkdir(review, { recursive: true, mode: 0o700 })
const results = []
for (const scenario of SCENARIOS) {
  const result = await run(scenario)
  results.push(result)
  console.log(
    `${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.passed ? '' : ` — ${result.mismatches.join('; ')}`}`,
  )
}
await writeFile(
  join(review, 'desktop-smoke.json'),
  `${JSON.stringify({ recordedAt: new Date().toISOString(), scenarios: results }, null, 2)}\n`,
  { mode: 0o600 },
)
const failed = results.filter((row) => !row.passed).length
console.log(
  `${results.length - failed}/${results.length} desktop scenarios passed.`,
)
process.exitCode = failed === 0 ? 0 : 1
