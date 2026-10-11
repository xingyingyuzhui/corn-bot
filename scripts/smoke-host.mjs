import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DshHostSupervisor } from '../apps/desktop/src/runtime/dsh-host-supervisor.ts'
import { defaultDevelopmentHome } from '../apps/desktop/src/runtime/profile-bootstrap.ts'
import { ClawRegistryClient } from '../packages/dsh-adapter/src/claw-registry-client.ts'
import { record } from '../packages/dsh-adapter/src/remote-error.ts'
import { SessionClient } from '../packages/dsh-adapter/src/session-client.ts'
import { HostTransport } from '../packages/dsh-adapter/src/transport.ts'

const home = process.env.CORN_DSH_HOME ?? defaultDevelopmentHome()
let unexpectedExit = false
const host = new DshHostSupervisor(home, () => {
  unexpectedExit = true
})
const checks = []
const artifacts = new URL('../.artifacts/', import.meta.url)
let mux
const check = (name, facts = {}) => {
  checks.push({ name, passed: true, ...facts })
  console.log(`PASS ${name}`)
}
try {
  const auth = await host.start()
  check('independent-rc2-host-ready-cookie-exchange')
  const transport = new HostTransport(auth)
  const sessions = new SessionClient(transport)
  const registry = new ClawRegistryClient(transport)

  const noCookie = await fetch(auth.url('/api/session/list'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(noCookie.status, 401)
  check('unauthenticated-api-rejected', { status: noCookie.status })
  const badOrigin = await fetch(auth.url('/api/session/list'), {
    method: 'POST',
    headers: {
      ...auth.headers(),
      Origin: 'https://corn.invalid',
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  assert.equal(badOrigin.status, 403)
  check('authenticated-wrong-origin-rejected', { status: badOrigin.status })
  await sessions.list()
  check('authenticated-session-list')
  const agent = await registry.create(`Corn M0 ${randomUUID().slice(0, 8)}`)
  assert.ok(agent.canonicalRoot.startsWith(`${join(home, 'DSclaw')}/`))
  await registry.ensurePreset(agent)
  check('real-claw-create-and-preset-ensure')
  const sessionId = `corn-m0-${randomUUID()}`
  await sessions.create({
    sessionId,
    cwd: agent.canonicalRoot,
    agentPreset: agent.dshPreset,
  })
  await registry.bind(agent, sessionId)
  await registry.state(sessionId, 'needs_model')
  check('real-session-preset-and-claw-binding')

  async function snapshot() {
    mux = await transport.connect()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Session snapshot timeout')),
        10_000,
      )
      mux.open(
        'session/follow',
        {
          request: {
            address: { kind: 'session', sessionId },
            assistantStream: true,
            maxMessages: 100,
          },
        },
        (item) => {
          const frame = record(item)
          if (frame.type === 'snapshot') {
            clearTimeout(timer)
            resolve(frame)
          }
        },
        (error) => {
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  }
  const first = await snapshot()
  check('authenticated-websocket-session-snapshot')
  mux.close()
  const second = await snapshot()
  assert.deepEqual(second, first)
  check('websocket-reconnect-fresh-snapshot-consistent')
  const missingSession = `missing-${randomUUID()}`
  await assert.rejects(registry.bind(agent, missingSession))
  check('invalid-session-binding-rejected')
  await assert.rejects(
    sessions.create({
      sessionId: `corn-bad-${randomUUID()}`,
      cwd: agent.canonicalRoot,
      agentPreset: 'wa-nonexistent-corn-m0',
    }),
  )
  check('missing-claw-preset-no-standard-fallback')

  const db = new DatabaseSync(join(home, 'corn-m0-sqlite-probe.sqlite'))
  try {
    db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS probe (id TEXT PRIMARY KEY);',
    )
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
    db.prepare('INSERT OR IGNORE INTO probe VALUES (?)').run('corn-m0')
    assert.equal(
      db.prepare('SELECT COUNT(*) AS total FROM probe').get().total,
      1,
    )
    check('node-sqlite-wal-driver')
  } finally {
    db.close()
  }

  mux.close()
  mux = undefined
  const previousOrigin = auth.origin
  await Promise.all(Array.from({ length: 5 }, () => host.stop()))
  await assert.rejects(
    fetch(previousOrigin, { signal: AbortSignal.timeout(2_000) }),
  )
  check('graceful-stop-port-released')
  const restarted = await host.start()
  const afterRestart = new HostTransport(restarted)
  const newRegistry = new ClawRegistryClient(afterRestart)
  await newRegistry.ensurePreset(agent)
  const list = await new SessionClient(afterRestart).list()
  assert.ok(list.some((item) => record(item).sessionId === sessionId))
  check('host-restart-durable-claw-session-recovery')
  assert.ok(host.processId)
  process.kill(host.processId, 'SIGKILL')
  const crashDeadline = Date.now() + 5_000
  while (!unexpectedExit && Date.now() < crashDeadline)
    await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(unexpectedExit, true)
  await host.stop()
  const recovered = new HostTransport(await host.start())
  await new ClawRegistryClient(recovered).ensurePreset(agent)
  assert.ok(
    (await new SessionClient(recovered).list()).some(
      (item) => record(item).sessionId === sessionId,
    ),
  )
  check('forced-host-crash-notified-and-session-recovered')
  await mkdir(artifacts, { recursive: true, mode: 0o700 })
  const report = {
    recordedAt: new Date().toISOString(),
    dshVersion: '0.2.0-rc.2',
    clawVersion: '0.3.0-rc.2',
    checks,
    pending: [
      'real-model-stream-and-final-message',
      'active-turn-cancel-with-queue',
      'gate-and-interactive-approval',
      'packaged-app-runtime',
    ],
    scope:
      'Real isolated Host/Claw integration. No existing DSH credentials, model call or desktop input.',
  }
  await writeFile(
    new URL('m0-host-smoke.json', artifacts),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  )
  console.log(
    `${checks.length} live checks passed. Model, Gate/Approval and app packaging remain pending.`,
  )
} finally {
  mux?.close()
  await host.stop()
}
