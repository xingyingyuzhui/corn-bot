import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DshHostSupervisor } from '../apps/desktop/src/runtime/dsh-host-supervisor.ts'
import { acquireProcessLock } from '../apps/desktop/src/runtime/process-lock.ts'
import {
  CORN_PROFILE,
  cornHostEnvironment,
  defaultDevelopmentHome,
} from '../apps/desktop/src/runtime/profile-bootstrap.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const home = process.env.CORN_DSH_HOME ?? defaultDevelopmentHome()
const host = new DshHostSupervisor(home, undefined, null)
try {
  await host.start()
} finally {
  await host.stop()
}
const releaseLock = await acquireProcessLock(home)
try {
  const lock = JSON.parse(
    await readFile(join(root, 'runtime.lock.json'), 'utf8'),
  )
  const cache = join(root, '.runtime', 'claw')
  await mkdir(cache, { recursive: true, mode: 0o700 })
  const archive = join(cache, lock.claw.asset)
  let bytes
  try {
    bytes = await readFile(archive)
  } catch {
    const url = `https://github.com/xingyingyuzhui/dsh-claw-suite/releases/download/v${lock.claw.version}/${lock.claw.asset}`
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok)
      throw new Error(`Claw release download failed (${response.status})`)
    bytes = Buffer.from(await response.arrayBuffer())
  }
  if (createHash('sha256').update(bytes).digest('hex') !== lock.claw.sha256)
    throw new Error('Claw release integrity mismatch')
  await writeFile(archive, bytes, { mode: 0o600 })
  async function run(command, args, cwd) {
    const child = spawn(command, args, {
      cwd,
      env: cornHostEnvironment(home, null),
      stdio: 'inherit',
    })
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Runtime setup failed (${code})`)),
      )
    })
  }
  await run('tar', ['-xzf', archive, '-C', cache], root)
  const extracted = join(cache, `dsh-claw-suite-${lock.claw.version}`)
  await run('shasum', ['-a', '256', '-c', 'SHA256SUMS'], extracted)
  await run(
    process.execPath,
    [
      join(extracted, 'scripts/install-desktop-local.mjs'),
      '--profile',
      CORN_PROFILE,
    ],
    root,
  )
  console.log(
    'Corn-owned Claw RC2 runtime is installed. Existing DSH installations were not used.',
  )
} finally {
  await releaseLock()
}
