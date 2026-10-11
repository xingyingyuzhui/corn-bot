import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const SUPPORT = join(repo, 'scripts/tests/support')
const AUDIT_RUNNER = join(SUPPORT, 'audit-interrupt-runner.mjs')
const TEMPLATE_RUNNER = join(SUPPORT, 'template-interrupt-runner.mjs')
const EXIT = { SIGINT: 130, SIGTERM: 143 }

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const deadline = (promise, ms, label) => {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

/**
 * Starts a runner over a stale `passed` report, waits for the `until` phase
 * handshake, sends `signals` to the runner only, and collects the outcome.
 */
async function interrupt(t, { runner, args, until, signals }) {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'corn-audit-interrupt-')),
  )
  t.after(() => rm(dir, { recursive: true, force: true }))
  const labs = join(dir, 'labs')
  const temp = join(dir, 'tmp')
  await mkdir(labs)
  await mkdir(temp)
  const reportPath = join(dir, 'report.json')
  await writeFile(reportPath, JSON.stringify({ status: 'passed' }))
  const child = spawn(process.execPath, [runner, ...args, reportPath, labs], {
    cwd: repo,
    env: { PATH: process.env.PATH, HOME: dir, TMPDIR: temp },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill('SIGKILL'))
  const events = []
  let output = ''
  let reached
  const handshake = new Promise((resolve) => {
    reached = resolve
  })
  let pending = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    output += chunk
    pending += chunk
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('{')) continue
      const event = JSON.parse(line)
      events.push(event)
      if (event.phase === until) reached()
    }
  })
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    output += chunk
  })
  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  )
  await deadline(
    Promise.race([
      handshake,
      exited.then(() => {
        throw new Error(`runner exited before ${until}:\n${output}`)
      }),
    ]),
    15_000,
    `handshake ${until}`,
  )
  const sent = Date.now()
  for (const signal of signals) {
    child.kill(signal)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const exit = await deadline(exited, 15_000, 'runner exit')
  return {
    ...exit,
    elapsed: Date.now() - sent,
    events,
    output,
    pids: events.filter((event) => event.pid).map((event) => event.pid),
    phases: events.map((event) => event.phase).filter(Boolean),
    report: JSON.parse(await readFile(reportPath, 'utf8')),
    labs: await readdir(labs),
    temp: await readdir(temp),
    homes: events.filter((event) => event.home).map((event) => event.home),
  }
}

function assertInterrupted(result, signal) {
  assert.equal(result.code, EXIT[signal], result.output)
  assert.equal(result.report.status, 'interrupted')
  assert.equal(result.report.interrupted, signal)
  assert.ok(result.elapsed < 8_000, `took ${result.elapsed} ms`)
  assert.deepEqual(result.labs, [])
}

function assertCleaned(result) {
  assert.equal(result.report.cleanup.ok, true, result.output)
  assert.deepEqual(result.temp, [])
  for (const pid of result.pids) assert.equal(alive(pid), false, `pid ${pid}`)
}

test('an interrupted audit ends in the interrupted state with a signal exit code, never running or passed', async (t) => {
  const result = await interrupt(t, {
    runner: AUDIT_RUNNER,
    args: [],
    until: 'body',
    signals: ['SIGINT'],
  })
  assertInterrupted(result, 'SIGINT')
  assertCleaned(result)
  assert.equal(result.report.cleanup.lockReleased, true)
})

test('SIGTERM while the bootstrap Host starts stops it and removes the template home before the lab', async (t) => {
  const result = await interrupt(t, {
    runner: TEMPLATE_RUNNER,
    args: ['bootstrap'],
    until: 'bootstrap',
    signals: ['SIGTERM'],
  })
  assertInterrupted(result, 'SIGTERM')
  assertCleaned(result)
  assert.deepEqual(result.phases, ['bootstrap'])
  assert.equal(existsSync(result.homes[0]), false)
})

test('SIGINT during the Claw install kills its TERM-ignoring child and never reaches the governed check', async (t) => {
  const result = await interrupt(t, {
    runner: TEMPLATE_RUNNER,
    args: ['install'],
    until: 'install',
    signals: ['SIGINT'],
  })
  assertInterrupted(result, 'SIGINT')
  assertCleaned(result)
  assert.deepEqual(result.phases, ['bootstrap', 'install'])
})

test('SIGTERM during the governed check never copies the profile', async (t) => {
  const result = await interrupt(t, {
    runner: TEMPLATE_RUNNER,
    args: ['governed'],
    until: 'governed',
    signals: ['SIGTERM'],
  })
  assertInterrupted(result, 'SIGTERM')
  assertCleaned(result)
  assert.deepEqual(result.phases, ['bootstrap', 'governed'])
})

test('SIGINT after the copy never finishes the template', async (t) => {
  const result = await interrupt(t, {
    runner: TEMPLATE_RUNNER,
    args: ['verify'],
    until: 'verify',
    signals: ['SIGINT'],
  })
  assertInterrupted(result, 'SIGINT')
  assertCleaned(result)
  assert.equal(result.report.capabilities.template, undefined)
})

test('repeated signals during cleanup neither skip nor repeat it', async (t) => {
  const result = await interrupt(t, {
    runner: TEMPLATE_RUNNER,
    args: ['install'],
    until: 'install',
    signals: ['SIGINT', 'SIGTERM', 'SIGINT'],
  })
  assertInterrupted(result, 'SIGINT')
  assertCleaned(result)
})

test('a Host that never stops hits the bound, keeps the template home and reports cleanup failed', async (t) => {
  const result = await interrupt(t, {
    runner: TEMPLATE_RUNNER,
    args: ['hung-governed'],
    until: 'governed',
    signals: ['SIGTERM'],
  })
  const governed = result.events.find((event) => event.phase === 'governed')
  t.after(() => {
    if (alive(governed.pid)) process.kill(governed.pid, 'SIGKILL')
  })
  assertInterrupted(result, 'SIGTERM')
  assert.equal(result.report.cleanup.ok, false)
  assert.deepEqual(result.report.cleanup.owned.failed, ['governed Host'])
  assert.deepEqual(result.report.cleanup.owned.retained, ['template home'])
  assert.ok(result.report.problems.includes('cleanup failed'))
  assert.equal(existsSync(governed.home), true)
})
