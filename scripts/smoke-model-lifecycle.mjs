import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { createGovernedHost } from '../apps/desktop/src/runtime/claw-runtime-check.ts'
import { resolveCornModelConfig } from '../apps/desktop/src/runtime/model-provider.ts'
import { defaultDevelopmentHome } from '../apps/desktop/src/runtime/profile-bootstrap.ts'
import { record } from '../packages/dsh-adapter/src/remote-error.ts'
import {
  eventually,
  ModelHarness,
  toolCallTraceId,
} from './lib/model-session.mjs'

// Real, billable model Turns in Corn's developer home: in-flight cancel with a
// retained queue, model-generated tool calls through the Claw Gate, and log
// recovery after forced Host exits. Exports ids, codes and counts only.
const model = resolveCornModelConfig()
if (!model)
  throw new Error(
    'Configure CORN_MODEL_PROVIDER, CORN_MODEL_ID and CORN_MODEL_API_KEY locally before model lifecycle smokes',
  )

const PRINTF = "printf 'corn-m0-model\\n'"
const TOOL_PROMPT = `Use the bash tool exactly once to run this exact command: ${PRINTF}. Do not use any other tool. After the tool returns, reply with one short sentence.`
const TURN_TIMEOUT = 150_000

let unexpectedExit = false
const host = createGovernedHost(
  process.env.CORN_DSH_HOME ?? defaultDevelopmentHome(),
  {
    onFailure: () => {
      unexpectedExit = true
    },
    model,
  },
)
const checks = []
const check = (name, facts = {}) => {
  checks.push({ name, passed: true, ...facts })
  console.log(`PASS ${name}`)
}
const ofType = (events, type) => events.filter((event) => event.type === type)
const onlyOne = (events, type) => {
  const rows = ofType(events, type)
  assert.equal(rows.length, 1, `Expected exactly one ${type}`)
  return record(rows[0].data)
}
function assertContiguous(events) {
  for (const [index, event] of events.entries())
    assert.equal(event.seq, index, 'Durable log must be contiguous from 0')
}
function inboxHas(snapshot, requestId) {
  const inbox = record(record(record(snapshot.projections).values).inbox)
  const next = Array.isArray(inbox['next-turn']) ? inbox['next-turn'] : []
  return next.some((item) => record(record(item).source).rpcId === requestId)
}

/** The model's own bash call: tool/call, blocked tool/result, matching trace. */
function modelBashCall(events) {
  const call = onlyOne(events, 'tool/call')
  assert.equal(call.name, 'bash', 'Model must call bash itself')
  assert.equal(typeof call.callId, 'string')
  const result = record(onlyOne(events, 'tool/result').message)
  assert.equal(result.toolCallId, call.callId)
  assert.equal(result.isError, true, 'Gate must block the model bash call')
  return { callId: call.callId, traceId: toolCallTraceId(call.callId) }
}
async function assertGateEvidence(h, sessionId, kind, code, traceId) {
  const audit = await h.claw('gate/audit', { limit: 200 })
  assert.ok(
    audit.items.some(
      (row) =>
        row.sessionId === sessionId && row.tool === 'bash' && row.kind === kind,
    ),
    `Gate audit must record ${kind} for this Session`,
  )
  const observe = await h.claw('observability/query', { limit: 500 })
  assert.ok(
    observe.items.some(
      (row) =>
        row.sessionId === sessionId &&
        row.traceId === traceId &&
        row.code === code,
    ),
    'Official Gate trace must match the model tool call',
  )
}

