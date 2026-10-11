import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CORN_PROFILE,
  cornHostEnvironment,
} from '../../apps/desktop/src/runtime/profile-bootstrap.ts'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

async function run(command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} failed (${code})`)),
    )
  })
}

/** The pinned official Claw release, downloaded once and checked at both archive and package level. */
export async function verifiedClawRelease() {
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
  const env = { PATH: process.env.PATH, HOME: process.env.HOME }
  await run('tar', ['-xzf', archive, '-C', cache], root, env)
  const extracted = join(cache, `dsh-claw-suite-${lock.claw.version}`)
  await run('shasum', ['-a', '256', '-c', 'SHA256SUMS'], extracted, env)
  return extracted
}

/** Installs Claw into Corn's named profile of `home` with the release's own installer. */
export async function installClaw(home) {
  const extracted = await verifiedClawRelease()
  await run(
    process.execPath,
    [
      join(extracted, 'scripts/install-desktop-local.mjs'),
      '--profile',
      CORN_PROFILE,
    ],
    root,
    cornHostEnvironment(home, null),
  )
}
