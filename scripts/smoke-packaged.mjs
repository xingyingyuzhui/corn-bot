import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createReviewHome,
  plantSentinels,
  writeNoClawProfile,
} from './lib/review-fixtures.mjs'

// Run after `pnpm package:mac`. Three fresh Electron userData + DSH homes; the
// last round also kills the owned Host and requires automatic recovery.
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const binary = join(
  root,
  'release/mac-arm64/Corn Bot.app/Contents/MacOS/Corn Bot',
)
assert.ok(existsSync(binary), 'Run pnpm package:mac first')
const FAKE_KEY = 'sk-corn-wp3-FAKE-PACKAGED-0000'
const template = join(
  root,
  'release/mac-arm64/Corn Bot.app/Contents/Resources/profile-template',
)
assert.ok(existsSync(template), 'The bundled profile template is missing')
for (const entry of await readdir(template))
  assert.ok(
    [
      'package.json',
      'cordis.yml',
      'cordis.patch.yml',
      'node_modules',
      'corn-profile-template.json',
    ].includes(entry),
    `The keyless profile template carries ${entry}`,
  )

/** Text files under `dir` (skipping package trees) that contain `needle`. */
async function filesContaining(dir, needle) {
  const hits = []
  for (const entry of await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    if (path.includes(`${sep}node_modules${sep}`)) continue
    const info = await stat(path)
    if (info.size > 4_000_000) continue
    if ((await readFile(path, 'utf8')).includes(needle)) hits.push(path)
  }
  return hits
}

async function userDshFingerprint() {
  const rows = []
  for (const path of [
    join(homedir(), '.dsh'),
    join(homedir(), '.dsh', 'profiles'),
  ]) {
    rows.push(
      await stat(path).then(
        (info) => `${path}:${info.mtimeMs}`,
        () => `${path}:absent`,
      ),
    )
  }
  return rows.join('|')
}

