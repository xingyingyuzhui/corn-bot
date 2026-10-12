import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  admission,
  assertNoLeaks,
  code,
  lastView,
  ok,
  S1,
  S2,
  SECRET,
  settle,
  setup,
  userBubbles,
} from './helpers/chat-world.ts'
import { job, sessionRow } from './helpers/fake-chat-host.ts'

// ---------------------------------------------------------------------------
// Withdrawal
// ---------------------------------------------------------------------------

test('cancelQueued: withdraws unsent and DSH-queued messages; a recorded one is stale', async (t) => {
  const world = await setup(t)
  world.chat.attachRuntime(world.host.runtime())
  ok(world.chat.select('bot_1'))
  await settle(world)

  world.host.faults.push({ reject: 'gateway/bad-request' })
  const rejected = ok(
    await world.chat.sendMessage({
      botId: 'bot_1',
      clientId: 'a',
      text: SECRET,
    }),
  )
  await settle(world)
  ok(await world.chat.cancelQueued({ botId: 'bot_1', messageId: rejected }))
  assert.equal(admission(world, rejected).state, 'withdrawn')
  assert.equal(admission(world, rejected).bodyText, null)

  world.host.busy = true
  const queued = ok(
    await world.chat.sendMessage({
      botId: 'bot_1',
      clientId: 'b',
      text: SECRET,
    }),
  )
  await settle(world)
  assert.equal(admission(world, queued).state, 'accepted')
  ok(await world.chat.cancelQueued({ botId: 'bot_1', messageId: queued }))
  assert.equal(admission(world, queued).state, 'withdrawn')
  assert.equal(world.host.count('updateQueue'), 1)
  assert.equal(world.host.inboxes.get(S1)?.length, 0)
  assert.equal(userBubbles(lastView(world)).length, 0)

  world.host.busy = false
  const delivered = ok(
    await world.chat.sendMessage({
      botId: 'bot_1',
      clientId: 'c',
      text: SECRET,
    }),
  )
  await settle(world)
  assert.equal(
    code(
      await world.chat.cancelQueued({ botId: 'bot_1', messageId: delivered }),
    ),
    'stale',
  )
  assert.equal(
    code(
      await world.chat.cancelQueued({ botId: 'bot_2', messageId: delivered }),
    ),
    'not_found',
    'another Bot cannot name this message',
  )
  assert.equal(
    code(await world.chat.resend({ botId: 'bot_1', messageId: rejected })),
    'stale',
  )
})

test('cancelQueued: a queued item claimed meanwhile settles as observed and is stale', async (t) => {
  const world = await setup(t)
  world.chat.attachRuntime(world.host.runtime())
  await settle(world)
  world.host.busy = true
  const messageId = ok(
    await world.chat.sendMessage({
      botId: 'bot_1',
      clientId: 'a',
      text: SECRET,
    }),
  )
  await settle(world)
  const runtime = world.host.runtime()
  const realUpdate = runtime.sessions.updateQueue
  world.chat.attachRuntime({
    ...runtime,
    sessions: {
      ...runtime.sessions,
      updateQueue: async (request) => {
        world.host.claim(S1)
        return realUpdate(request)
      },
    },
  })
  await settle(world)
  assert.equal(
    code(await world.chat.cancelQueued({ botId: 'bot_1', messageId })),
    'stale',
  )
  assert.equal(admission(world, messageId).state, 'observed')
})

// ---------------------------------------------------------------------------
// Stop (decision 8B)
// ---------------------------------------------------------------------------

test('cancelTurn: leaf first, owned jobs only, a job spawned mid-stop is killed, the parent last', async (t) => {
  const world = await setup(t)
  const host = world.host
  host.rows = [
    sessionRow(S1, { running: true }),
    sessionRow('child', { parent: S1, running: true }),
    sessionRow('grandchild', { parent: 'child', running: true }),
    sessionRow(S2, { running: true }),
    sessionRow('other-child', { parent: S2, running: true }),
  ]
  host.jobs = [
    job('job-grand', 'grandchild'),
    job('job-root', S1),
    job('job-foreign', null),
    job('job-other', S2),
  ]
  host.onInterrupt = (childId) => {
    host.rows = host.rows.map((row) =>
      row.sessionId === childId ? { ...row, running: false } : row,
    )
  }
  // The child starts a job after the pass already listed it: found on re-list.
  host.onKill = (jobId) => {
    if (jobId === 'job-root')
      host.jobs = [...host.jobs, job('job-late', 'child')]
  }
  world.chat.attachRuntime(host.runtime())
  await settle(world)
  ok(await world.chat.cancelTurn({ botId: 'bot_1' }))
  await settle(world)

  assert.equal(world.order[0], 'stopTurn')
  assert.deepEqual(world.broker.stopped, [S1])
  const control = host.calls.filter((call) =>
    ['interrupt', 'jobKill', 'cancel'].includes(call.op),
  )
  assert.deepEqual(
    control.map((call) => [call.op, call.target ?? call.sessionId]),
    [
      ['interrupt', 'grandchild'],
      ['interrupt', 'child'],
      ['jobKill', 'job-grand'],
      ['jobKill', 'job-root'],
      ['jobKill', 'job-late'],
      ['cancel', S1],
    ],
  )
  assert.ok(
    !host.calls.some(
      (call) =>
        call.target === 'other-child' ||
        call.target === 'job-other' ||
        call.target === 'job-foreign' ||
        (call.op === 'cancel' && call.sessionId === S2),
    ),
    'nothing outside this conversation is touched',
  )
  const stop = world.audits.find((audit) => audit.kind === 'stop')
  assert.ok(stop?.kind === 'stop')
  assert.equal(stop.outcome, 'stopped')
  assert.equal(stop.childrenInterrupted, 2)
  assert.equal(stop.jobsKilled, 3)
  assert.equal(stop.foreignJobs, 1)
  assert.equal(stop.parentCancel, 'cancelled')
  const verify = world.audits.find((audit) => audit.kind === 'stop-verify')
  assert.ok(verify?.kind === 'stop-verify')
  assert.equal(
    verify.verification.status,
    'residual',
    'the root row is still running in the fake',
  )
})

