import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { HostAuth } from '../apps/desktop/src/runtime/host-auth.ts'
import { parseReadinessLine } from '../apps/desktop/src/runtime/host-readiness.ts'
import {
  assertIsolatedHome,
  cornHostEnvironment,
  defaultDevelopmentHome,
} from '../apps/desktop/src/runtime/profile-bootstrap.ts'
import { ClawRegistryClient } from '../packages/dsh-adapter/src/claw-registry-client.ts'
import { SessionClient } from '../packages/dsh-adapter/src/session-client.ts'
import { HostTransport } from '../packages/dsh-adapter/src/transport.ts'

// Run: node scripts/smoke-governance.mjs [--ptc]. No setup or active profile mutation.
// Only read the Corn-owned installed packages; never copy model configuration.
// --ptc presents the official run_code tool (tools.mode both) in the disposable Host.
const ptc = process.argv.includes('--ptc')
const CASES = ptc
  ? ['gate-deny', 'ptc-developer']
  : ['gate-deny', 'remote-reject', 'remote-cancel']
const source = assertIsolatedHome(
  process.env.CORN_DSH_HOME || defaultDevelopmentHome(),
)
const owner = JSON.parse(
  await readFile(join(source, '.corn-bot-home.json'), 'utf8'),
)
assert.equal(owner.owner, 'corn-bot')
const sourceProfile = join(source, 'profiles', 'corn-dev')
const installed = JSON.parse(
  await readFile(join(sourceProfile, 'package.json'), 'utf8'),
)
assert.equal(installed.dependencies['dsh-claw-suite'], '0.3.0-rc.2')
const require = createRequire(import.meta.url)
const manifest = require.resolve('@deepseek-ai/dsh/package.json')
assert.equal(require(manifest).version, '0.2.0-rc.2')
const home = assertIsolatedHome(
  await mkdtemp(join(tmpdir(), 'corn-m0-governance-')),
)
const profile = join(home, 'profiles', 'corn-dev')
const checks = []
let child
let mux
let exited
let auth
let transport
const globalDeadline = AbortSignal.timeout(120_000)
const check = (name, facts = {}) => {
  checks.push({ name, passed: true, ...facts })
  console.log(`PASS ${name}`)
}

