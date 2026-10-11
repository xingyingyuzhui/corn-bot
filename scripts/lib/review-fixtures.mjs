import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertIsolatedHome } from '../../apps/desktop/src/runtime/profile-bootstrap.ts'

export const PROFILE = 'corn-dev'
export const LOCK = 'corn-host.lock'
const SENTINEL = 'corn-review-sentinel'
const EMPTY_LAYER = '[]\n'

/** A disposable home that Corn's claim accepts; never a user DSH home. */
export async function createReviewHome(label) {
  const home = assertIsolatedHome(
    await mkdtemp(join(tmpdir(), `corn-review-${label}-`)),
  )
  await writeFile(
    join(home, '.corn-bot-home.json'),
    `${JSON.stringify({ owner: 'corn-bot', purpose: 'review-regression', schemaVersion: 1 })}\n`,
    { mode: 0o600 },
  )
  return home
}

/** The shape DSH's online `web` template produces: no Claw suite at all. */
export async function writeNoClawProfile(home) {
  const profile = join(home, 'profiles', PROFILE)
  await mkdir(profile, { recursive: true, mode: 0o700 })
  await writeFile(
    join(profile, 'package.json'),
    `${JSON.stringify(
      {
        name: `dsh-profile-${PROFILE}`,
        private: true,
        dsh: {
          profile: {
            bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
          },
        },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(join(profile, 'cordis.yml'), EMPTY_LAYER)
  await writeFile(join(profile, 'cordis.patch.yml'), EMPTY_LAYER)
  return profile
}

/** Copies a Corn-installed Claw profile; the source home is only read. */
export async function copyClawProfile(sourceHome, home) {
  const source = join(assertIsolatedHome(sourceHome), 'profiles', PROFILE)
  const installed = JSON.parse(
    await readFile(join(source, 'package.json'), 'utf8'),
  )
  assert.equal(installed.dependencies?.['dsh-claw-suite'], '0.3.0-rc.2')
  const profile = join(home, 'profiles', PROFILE)
  await mkdir(profile, { recursive: true, mode: 0o700 })
  for (const entry of [
    'package.json',
    'cordis.yml',
    'cordis.patch.yml',
    'node_modules',
  ])
    await cp(join(source, entry), join(profile, entry), { recursive: true })
  return profile
}

async function digest(path) {
  return createHash('sha256')
    .update(await readFile(path).catch(() => 'absent'))
    .digest('hex')
}

/**
 * Plants data sentinels and returns a fingerprint of everything a rejected
 * start must leave alone: sentinels, manifest, patch layers and installed packages.
 */
export async function plantSentinels(home) {
  const profile = join(home, 'profiles', PROFILE)
  for (const dir of [home, profile])
    await writeFile(join(dir, SENTINEL), randomUUID(), { mode: 0o600 })
  return async () => {
    const rows = []
    for (const path of [
      join(home, SENTINEL),
      join(home, 'cordis.patch.yml'),
      join(profile, SENTINEL),
      join(profile, 'package.json'),
      join(profile, 'cordis.yml'),
      join(profile, 'cordis.patch.yml'),
    ])
      rows.push(`${path}:${await digest(path)}`)
    const packages = await readdir(join(profile, 'node_modules')).catch(
      () => [],
    )
    rows.push(`node_modules:${packages.sort().join(',')}`)
    return rows.join('\n')
  }
}