async function modelCancelInFlight(h) {
  const { sessionId } = await h.boundSession('model-cancel', 'research')
  const follow = await h.follow(sessionId)
  try {
    const first = await h.prompt(
      sessionId,
      'Write the integers from 1 to 800 in English words, one per line. Do not call tools.',
    )
    await follow.waitUntil(
      (state) => state.chunks > 0,
      'first live model chunk',
      TURN_TIMEOUT,
    )
    assert.equal(
      ofType(follow.state.events, 'turn/end').length,
      0,
      'Cancel must target a Turn that is still streaming',
    )
    const queued = await h.prompt(
      sessionId,
      'Preserve this queued Corn input; it must not run in the cancelled Turn.',
    )
    assert.ok(inboxHas((await h.page(sessionId)).snapshot, queued))
    const chunksAtCancel = follow.state.chunks
    await h.sessions.cancel(sessionId)
    const end = await follow.waitFor(
      (event) => event.type === 'turn/end',
      'cancelled turn end',
      30_000,
    )
    assert.deepEqual(record(end.data).reason, {
      kind: 'aborted',
      reason: { kind: 'user' },
    })
    await delay(1_500)
    const { snapshot, events } = await h.page(sessionId)
    assertContiguous(events)
    assert.equal(
      ofType(events, 'turn/start').length,
      1,
      'Queued input must not start a Turn by itself after cancel',
    )
    assert.equal(
      onlyOne(events, 'assistant/message').interrupted,
      true,
      'The partial streamed reply must be committed as interrupted',
    )
    assert.ok(
      inboxHas(snapshot, queued),
      'Cancel must retain the queued request',
    )
    check('model-in-flight-cancel-retains-queue', {
      sessionId,
      requestId: first,
      queuedRequestId: queued,
      chunksAtCancel,
      turnEndReason: record(end.data).reason,
    })
  } finally {
    follow.cancel()
  }
}

async function modelGateDeny(h) {
  const { sessionId } = await h.boundSession('model-gate-deny', 'research')
  const follow = await h.follow(sessionId)
  try {
    await h.prompt(sessionId, TOOL_PROMPT)
    await follow.waitFor(
      (event) => event.type === 'turn/end',
      'gate-deny turn end',
      TURN_TIMEOUT,
    )
  } finally {
    follow.cancel()
  }
  const { events } = await h.page(sessionId)
  assertContiguous(events)
  const { callId, traceId } = modelBashCall(events)
  assert.equal(ofType(events, 'approval/asked').length, 0)
  assert.equal(record(onlyOne(events, 'turn/end').reason).kind, 'completed')
  await assertGateEvidence(h, sessionId, 'deny', 'GATE_POLICY_DENIED', traceId)
  check('model-tool-call-gate-deny-trace', { sessionId, callId, traceId })
}

async function modelRemoteReject(h) {
  const { sessionId } = await h.boundSession('model-remote-reject', 'developer')
  let clientId
  let streamError
  const questions = []
  const stopEvents = h.mux.open(
    '$events',
    {},
    (item) => {
      if (item.type === 'ready') clientId = item.clientId
      if (item.type === 'waterfall' && item.event === 'approval/request')
        questions.push(item)
    },
    (error) => {
      streamError = error
    },
  )
  const follow = await h.follow(sessionId)
  try {
    await eventually(
      async () => {
        if (streamError) throw streamError
        return clientId
      },
      Boolean,
      '$events ready',
    )
    await h.prompt(sessionId, TOOL_PROMPT)
    const question = await eventually(
      async () => {
        if (streamError) throw streamError
        return questions.find((item) => item.agentId === sessionId)
      },
      Boolean,
      'Remote approval question for the model bash call',
      TURN_TIMEOUT,
    )
    assert.equal(question.request.toolName, 'bash')
    await h.transport.rpc('$events/result', {
      clientId,
      eventId: question.eventId,
      outcome: { kind: 'result', value: 'rejected' },
    })
    await follow.waitFor(
      (event) => event.type === 'turn/end',
      'remote-reject turn end',
      TURN_TIMEOUT,
    )
  } finally {
    follow.cancel()
    stopEvents()
  }
  const { events } = await h.page(sessionId)
  assertContiguous(events)
  const { callId, traceId } = modelBashCall(events)
  const asked = onlyOne(events, 'approval/asked')
  const decided = onlyOne(events, 'approval/decided')
  assert.equal(asked.callId, callId)
  assert.equal(decided.id, asked.id)
  assert.equal(decided.outcome, 'rejected')
  await assertGateEvidence(h, sessionId, 'ask', 'GATE_POLICY_ASK', traceId)
  check('model-tool-call-remote-reject-trace', {
    sessionId,
    callId,
    traceId,
    approvalOutcome: decided.outcome,
  })
}