test('cancelTurn: a child that never stops gives stop_partial; the parent is still cancelled last', async (t) => {
  const world = await setup(t, {
    timing: { stop: { maxPasses: 3, passDelayMs: 0 } },
  })
  world.host.rows = [
    sessionRow(S1),
    sessionRow('stuck', { parent: S1, running: true }),
  ]
  world.chat.attachRuntime(world.host.runtime())
  await settle(world)
  ok(await world.chat.cancelTurn({ botId: 'bot_1' }))
  await settle(world)
  assert.equal(world.host.count('interrupt'), 3)
  const control = world.host.calls.filter(
    (call) => call.op === 'interrupt' || call.op === 'cancel',
  )
  assert.equal(control.at(-1)?.op, 'cancel')
  assert.equal(world.host.count('cancel'), 1)
  const stop = world.audits.find((audit) => audit.kind === 'stop')
  assert.ok(stop?.kind === 'stop')
  assert.equal(stop.outcome, 'stop_partial')
  assert.equal(stop.passes, 3)
  const verify = world.audits.find((audit) => audit.kind === 'stop-verify')
  assert.ok(verify?.kind === 'stop-verify')
  assert.deepEqual(verify.verification, {
    status: 'residual',
    runningSessions: 1,
    runningJobs: 0,
  })
})

test('cancelTurn: a Turn woken after the stop is cancelled at once and its steps counted; the next send lifts the fence', async (t) => {
  const world = await setup(t)
  world.host.rows = [sessionRow(S1)]
  world.chat.attachRuntime(world.host.runtime())
  ok(world.chat.select('bot_1'))
  await settle(world)
  world.host.append(S1, 'turn/start', { turn: 1 })
  ok(await world.chat.cancelTurn({ botId: 'bot_1' }))
  await settle(world)
  assert.equal(world.host.count('cancel'), 1)
  world.host.append(S1, 'turn/end', { turn: 1, reason: { kind: 'aborted' } })

  // A settlement notice wakes the parent: stale Turn.
  world.host.append(S1, 'turn/start', { turn: 2 })
  world.host.append(S1, 'step/start', { turn: 2, step: 0 })
  world.host.append(S1, 'turn/end', { turn: 2, reason: { kind: 'aborted' } })
  await settle(world)
  assert.equal(world.host.count('cancel'), 2)
  assert.deepEqual(
    world.audits
      .filter((audit) => audit.kind !== 'stop' && audit.kind !== 'stop-verify')
      .map((audit) => audit.kind),
    ['stale-turn', 'leaked-request'],
  )
  const leak = world.audits.find((audit) => audit.kind === 'leaked-request')
  assert.ok(leak?.kind === 'leaked-request')
  assert.equal(leak.total, 1)
  assert.equal(leak.turn, 2)

  // A rebuilt window repeats those events: not counted twice.
  world.host.dropFollows()
  world.scheduled.shift()?.()
  await settle(world)
  assert.equal(world.host.count('cancel'), 2)

  ok(
    await world.chat.sendMessage({ botId: 'bot_1', clientId: 'n', text: 'go' }),
  )
  await settle(world)
  assert.deepEqual(world.broker.resumed, [S1])
  world.host.append(S1, 'turn/start', { turn: 3 })
  await settle(world)
  assert.equal(world.host.count('cancel'), 2, 'the user Turn is not stale')
  assertNoLeaks(world)
})

test('cancelTurn: runtime not ready and concurrent stops share one run', async (t) => {
  const world = await setup(t)
  assert.equal(
    code(await world.chat.cancelTurn({ botId: 'bot_1' })),
    'runtime_not_ready',
  )
  world.host.rows = [sessionRow(S1)]
  world.chat.attachRuntime(world.host.runtime())
  await settle(world)
  const [a, b] = await Promise.all([
    world.chat.cancelTurn({ botId: 'bot_1' }),
    world.chat.cancelTurn({ botId: 'bot_1' }),
  ])
  ok(a)
  ok(b)
  assert.equal(world.host.count('cancel'), 1)
})

test('forgetSession: a retired binding drops its follow and approvals', async (t) => {
  const world = await setup(t)
  world.chat.attachRuntime(world.host.runtime())
  ok(world.chat.select('bot_1'))
  await settle(world)
  world.chat.forgetSession(S1)
  assert.deepEqual(world.broker.forgotten, [S1])
  assert.equal(world.host.openFollows(S1), 0)
  assert.equal(world.chat.view('bot_1'), undefined)
})
