import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Run after `pnpm package:mac`. Three fresh Electron userData + DSH homes; the
// last round also kills the owned Host and requires automatic recovery.
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const binary = join(
  root,
  'release/mac-arm64/Corn Bot.app/Contents/MacOS/Corn Bot',
)
assert.ok(existsSync(binary), 'Run pnpm package:mac first')

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
  const child = spawn(binary, args, { env, stdio: 'ignore' })
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
        CORN_MODEL_ENV_FILE: join(scratch, 'no-model.env'),
      },
      [`--user-data-dir=${join(scratch, 'user-data')}`],
    )
    const name = crash
      ? 'm0-electron-crash-smoke.json'
      : 'm0-electron-smoke.json'
    const report = JSON.parse(await readFile(join(artifacts, name), 'utf8'))
    assert.equal(code, 0, `Packaged round ${round} exited ${code}`)
    assert.equal(report.status, 'ready')
    assert.equal(report.packaged, true)
    assert.equal(report.bundledProfile, true)
    assert.equal(report.clawReady, true)
    assert.equal(report.bridgeVerified, true)
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
    }
    rounds.push({ round, crash, ...report })
    console.log(
      `PASS packaged fresh round ${round}/3${crash ? ' with automatic Host recovery' : ''}`,
    )
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
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
  `${JSON.stringify({ recordedAt: new Date().toISOString(), signed: false, userDshUntouched: true, rounds }, null, 2)}\n`,
  { mode: 0o600 },
)