async function post(path, body) {
  const response = await fetch(auth.url(path), {
    method: 'POST',
    headers: { ...auth.headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.any([globalDeadline, AbortSignal.timeout(10_000)]),
  })
  assert.equal(response.status, 200, `Unexpected HTTP status for ${path}`)
  const value = await response.json()
  assert.equal(value.ok, true, `Host rejected ${path}`)
  return value
}
async function eventually(read, predicate, label) {
  const until = Date.now() + 25_000
  while (Date.now() < until) {
    globalDeadline.throwIfAborted()
    const value = await read()
    if (predicate(value)) return value
    await delay(100, undefined, { signal: globalDeadline })
  }
  throw new Error(`Deadline exceeded: ${label}`)
}
async function snapshotFor(sessionId) {
  let snapshot
  let failure
  const stop = mux.open(
    'session/follow',
    { request: { address: { kind: 'session', sessionId }, maxMessages: 100 } },
    (item) => {
      if (item.type === 'snapshot') snapshot = item
    },
    (error) => {
      failure = error
    },
  )
  try {
    return await eventually(
      async () => {
        if (failure) throw failure
        return snapshot
      },
      Boolean,
      'fresh Session snapshot',
    )
  } finally {
    stop()
  }
}
/**
 * Claw classifies run_code as an unlisted transport and denies it under every
 * preset, so the nested bash call must never be dispatched or executed.
 */
async function assertPtcDenied(sessionId, callId, probe) {
  assert.equal(probe.transport, 'run_code')
  const outer = probe.toolResults.find((row) => row.name === 'run_code')
  assert.ok(outer, 'Official run_code pipeline must return a result')
  assert.equal(outer.isError, true)
  assert.equal(outer.rootCallId, callId)
  assert.equal(
    probe.toolResults.some((row) => row.name === 'bash'),
    false,
    'Nested bash must not reach the tool pipeline',
  )
  const audit = await post('/api/dsh-claw/gate/audit', { limit: 200 })
  assert.ok(
    audit.items.some(
      (row) =>
        row.sessionId === sessionId &&
        row.tool === 'run_code' &&
        row.kind === 'deny',
    ),
  )
  const observe = await post('/api/dsh-claw/observability/query', {
    limit: 500,
  })
  assert.ok(
    observe.items.some(
      (row) =>
        row.sessionId === sessionId &&
        row.traceId === probe.traceId &&
        row.code === 'GATE_POLICY_DENIED',
    ),
    'Official Gate trace must match the run_code root call',
  )
  const snapshot = await snapshotFor(sessionId)
  const page = await transport.rpc('session/page', {
    request: {
      address: { kind: 'session', sessionId },
      throughSeq: snapshot.cursor,
      maxMessages: 100,
    },
  })
  const records = page.records.map((row) => row.event || row)
  assert.equal(
    records.some((row) => row.type.startsWith('tool/ptc-dispatch')),
    false,
    'A denied run_code must not dispatch nested calls',
  )
  assert.equal(
    records.some((row) => row.type === 'approval/asked'),
    false,
  )
  return {
    case: probe.case,
    sessionId,
    callId,
    transport: probe.transport,
    traceId: probe.traceId,
    bashExecutions: 0,
    nestedDispatches: 0,
    deniedTool: 'run_code',
  }
}
try {
  await writeFile(
    join(home, '.corn-bot-home.json'),
    JSON.stringify({
      owner: 'corn-bot',
      purpose: 'm0-governance-probe',
      schemaVersion: 1,
    }),
  )
  await mkdir(profile, { recursive: true, mode: 0o700 })
  await writeFile(
    join(profile, 'package.json'),
    JSON.stringify({
      name: 'corn-m0-governance-profile',
      private: true,
      dependencies: { 'dsh-claw-suite': '0.3.0-rc.2' },
      dsh: {
        profile: {
          bundles: [
            '@deepseek-ai/dsh-base',
            '@deepseek-ai/dsh-web-app',
            'dsh-claw-suite',
          ],
        },
      },
    }),
  )
  // Shared package directory is read-only in this test; no installer is invoked.
  await symlink(
    join(sourceProfile, 'node_modules'),
    join(profile, 'node_modules'),
    'dir',
  )
  await writeFile(join(profile, 'cordis.yml'), '')
  await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
  const patch = join(home, 'probe.patch.yml')
  const fixture = new URL(
    '../tests/fixtures/dsh-corn-m0-probe/host.js',
    import.meta.url,
  ).href
  await writeFile(
    patch,
    `- id: workspace-controller\n  config:\n    documentsDirectory: ${JSON.stringify(join(home, 'documents'))}\n${ptc ? '- id: tools\n  config:\n    mode: both\n' : ''}- insert:\n    - id: dsh-corn-m0-probe\n      name: ${JSON.stringify(fixture)}\n      config:\n        enabled: true\n        testHome: ${JSON.stringify(home)}\n`,
  )
  const env = cornHostEnvironment(home, null)
  child = spawn(
    process.execPath,
    [
      join(dirname(manifest), 'lib', 'bin.js'),
      'corn-dev',
      '--patch',
      patch,
      '--no-open',
      '--port',
      '0',
    ],
    {
      cwd: home,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  exited = new Promise((resolve) => child.once('close', resolve))
  const launch = await new Promise((resolve, reject) => {
    let pending = ''
    const timer = setTimeout(
      () => reject(new Error('Disposable Host readiness deadline exceeded')),
      45_000,
    )
    child.once('error', reject)
    child.once('close', () => {
      clearTimeout(timer)
      reject(new Error('Disposable Host exited before readiness'))
    })
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      pending += chunk
      const lines = pending.split(/\r?\n/u)
      pending = lines.pop() || ''
      if (pending.length > 128 * 1024) {
        clearTimeout(timer)
        reject(new Error('Readiness output limit exceeded'))
      }
      for (const line of lines) {
        try {
          const url = parseReadinessLine(line)
          if (url) {
            clearTimeout(timer)
            resolve(url)
          }
        } catch (error) {
          clearTimeout(timer)
          reject(error)
        }
      }
    })
    // Drain diagnostics without retaining tokens, cookies, local paths or logs.
    child.stderr.resume()
  })
  auth = await HostAuth.exchange(launch)
  check('disposable-keyless-rc2-host-authenticated')
  transport = new HostTransport(auth)
  const registry = new ClawRegistryClient(transport)
  const sessions = new SessionClient(transport)
  mux = await transport.connect()
  let clientId
  let streamError
  const requests = []
  const withdrawn = new Set()
  mux.open(
    '$events',
    {},
    (item) => {
      if (item.type === 'ready') clientId = item.clientId
      if (item.type === 'waterfall' && item.event === 'approval/request')
        requests.push(item)
      if (item.type === 'cancel') withdrawn.add(item.eventId)
    },
    (error) => {
      streamError = error
    },
  )
  await eventually(
    async () => {
      if (streamError) throw streamError
      return clientId
    },
    Boolean,
    '$events ready',
  )
  const evidence = []
  for (const testCase of CASES) {
    // Claw diagnostics deduplicate the same rejection code for eight seconds.
    // Keep repeated DENY/ASK traces observable without changing its rate limiter.
    if (testCase === 'remote-cancel' || testCase === 'ptc-developer')
      await delay(8100, undefined, { signal: globalDeadline })
    const agent = await registry.create(
      `Corn M0 ${testCase} ${randomUUID().slice(0, 8)}`,
    )
    await post('/api/dsh-claw/registry/policy', {
      agentId: agent.agentId,
      policy: { preset: testCase === 'gate-deny' ? 'research' : 'developer' },
    })
    await registry.ensurePreset(agent)
    const sessionId = `corn-m0-governance-${randomUUID()}`
    await sessions.create({
      sessionId,
      cwd: agent.canonicalRoot,
      agentPreset: agent.dshPreset,
    })
    await registry.bind(agent, sessionId)
    const armed = await post('/api/corn-m0-probe/arm', {
      sessionId,
      case: testCase,
    })
    const requestId = randomUUID()
    await sessions.prompt({
      sessionId,
      requestId,
      mode: 'queue',
      content: [
        { type: 'text', text: 'Run the bounded Corn M0 governance fixture.' },
      ],
      clientTimeZone: 'UTC',
    })
    let remoteEventId
    let queuedRequestId
    if (testCase.startsWith('remote-')) {
      const question = await eventually(
        async () => {
          if (streamError) throw streamError
          return requests.find((item) => item.agentId === sessionId)
        },
        Boolean,
        'Remote approval question',
      )
      assert.equal(question.request.toolName, 'bash')
      remoteEventId = question.eventId
      if (testCase === 'remote-reject')
        await transport.rpc('$events/result', {
          clientId,
          eventId: remoteEventId,
          outcome: { kind: 'result', value: 'rejected' },
        })
      else {
        queuedRequestId = randomUUID()
        await sessions.prompt({
          sessionId,
          requestId: queuedRequestId,
          mode: 'queue',
          content: [
            { type: 'text', text: 'Preserve this queued Corn M0 input.' },
          ],
          clientTimeZone: 'UTC',
        })
        const beforeCancel = await snapshotFor(sessionId)
        assert.ok(
          beforeCancel.projections.values.inbox['next-turn'].some(
            (item) => item.source.rpcId === queuedRequestId,
          ),
        )
        await sessions.cancel(sessionId)
      }
    }
    const result = await eventually(
      () => post('/api/corn-m0-probe/result', { sessionId }),
      (value) => ['done', 'failed'].includes(value.probe.status),
      'bounded tool result',
    )
    const probe = result.probe
    assert.equal(probe.status, 'done')
    assert.equal(probe.bashExecutions, 0)
    if (ptc) {
      evidence.push(await assertPtcDenied(sessionId, armed.callId, probe))
      check(testCase, { transport: probe.transport, bashExecutions: 0 })
      continue
    }
    assert.equal(probe.transport, 'native-bash')
    const bash = probe.toolResults.find((row) => row.name === 'bash')
    assert.ok(bash, 'Actual official bash pipeline must return a result')
    assert.equal(bash.isError, true)
    assert.equal(bash.rootCallId, armed.callId)
    const audit = await post('/api/dsh-claw/gate/audit', { limit: 200 })
    assert.ok(
      audit.items.some(
        (row) =>
          row.sessionId === sessionId &&
          row.tool === 'bash' &&
          row.kind === (testCase === 'gate-deny' ? 'deny' : 'ask'),
      ),
    )
    const observe = await post('/api/dsh-claw/observability/query', {
      limit: 500,
    })
    const code =
      testCase === 'gate-deny' ? 'GATE_POLICY_DENIED' : 'GATE_POLICY_ASK'
    assert.ok(
      observe.items.some(
        (row) =>
          row.sessionId === sessionId &&
          row.traceId === probe.traceId &&
          row.code === code,
      ),
      'Official Gate trace must match root call',
    )
    // Fresh follow baseline fixes the historical inclusive log cut for page.
    const snapshot = await snapshotFor(sessionId)
    const page = await transport.rpc('session/page', {
      request: {
        address: { kind: 'session', sessionId },
        throughSeq: snapshot.cursor,
        maxMessages: 100,
      },
    })
    const records = page.records.map((row) => row.event || row)
    const decided = records.find((row) => row.type === 'approval/decided')
    const asked = records.find((row) => row.type === 'approval/asked')
    assert.ok(records.some((row) => row.type === 'turn/start'))
    const turnEnd = records.find((row) => row.type === 'turn/end')
    assert.ok(turnEnd)
    assert.equal(
      records.some((row) => row.type === 'assistant/message'),
      false,
    )
    if (testCase === 'gate-deny') assert.equal(asked, undefined)
    else {
      assert.equal(asked.data.callId, bash.callId)
      assert.equal(decided.data.id, asked.data.id)
      assert.equal(
        decided.data.outcome,
        testCase === 'remote-reject' ? 'rejected' : 'cancelled',
      )
      assert.notEqual(remoteEventId, asked.data.id)
      if (testCase === 'remote-cancel')
        await eventually(
          async () => withdrawn.has(remoteEventId),
          Boolean,
          'Remote approval withdrawal after Session cancellation',
        )
      if (testCase === 'remote-cancel') {
        assert.deepEqual(turnEnd.data.reason, {
          kind: 'aborted',
          reason: { kind: 'user' },
        })
        assert.equal(
          records.filter((row) => row.type === 'turn/start').length,
          1,
        )
        assert.ok(
          snapshot.projections.values.inbox['next-turn'].some(
            (item) => item.source.rpcId === queuedRequestId,
          ),
          'Cancel must retain the actual next-turn queued request',
        )
      }
    }
    evidence.push({
      case: testCase,
      sessionId,
      requestId,
      callId: armed.callId,
      bashCallId: bash.callId,
      turn: probe.turn,
      traceId: probe.traceId,
      transport: probe.transport,
      bashExecutions: 0,
      approvalOutcome: decided?.data.outcome || null,
      auditId: asked?.data.id || null,
      remoteEventId: remoteEventId || null,
      remoteWithdrawn: remoteEventId ? withdrawn.has(remoteEventId) : false,
      queuedRequestId: queuedRequestId || null,
      queuePreserved: testCase === 'remote-cancel' ? true : null,
      turnEndReason: turnEnd.data.reason,
    })
    check(testCase, { transport: probe.transport, bashExecutions: 0 })
  }
  const artifact = new URL(
    `../.artifacts/m0-governance${ptc ? '-ptc' : ''}-smoke.json`,
    import.meta.url,
  )
  await mkdir(dirname(fileURLToPath(artifact)), {
    recursive: true,
    mode: 0o700,
  })
  await writeFile(
    artifact,
    `${JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        dshVersion: '0.2.0-rc.2',
        clawVersion: '0.3.0-rc.2',
        checks,
        evidence,
        scope: ptc
          ? 'Real Claw-bound Session Turn with the official run_code tool presented (tools.mode both). The fixture executes run_code whose program calls bash; Claw denies run_code itself under research and developer, so no nested call is dispatched or executed. Nested-call gating of an allowed run_code is not claimed.'
          : 'Real Claw-bound Session Turn and public tools pipeline, fixed printf, actual Gate audit and Remote approval through the Corn HostTransport adapter. No LLM request or model tool transcript. Native bash composition only; PTC is covered by --ptc.',
        pending: ptc ? ['nested-call-gating-of-an-allowed-run_code'] : [],
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  )
} finally {
  mux?.close()
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
    let timer
    const stopped = await Promise.race([
      exited.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), 8000)
      }),
    ])
    clearTimeout(timer)
    if (!stopped) {
      child.kill('SIGKILL')
      await exited
    }
  }
  await rm(home, { recursive: true, force: true })
}
