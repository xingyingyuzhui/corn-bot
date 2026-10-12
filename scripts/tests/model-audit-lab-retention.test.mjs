import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { createAuditLab } from '../lib/model-audit-fixtures.mjs'
import { runAudit } from '../lib/model-audit-report.mjs'

// PMR-01: a lab whose Host stop is unconfirmed keeps its home and lock.

const FAST = { readinessMs: 2_000, graceMs: 50, killMs: 100, closeMs: 500 }
// Above the macOS and Linux pid limits, so group signals can only fail with ESRCH.
let nextPid = 4_000_000

/** A pure in-memory child: prints DSH's readiness line; `wedged` ignores every signal. */
class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid = nextPid++
  exitCode = null
  signalCode = null
  kills = []

  constructor(wedged) {
    super()
    this.wedged = wedged
    queueMicrotask(() =>
      this.stdout.write('dsh web: http://127.0.0.1:9/?token=corn-test\n'),
    )
  }

  kill(signal) {
    this.kills.push(signal)
    if (this.wedged) return true
    queueMicrotask(() => {
      if (this.exitCode !== null || this.signalCode !== null) return
      this.signalCode = signal
      this.emit('exit', null, signal)
      this.emit('close', null, signal)
    })
    return true
  }
}

/** Spawns children in order: `wedged[i]` decides whether the i-th one ignores signals. */
function spawnFakes(wedged) {
  const children = []
  const spawnHost = () => {
    const child = new FakeChild(wedged[children.length] === true)
    children.push(child)
    return child
  }
  return { children, spawnHost }
}

async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'corn-audit-retain-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const lockPath = (lab) => join(lab.home, 'corn-host.lock')
/** Harmless stand-in command, so a seam that is ignored never starts a real DSH Host. */
const STAND_IN = {
  command: process.execPath,
  args: [
    '-e',
    "console.log('dsh web: http://127.0.0.1:9/?token=corn-test');setInterval(() => {}, 1000)",
  ],
}

test('an unconfirmed Host stop keeps the lab, home and lock but still closes stubs and stops cleanable Hosts', async (t) => {
  const parent = await scratch(t)
  const { children, spawnHost } = spawnFakes([false, true])
  const lab = await createAuditLab({
    label: 'unit',
    parent,
    timing: FAST,
    spawnHost,
  })
  await lab.startHost(STAND_IN)
  await lab.startHost(STAND_IN)
  let stubClosed = false
  lab.track(() => {
    stubClosed = true
  })
  const failure = await lab.destroy().catch((error) => error)
  assert.ok(failure instanceof AggregateError)
  assert.equal(stubClosed, true)
  assert.deepEqual(failure.summary, {
    hostsSpawned: 2,
    hostsStopped: 1,
    unconfirmedHosts: [children[1].pid],
    stubsClosed: 1,
    lockReleased: false,
    removed: false,
    retained: ['lab', 'process lock'],
    labRoot: lab.root,
  })
  assert.match(
    failure.errors.map((error) => error.message).join('\n'),
    /retained/u,
  )
  assert.deepEqual(children[0].kills, ['SIGTERM'])
  assert.deepEqual(children[1].kills, ['SIGTERM', 'SIGKILL'])
  assert.equal(existsSync(lab.home), true)
  assert.equal(existsSync(lockPath(lab)), true)
  assert.match(await readFile(lockPath(lab), 'utf8'), /"pid"/u)
})

test('a second destroy is a no-op that repeats the same outcome', async (t) => {
  const parent = await scratch(t)
  const { children, spawnHost } = spawnFakes([true])
  const lab = await createAuditLab({
    label: 'unit',
    parent,
    timing: FAST,
    spawnHost,
  })
  await lab.startHost(STAND_IN)
  let closes = 0
  lab.track(() => {
    closes++
  })
  const first = await lab.destroy().catch((error) => error)
  const kills = children[0].kills.length
  const second = await lab.destroy().catch((error) => error)
  assert.equal(second, first)
  assert.equal(children[0].kills.length, kills)
  assert.equal(closes, 1)
  assert.equal(existsSync(lockPath(lab)), true)
})

test('an audit whose Host stop is unconfirmed exits non-zero and reports the retained lab', async (t) => {
  const parent = await scratch(t)
  const labs = join(parent, 'labs')
  await mkdir(labs)
  const reportPath = join(parent, 'report.json')
  const { children, spawnHost } = spawnFakes([true])
  const report = await runAudit({
    label: 'unit',
    reportPath,
    labParent: labs,
    timing: FAST,
    spawnHost,
    required: ['a'],
    body: async (lab, audit) => {
      await lab.startHost(STAND_IN)
      audit.pass('a', {})
    },
  })
  assert.equal(report.status, 'failed')
  assert.notEqual(report.exitCode, 0)
  assert.ok(report.problems.includes('cleanup failed'))
  assert.equal(report.cleanup.ok, false)
  assert.equal(report.cleanup.removed, false)
  assert.equal(report.cleanup.lockReleased, false)
  assert.deepEqual(report.cleanup.retained, ['lab', 'process lock'])
  assert.deepEqual(report.cleanup.unconfirmedHosts, [children[0].pid])
  const stored = JSON.parse(await readFile(reportPath, 'utf8'))
  assert.equal(stored.status, 'failed')
  assert.deepEqual(stored.cleanup.retained, ['lab', 'process lock'])
  const [kept] = await readdir(labs)
  assert.ok(kept, 'the lab must be retained')
  assert.equal(existsSync(join(labs, kept, 'home', 'corn-host.lock')), true)
})

test('confirmed stops still release the lock and remove the lab', async (t) => {
  const parent = await scratch(t)
  const { spawnHost } = spawnFakes([false])
  const lab = await createAuditLab({
    label: 'unit',
    parent,
    timing: FAST,
    spawnHost,
  })
  await lab.startHost(STAND_IN)
  lab.track(() => {})
  const summary = await lab.destroy()
  assert.deepEqual(summary, {
    hostsSpawned: 1,
    hostsStopped: 1,
    unconfirmedHosts: [],
    stubsClosed: 1,
    lockReleased: true,
    removed: true,
    retained: [],
  })
  assert.equal(existsSync(lab.root), false)
})
