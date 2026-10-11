import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { TEMPLATE_MANIFEST } from '../../apps/desktop/src/runtime/profile-template.ts'
import {
  OwnedCleanupError,
  OwnedResources,
  runOwned,
} from '../lib/owned-resources.mjs'
import { buildProfileTemplate } from '../lib/profile-template-build.mjs'
import { fakeTemplateDeps } from './support/fake-template-deps.mjs'

const FAST = { graceMs: 200, killMs: 1_000, stopMs: 1_500 }

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'corn-owned-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('close releases each resource once, in reverse order, and a second close is a no-op', async (t) => {
  const dir = join(await scratch(t), 'home')
  await mkdir(dir)
  const order = []
  const owned = new OwnedResources({ timing: FAST })
  owned.directory('home', dir)
  owned.process('first', () => order.push('first'))
  owned.process('second', () => order.push('second'))
  const first = await owned.close()
  const second = await owned.close()
  assert.deepEqual(order, ['second', 'first'])
  assert.equal(second, first)
  assert.deepEqual(first, {
    ok: true,
    owned: 3,
    released: ['second', 'first', 'home'],
    failed: [],
    retained: [],
  })
  assert.equal(existsSync(dir), false)
  assert.throws(() => owned.process('late', () => {}), /closed/u)
})

test('abort stops owned processes at once, including one registered after the abort', async () => {
  const controller = new AbortController()
  const owned = new OwnedResources({ signal: controller.signal, timing: FAST })
  const stopped = []
  owned.process('before', () => stopped.push('before'))
  controller.abort(new Error('cancelled'))
  owned.process('after', () => stopped.push('after'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(stopped, ['before', 'after'])
  const summary = await owned.close()
  assert.deepEqual(stopped, ['before', 'after'])
  assert.deepEqual(summary.released, ['after', 'before'])
})

test('a stop that never settles hits the bound, fails close and keeps the directory it may still use', async (t) => {
  const dir = join(await scratch(t), 'home')
  await mkdir(dir)
  const owned = new OwnedResources({ timing: { ...FAST, stopMs: 200 } })
  owned.directory('home', dir)
  owned.process('wedged', () => new Promise(() => {}))
  const started = Date.now()
  const failure = await owned.close().catch((error) => error)
  assert.ok(failure instanceof OwnedCleanupError)
  assert.ok(Date.now() - started < 1_000)
  assert.deepEqual(failure.summary, {
    ok: false,
    owned: 2,
    released: [],
    failed: ['wedged'],
    retained: ['home'],
  })
  assert.equal(existsSync(dir), true)
  assert.equal(await owned.close().catch((error) => error), failure)
})

test('an owned child that ignores SIGTERM is killed within the bound and the run rejects with the abort reason', async (t) => {
  const pidFile = join(await scratch(t), 'pid')
  const controller = new AbortController()
  const owned = new OwnedResources({ signal: controller.signal, timing: FAST })
  const run = runOwned(
    owned,
    process.execPath,
    [
      '-e',
      `process.on('SIGTERM', () => {});require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));setInterval(() => {}, 1000)`,
    ],
    { stdio: 'ignore' },
  )
  run.catch(() => {})
  while (!existsSync(pidFile))
    await new Promise((resolve) => setTimeout(resolve, 10))
  const pid = Number(await readFile(pidFile, 'utf8'))
  const started = Date.now()
  const reason = new Error('cancelled')
  controller.abort(reason)
  await assert.rejects(run, (error) => error === reason)
  const summary = await owned.close()
  assert.equal(summary.ok, true)
  assert.ok(Date.now() - started < 1_500)
  assert.equal(alive(pid), false)
})

test('a completed template build releases every owned Host, child and its temp home', async (t) => {
  const output = join(await scratch(t), 'template')
  const phases = []
  const deps = fakeTemplateDeps(undefined, {
    report: (phase, facts) => phases.push({ phase, ...facts }),
  })
  await buildProfileTemplate(output, { timing: FAST, ...deps })
  assert.deepEqual(
    phases.map((row) => row.phase),
    ['bootstrap', 'governed', 'verify'],
  )
  for (const { pid } of phases.filter((row) => row.pid))
    assert.equal(alive(pid), false)
  assert.equal(existsSync(deps.homes[0]), false)
  assert.ok((await readdir(output)).includes(TEMPLATE_MANIFEST))
})

test('a build cancelled before it starts creates nothing', async (t) => {
  const output = join(await scratch(t), 'template')
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  const deps = fakeTemplateDeps(undefined, { report: () => {} })
  await assert.rejects(
    buildProfileTemplate(output, { signal: controller.signal, ...deps }),
    /cancelled/u,
  )
  assert.deepEqual(deps.homes, [])
  assert.equal(existsSync(output), false)
})