async function launch(env, args) {
  const child = spawn(binary, args, {
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  const timer = setTimeout(() => child.kill('SIGKILL'), 150_000)
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  clearTimeout(timer)
  return code
}

const before = await userDshFingerprint()
const rounds = []
for (let round = 1; round <= 3; round++) {
  const crash = round === 3
  const scratch = await mkdtemp(join(tmpdir(), 'corn-packaged-'))
  try {
    const home = join(scratch, 'dsh')
    const artifacts = join(scratch, 'artifacts')
    const legacyEnv = join(scratch, 'model.env')
    await writeFile(
      legacyEnv,
      `CORN_MODEL_PROVIDER=deepseek-official\nCORN_MODEL_ID=deepseek-flash\nCORN_MODEL_API_KEY=${FAKE_KEY}\n`,
      { mode: 0o600 },
    )
    const code = await launch(
      {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        CORN_DESKTOP_SMOKE: '1',
        ...(crash ? { CORN_DESKTOP_CRASH_SMOKE: '1' } : {}),
        CORN_DSH_HOME: home,
        CORN_ARTIFACTS_DIR: artifacts,
        // Retired model variables must be inert in a packaged App.
        ...(round === 1
          ? {
              CORN_MODEL_ENV_FILE: legacyEnv,
              CORN_DEV_MODEL_ENV_FILE: legacyEnv,
              CORN_MODEL_PROVIDER: 'deepseek-official',
              CORN_MODEL_ID: 'deepseek-flash',
              CORN_MODEL_API_KEY: FAKE_KEY,
              DEEPSEEK_API_KEY: FAKE_KEY,
            }
          : {}),
      },
      [`--user-data-dir=${join(scratch, 'user-data')}`],
    )
    const name = crash
      ? 'm0-electron-crash-smoke.json'
      : 'm0-electron-smoke.json'
    const report = JSON.parse(await readFile(join(artifacts, name), 'utf8'))
    if (code !== 0)
      console.error(
        `Packaged round ${round}: ${JSON.stringify({
          code,
          status: report.status,
          failedChecks: report.failedChecks,
          checks: report.checks,
          modelStatus: report.modelStatus,
          modelStatusReason: report.modelStatusReason,
          modelStatusAfterRecovery: report.modelStatusAfterRecovery,
          modelStatusReasonAfterRecovery: report.modelStatusReasonAfterRecovery,
          recoveringMs: report.recoveringMs,
        })}`,
      )
    assert.equal(code, 0, `Packaged round ${round} exited ${code}`)
    assert.equal(report.status, 'ready')
    assert.equal(report.packaged, true)
    assert.equal(report.bundledProfile, true)
    assert.equal(report.clawReady, true)
    assert.equal(report.bridgeVerified, true)
    assert.equal(report.hostSpawns, crash ? 2 : 1)
    assert.equal(report.modelStatus, 'needs_configuration')
    assert.equal(report.devModelOverride, false)
    assert.equal(report.modelBridgeVerified, true)
    assert.equal(report.modelSnapshotRedacted, true)
    assert.deepEqual(
      [
        ...(await filesContaining(home, FAKE_KEY)),
        ...(await filesContaining(artifacts, FAKE_KEY)),
      ],
      [],
      'A retired model variable reached the Host home or the report',
    )
    const profile = join(home, 'profiles', 'corn-dev')
    assert.ok(existsSync(join(profile, 'node_modules', 'dsh-claw-suite')))
    // Installer and package-manager residue would mean the template was bypassed.
    assert.ok(!existsSync(join(profile, '.dsh-local-plugins')))
    assert.ok(!existsSync(join(profile, 'pnpm-lock.yaml')))
    if (!crash) assert.equal(report.layout?.passed, true)
    if (crash) {
      assert.equal(report.rendererDuringRecovery, 'recovering')
      assert.equal(report.recovered, true)
      assert.equal(report.hostReplaced, true)
      assert.equal(report.clawReadyAfterRecovery, true)
      assert.equal(report.modelStatusAfterRecovery, 'needs_configuration')
    }
    rounds.push({ round, crash, ...report })
    console.log(
      `PASS packaged fresh round ${round}/3${crash ? ' with automatic Host recovery' : ''}`,
    )
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
// An existing Corn profile from before Claw was installed must be refused,
// not repaired from the bundled template and not run as plain DSH.
const legacyHome = await createReviewHome('packaged-no-claw')
const legacyScratch = await mkdtemp(join(tmpdir(), 'corn-packaged-no-claw-'))
let rejection
try {
  await writeNoClawProfile(legacyHome)
  const fingerprint = await plantSentinels(legacyHome)
  const baseline = await fingerprint()
  const artifacts = join(legacyScratch, 'artifacts')
  const code = await launch(
    {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG ?? 'en_US.UTF-8',
      CORN_DESKTOP_SMOKE: '1',
      CORN_DSH_HOME: legacyHome,
      CORN_ARTIFACTS_DIR: artifacts,
    },
    [`--user-data-dir=${join(legacyScratch, 'user-data')}`],
  )
  const report = JSON.parse(
    await readFile(join(artifacts, 'm0-electron-smoke.json'), 'utf8'),
  )
  assert.equal(code, 1, 'A refused profile must fail the smoke self-check')
  assert.equal(report.packaged, true)
  assert.equal(report.status, 'failed')
  assert.equal(report.errorCode, 'claw_missing')
  assert.equal(report.hostSpawns, 0)
  assert.equal(report.clawReady, false)
  assert.equal(report.bridgeVerified, true)
  assert.equal(await fingerprint(), baseline, 'The legacy profile is untouched')
  rejection = {
    status: report.status,
    errorCode: report.errorCode,
    hostSpawns: report.hostSpawns,
    profileUntouched: true,
  }
  console.log('PASS packaged existing no-Claw profile refused without spawn')
} finally {
  await rm(legacyScratch, { recursive: true, force: true })
  await rm(legacyHome, { recursive: true, force: true })
}
// F1: a seeded packaged profile whose Gate is moved out of its service scope,
// or whose Gate never mounts its audit capability, must not become ready.
const gateHome = await createReviewHome('packaged-gate')
const gateScratch = await mkdtemp(join(tmpdir(), 'corn-packaged-gate-'))
const gateRejections = []
try {
  const env = (artifacts) => ({
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    CORN_DESKTOP_SMOKE: '1',
    CORN_DSH_HOME: gateHome,
    CORN_ARTIFACTS_DIR: artifacts,
  })
  const seedArtifacts = join(gateScratch, 'seed')
  assert.equal(
    await launch(env(seedArtifacts), [
      `--user-data-dir=${join(gateScratch, 'user-data-seed')}`,
    ]),
    0,
    'The Gate rounds start from a ready packaged profile',
  )
  const profile = join(gateHome, 'profiles', 'corn-dev')
  const patchFile = join(profile, 'cordis.patch.yml')
  const gateHost = join(profile, 'node_modules', 'dsh-claw-gate', 'host.js')
  for (const attack of [
    {
      name: 'gate-isolated-by-profile-patch',
      file: patchFile,
      content: '- id: dsh-claw-gate\n  isolate:\n    tools: true\n',
      errorCode: 'claw_disabled',
      hostSpawns: 0,
    },
    {
      name: 'gate-replaced-by-noop-plugin',
      file: gateHost,
      content:
        "export const name = 'dsh-claw-gate'\nexport function apply() {}\n",
      errorCode: 'claw_check_failed',
      hostSpawns: 1,
    },
  ]) {
    const original = await readFile(attack.file)
    await writeFile(attack.file, attack.content)
    try {
      const fingerprint = await plantSentinels(gateHome)
      const baseline = await fingerprint()
      const artifacts = join(gateScratch, attack.name)
      const code = await launch(env(artifacts), [
        `--user-data-dir=${join(gateScratch, `user-data-${attack.name}`)}`,
      ])
      const report = JSON.parse(
        await readFile(join(artifacts, 'm0-electron-smoke.json'), 'utf8'),
      )
      assert.equal(code, 1, `${attack.name} must fail the smoke self-check`)
      assert.equal(report.packaged, true)
      assert.equal(report.status, 'failed')
      assert.equal(report.errorCode, attack.errorCode)
      assert.equal(report.hostSpawns, attack.hostSpawns)
      assert.equal(report.clawReady, false)
      assert.equal(await fingerprint(), baseline, 'The profile is untouched')
      assert.ok(!existsSync(join(gateHome, 'corn-host.lock')))
      gateRejections.push({
        name: attack.name,
        status: report.status,
        errorCode: report.errorCode,
        hostSpawns: report.hostSpawns,
        profileUntouched: true,
      })
      console.log(`PASS packaged ${attack.name} refused (${attack.errorCode})`)
    } finally {
      await writeFile(attack.file, original)
    }
  }
} finally {
  await rm(gateScratch, { recursive: true, force: true })
  await rm(gateHome, { recursive: true, force: true })
}
assert.equal(
  await userDshFingerprint(),
  before,
  'The user DSH home must stay untouched',
)
console.log('PASS existing ~/.dsh untouched')
await mkdir(join(root, '.artifacts'), { recursive: true, mode: 0o700 })
await writeFile(
  join(root, '.artifacts', 'm0-packaged-smoke.json'),
  `${JSON.stringify({ recordedAt: new Date().toISOString(), signed: false, userDshUntouched: true, rounds, noClawRejection: rejection, gateRejections }, null, 2)}\n`,
  { mode: 0o600 },
)
