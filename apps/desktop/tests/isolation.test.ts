import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { acquireProcessLock } from '../src/runtime/process-lock.ts'
import {
  assertIsolatedHome,
  claimCornHome,
  cornHostEnvironment,
} from '../src/runtime/profile-bootstrap.ts'

test('rejects user DSH home, ancestors, nested paths and symlink aliases', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'corn-home-test-'))
  try {
    for (const path of [
      homedir(),
      join(homedir(), '.dsh'),
      join(homedir(), '.dsh', 'profiles', 'corn'),
      join(homedir(), '.dsh', '..corn'),
      join(homedir(), '.dsh', '..corn', 'profiles'),
    ]) {
      assert.throws(() => assertIsolatedHome(path), /Refusing/u)
    }
    await symlink(homedir(), join(temporary, 'alias'))
    assert.throws(
      () => assertIsolatedHome(join(temporary, 'alias', '.dsh', 'new-home')),
      /Refusing/u,
    )
    assert.throws(() => assertIsolatedHome('relative-path'), /absolute/u)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('only adopts an empty or already Corn-owned home', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'corn-home-test-'))
  try {
    const owned = join(temporary, 'owned')
    assert.equal(await claimCornHome(owned), realpathSync(owned))
    assert.equal(await claimCornHome(owned), realpathSync(owned))
    const foreign = join(temporary, 'foreign')
    await mkdir(foreign)
    await writeFile(join(foreign, 'package.json'), '{}')
    await assert.rejects(claimCornHome(foreign), /nonempty/u)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('exclusive home lock refuses a second process owner', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'corn-lock-test-'))
  try {
    const release = await acquireProcessLock(temporary)
    await assert.rejects(acquireProcessLock(temporary), /locked/u)
    await Promise.all(Array.from({ length: 5 }, () => release()))
    await release()
    await (await acquireProcessLock(temporary))()
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('ambient unrelated credentials and Node injection flags never enter the Host', () => {
  const previous = process.env.DEEPSEEK_API_KEY
  const previousOptions = process.env.NODE_OPTIONS
  try {
    process.env.DEEPSEEK_API_KEY = 'do-not-inherit-ambient-key'
    process.env.NODE_OPTIONS = '--inspect=0.0.0.0:9229'
    const environment = cornHostEnvironment(join(tmpdir(), 'corn-env-test'))
    assert.equal(
      environment.DEEPSEEK_API_KEY,
      process.env.CORN_DEEPSEEK_API_KEY,
    )
    assert.equal(environment.NODE_OPTIONS, undefined)
    assert.equal(environment.GOOGLE_API_KEY, undefined)
    assert.equal(environment.DSH_TELEMETRY_DISABLED, '1')
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous
    if (previousOptions === undefined) delete process.env.NODE_OPTIONS
    else process.env.NODE_OPTIONS = previousOptions
  }
})