async function crashAndRestart() {
  assert.ok(host.processId)
  unexpectedExit = false
  process.kill(host.processId, 'SIGKILL')
  await eventually(async () => unexpectedExit, Boolean, 'crash notice', 5_000)
  await host.stop()
  return new ModelHarness(await host.start(), model).connect()
}

async function modelLogRecovery(h) {
  const { agent, sessionId } = await h.boundSession(
    'model-recovery',
    'research',
  )
  const follow = await h.follow(sessionId)
  try {
    await h.prompt(
      sessionId,
      'Reply with the words Corn recovery verified. Do not call tools.',
    )
    await follow.waitFor(
      (event) => event.type === 'turn/end',
      'recovery turn end',
      TURN_TIMEOUT,
    )
  } finally {
    follow.cancel()
  }
  const before = await h.page(sessionId)
  const message = ofType(before.events, 'assistant/message').at(-1)
  const end = ofType(before.events, 'turn/end').at(-1)
  assert.ok(message && end)
  h.close()
  const recovered = await crashAndRestart()
  await recovered.registry.ensurePreset(agent)
  const after = await recovered.page(sessionId)
  assertContiguous(after.events)
  const same = (event) =>
    after.events.find((row) => row.seq === event.seq && row.type === event.type)
  assert.equal(
    record(record(same(message)?.data).message).id,
    record(record(message.data).message).id,
    'Committed model message must survive a forced Host exit',
  )
  assert.equal(record(record(same(end)?.data).reason).kind, 'completed')
  check('model-log-recovered-after-forced-exit', {
    sessionId,
    assistantSeq: message.seq,
    turnEndSeq: end.seq,
  })
  return recovered
}

async function modelMidStreamCrash(h) {
  const { agent, sessionId } = await h.boundSession('model-crash', 'research')
  const follow = await h.follow(sessionId)
  let seen
  try {
    await h.prompt(
      sessionId,
      'Write the integers from 1 to 800 in English words, one per line. Do not call tools.',
    )
    await follow.waitUntil(
      (state) => state.chunks > 0,
      'first live model chunk before crash',
      TURN_TIMEOUT,
    )
    seen = follow.state.events.map(({ seq, type }) => ({ seq, type }))
  } finally {
    follow.cancel()
  }
  h.close()
  const recovered = await crashAndRestart()
  await recovered.registry.ensurePreset(agent)
  const after = await recovered.page(sessionId)
  assertContiguous(after.events)
  for (const event of seen)
    assert.ok(
      after.events.some(
        (row) => row.seq === event.seq && row.type === event.type,
      ),
      'Durable events observed before the crash must be recovered',
    )
  assert.ok(seen.some((event) => event.type === 'turn/start'))
  assert.deepEqual(
    onlyOne(after.events, 'turn/end').reason,
    { kind: 'interrupted' },
    'Restart must close the orphaned Turn as interrupted',
  )
  check('model-mid-stream-crash-prefix-recovered', {
    sessionId,
    eventsBeforeCrash: seen.length,
    eventsAfterRestart: after.events.length,
    turnEndAfterRestart: { kind: 'interrupted' },
  })
  return recovered
}

let harness
try {
  harness = await new ModelHarness(await host.start(), model).connect()
  await harness.assertModelInCatalog()
  await modelCancelInFlight(harness)
  await modelGateDeny(harness)
  // Claw diagnostics deduplicate the same rejection code for eight seconds.
  await delay(8_100)
  await modelRemoteReject(harness)
  harness = await modelLogRecovery(harness)
  harness = await modelMidStreamCrash(harness)
  await mkdir(new URL('../.artifacts/', import.meta.url), {
    recursive: true,
    mode: 0o700,
  })
  await writeFile(
    new URL('../.artifacts/m0-model-lifecycle-smoke.json', import.meta.url),
    `${JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        runId: randomUUID(),
        route: model.route,
        model: model.model,
        checks,
        scope:
          'Real Corn-only model Turns: in-flight cancel with queue, model-generated bash through Claw Gate deny and Remote reject with matching root-call trace, durable log recovery after forced Host exits. No response content or credentials exported.',
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  )
} finally {
  harness?.close()
  await host.stop()
}
