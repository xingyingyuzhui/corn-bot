import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import type { ModelSelection } from '../../../packages/contracts/src/model-settings.ts'
import { getMessageAdmission } from '../../../packages/local-db/src/index.ts'
import { ProvisionerError } from '../src/workspace/bot-provisioner.ts'
import { messageIdFor, requestIdFor } from '../src/workspace/chat-admissions.ts'
import {
  admission,
  assertNoLeaks,
  code,
  lastView,
  MODEL,
  ok,
  S1,
  S2,
  SECRET,
  seedAdmission,
  seedBot,
  settle,
  setup,
  userBubbles,
} from './helpers/chat-world.ts'

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

test('send: align first, one prompt with the persisted request id, observed clears the body', async (t) => {
  const world = await setup(t)
  world.host.selections.set(S1, MODEL)
  world.chat.attachRuntime(world.host.runtime())
  ok(world.chat.select('bot_1'))
  await settle(world)
  const messageId = ok(
    await world.chat.sendMessage({
      botId: 'bot_1',
      clientId: 'c-1',
      text: SECRET,
    }),
  )
  const requestId = requestIdFor(messageId)
  assert.ok(requestId)
  assert.match(requestId, /^req_/)
  assert.equal(messageIdFor(requestId), messageId)
  assert.equal(messageIdFor('rpc-from-elsewhere'), undefined)
  await settle(world)

  assert.deepEqual(world.host.prompts, [{ requestId, text: SECRET }])
  assert.deepEqual(world.aligned, [MODEL])
  assert.deepEqual(
    world.order.filter((step) => step === 'align' || step === 'resume'),
    ['resume', 'align'],
  )
  const alignAt = world.host.calls.findIndex((call) => call.op === 'prompt')
  assert.ok(alignAt > 0)
  const row = admission(world, messageId)
  assert.equal(row.state, 'observed')
  assert.equal(row.bodyText, null)
  assert.equal(row.attempts, 1)
  assert.equal(row.observedSeq, 0)

  const view = lastView(world)
  assert.equal(view.state, 'ready')
  const bubbles = userBubbles(view)
  assert.equal(bubbles.length, 1)
  assert.equal(bubbles[0]?.id, messageId)
  assert.deepEqual(world.broker.observed.flat(), [0])
  assertNoLeaks(world)
})

test('send: a repeated clientId returns the same message and never prompts twice', async (t) => {
  const world = await setup(t)
  world.chat.attachRuntime(world.host.runtime())
  await settle(world)
  const command = { botId: 'bot_1', clientId: 'c-dup', text: SECRET }
  const [a, b] = await Promise.all([
    world.chat.sendMessage(command),
    world.chat.sendMessage(command),
  ])
  await settle(world)
  const c = await world.chat.sendMessage(command)
  assert.equal(ok(a), ok(b))
  assert.equal(ok(c), ok(a))
  assert.equal(world.host.count('prompt'), 1)
  assert.equal(world.host.admitted.length, 1)
  assert.equal(
    code(await world.chat.sendMessage({ ...command, text: 'different text' })),
    'conflict',
  )
  assert.equal(world.host.count('prompt'), 1)
})

test('send: a lost reply is reconciled from the journal, not resent', async (t) => {
  const world = await setup(t)
  world.chat.attachRuntime(world.host.runtime())
  await settle(world)
  world.host.faults.push('lost')
  const messageId = ok(
    await world.chat.sendMessage({
      botId: 'bot_1',
      clientId: 'c',
      text: SECRET,
    }),
  )
  await settle(world)
  assert.equal(world.host.count('prompt'), 1)
  assert.equal(world.host.admitted.length, 1)
  const row = admission(world, messageId)
  assert.equal(row.state, 'observed')
  assert.equal(row.bodyText, null)
  assert.ok(world.host.count('page') >= 1)
})

test('send: a lost reply on a busy Session is found in the inbox and stays accepted', async (t) => {
  const world = await setup(t)
  world.chat.attachRuntime(world.host.runtime())
  await settle(world)
  world.host.busy = true
  world.host.faults.push('lost')
  const messageId = ok(
    await world.chat.sendMessage({
      botId: 'bot_1',
      clientId: 'c',
      text: SECRET,
    }),
  )
  await settle(world)
  assert.equal(world.host.count('prompt'), 1)
  assert.equal(admission(world, messageId).state, 'accepted')
  assert.equal(world.host.count('page'), 0)
})

test('send: a dropped request is retried with the same request id once DSH shows no trace', async (t) => {
  const world = await setup(t)
  world.chat.attachRuntime(world.host.runtime())
  await settle(world)
  world.host.faults.push('dropped')
  const messageId = ok(
    await world.chat.sendMessage({
      botId: 'bot_1',
      clientId: 'c',
      text: SECRET,
    }),
  )
  await settle(world)
  const requestId = requestIdFor(messageId)
  assert.deepEqual(
    world.host.prompts.map((prompt) => prompt.requestId),
    [requestId, requestId],
  )
  assert.deepEqual(world.host.admitted, [requestId])
  const row = admission(world, messageId)
  assert.equal(row.state, 'accepted')
  assert.equal(row.attempts, 2)
})

test('send: unknown after every retry stays unconfirmed; resend reconciles first and reuses the id', async (t) => {
  const world = await setup(t)
  world.chat.attachRuntime(world.host.runtime())
  ok(world.chat.select('bot_1'))
  await settle(world)
  world.host.faults.push('dropped', 'dropped', 'dropped', 'dropped')
  const messageId = ok(
    await world.chat.sendMessage({
      botId: 'bot_1',
      clientId: 'c',
      text: SECRET,
    }),
  )
  await settle(world)
  assert.equal(world.host.count('prompt'), 4)
  const row = admission(world, messageId)
  assert.equal(row.state, 'unknown')
  assert.equal(row.bodyText, SECRET)
  const bubble = userBubbles(lastView(world)).find(
    (item) => item.id === messageId,
  )
  assert.equal(bubble?.kind === 'message' && bubble.delivery, 'failed')

  ok(await world.chat.resend({ botId: 'bot_1', messageId }))
  await settle(world)
  assert.equal(world.host.count('prompt'), 5)
  assert.equal(new Set(world.host.prompts.map((p) => p.requestId)).size, 1)
  assert.equal(world.host.admitted.length, 1)
  assert.equal(admission(world, messageId).state, 'observed')
  assertNoLeaks(world)
})

test('send: a closed DSH refusal is rejected; resend puts the same request back on the wire', async (t) => {
  const world = await setup(t)
  world.chat.attachRuntime(world.host.runtime())
  ok(world.chat.select('bot_1'))
  await settle(world)
  world.host.faults.push({ reject: 'session/agent-busy' })
  const messageId = ok(
    await world.chat.sendMessage({
      botId: 'bot_1',
      clientId: 'c',
      text: SECRET,
    }),
  )
  await settle(world)
  let row = admission(world, messageId)
  assert.equal(row.state, 'rejected')
  assert.equal(row.lastError, 'session_busy')
  assert.equal(row.bodyText, SECRET)
  assert.equal(world.host.count('prompt'), 1, 'a refusal is not auto-retried')
  const bubble = userBubbles(lastView(world)).find(
    (item) => item.id === messageId,
  )
  assert.ok(bubble?.kind === 'message' && bubble.failure)

  ok(await world.chat.resend({ botId: 'bot_1', messageId }))
  await settle(world)
  row = admission(world, messageId)
  assert.equal(row.state, 'observed')
  assert.equal(row.attempts, 2)
  assert.equal(new Set(world.host.prompts.map((p) => p.requestId)).size, 1)
  ok(await world.chat.resend({ botId: 'bot_1', messageId }))
  await settle(world)
  assert.equal(
    world.host.count('prompt'),
    2,
    'a delivered message is not resent',
  )
})

test('send: model alignment runs before every prompt; needs_model refuses without a prompt', async (t) => {
  const world = await setup(t)
  const other: ModelSelection = { provider: 'fake', model: 'other' }
  world.host.selections.set(S1, other)
  world.chat.attachRuntime(world.host.runtime())
  await settle(world)
  ok(
    await world.chat.sendMessage({
      botId: 'bot_1',
      clientId: 'a',
      text: 'one',
    }),
  )
  ok(
    await world.chat.sendMessage({
      botId: 'bot_1',
      clientId: 'b',
      text: 'two',
    }),
  )
  await settle(world)
  assert.deepEqual(world.aligned, [other, other])
  const steps = world.order.filter((step) => step === 'align')
  assert.equal(steps.length, 2)
  // Each prompt follows its own projections read and alignment in the lane.
  const ops = world.host.calls
    .filter((call) => call.op === 'projections' || call.op === 'prompt')
    .map((call) => call.op)
  assert.deepEqual(ops, ['projections', 'prompt', 'projections', 'prompt'])
  assert.deepEqual(
    world.host.prompts.map((prompt) => prompt.text),
    ['one', 'two'],
  )

  world.alignWith = { status: 'needs_model', error: 'model_unavailable' }
  const refused = ok(
    await world.chat.sendMessage({
      botId: 'bot_1',
      clientId: 'c',
      text: SECRET,
    }),
  )
  await settle(world)
  const row = admission(world, refused)
  assert.equal(row.state, 'rejected')
  assert.equal(row.lastError, 'model_unavailable')
  assert.equal(world.host.count('prompt'), 2)

  world.alignWith = new ProvisionerError('binding_broken', 'not provisioned')
  const broken = ok(
    await world.chat.sendMessage({
      botId: 'bot_1',
      clientId: 'd',
      text: SECRET,
    }),
  )
  await settle(world)
  assert.equal(admission(world, broken).lastError, 'binding_broken')
  assert.equal(world.host.count('prompt'), 2)
})

test('send: closed codes for data, runtime and binding state; nothing is written or sent', async (t) => {
  const world = await setup(t)
  const send = (botId: string, clientId: string) =>
    world.chat.sendMessage({ botId, clientId, text: SECRET })

  assert.equal(code(await send('bot_1', 'x')), 'runtime_not_ready')
  world.chat.attachRuntime(world.host.runtime())
  await settle(world)
  assert.equal(code(await send('bot_missing', 'x')), 'not_found')
  seedBot(world.db, 3, { homeId: 'home_other' })
  assert.equal(code(await send('bot_3', 'x')), 'binding_broken')
  seedBot(world.db, 4, { stage: 'planned' })
  assert.equal(code(await send('bot_4', 'x')), 'unavailable')
  world.dataReady = false
  assert.equal(code(await send('bot_1', 'x')), 'data_unavailable')
  assert.equal(
    code(await world.chat.cancelTurn({ botId: 'bot_1' })),
    'data_unavailable',
  )
  assert.equal(code(world.chat.select('bot_1')), 'data_unavailable')
  world.dataReady = true
  await settle(world)
  assert.equal(world.host.count('prompt'), 0)
  assert.equal(
    world.db.read((tx) =>
      tx.get('SELECT COUNT(*) AS n FROM message_admissions'),
    )?.n,
    0,
  )
})

test('send: a failed admission write never reaches DSH', async (t) => {
  const world = await setup(t)
  world.chat.attachRuntime(world.host.runtime())
  await settle(world)
  world.failWrites = true
  assert.equal(
    code(
      await world.chat.sendMessage({
        botId: 'bot_1',
        clientId: 'c',
        text: SECRET,
      }),
    ),
    'data_unavailable',
  )
  world.failWrites = false
  // The insert succeeds but the `sending` checkpoint fails: still no RPC.
  const messageId = ok(
    await world.chat.sendMessage({
      botId: 'bot_1',
      clientId: 'd',
      text: SECRET,
    }),
  )
  world.failWrites = true
  await settle(world)
  world.failWrites = false
  assert.equal(world.host.count('prompt'), 0)
  assert.equal(admission(world, messageId).state, 'pending')
  assertNoLeaks(world)
})

// ---------------------------------------------------------------------------
// Host generations and the follow
// ---------------------------------------------------------------------------

test('follow: a dropped stream rebaselines and reopens with backoff from a fresh snapshot', async (t) => {
  const world = await setup(t)
  world.chat.attachRuntime(world.host.runtime())
  ok(world.chat.select('bot_1'))
  await settle(world)
  ok(
    await world.chat.sendMessage({
      botId: 'bot_1',
      clientId: 'a',
      text: 'one',
    }),
  )
  await settle(world)
  assert.equal(lastView(world).state, 'ready')
  world.host.dropFollows()
  assert.equal(lastView(world).state, 'reconnecting')
  assert.equal(world.scheduled.length, 1)
  world.host.append(S1, 'turn/start', { turn: 1 })
  world.scheduled.shift()?.()
  await settle(world)
  assert.equal(lastView(world).state, 'ready')
  assert.equal(world.host.openFollows(S1), 1)
  assert.equal(userBubbles(lastView(world)).length, 1, 'no duplicate bubble')
  // The reopened snapshot reaches the broker again (it skips overlaps).
  assert.deepEqual(world.broker.observed.at(-1), [0, 1])
})

test('follow: a Host restart mid-send marks it unknown and reconciles before the follow reopens', async (t) => {
  const world = await setup(t)
  world.chat.attachRuntime(world.host.runtime())
  ok(world.chat.select('bot_1'))
  await settle(world)
  world.host.busy = true
  let release = () => {}
  world.host.hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const messageId = ok(
    await world.chat.sendMessage({
      botId: 'bot_1',
      clientId: 'a',
      text: SECRET,
    }),
  )
  await setImmediate()
  assert.equal(admission(world, messageId).state, 'sending')
  world.chat.detachRuntime()
  assert.equal(admission(world, messageId).state, 'unknown')
  assert.equal(lastView(world).state, 'reconnecting')
  world.host.hold = undefined
  release()
  await settle(world)
  assert.equal(admission(world, messageId).state, 'unknown')

  const callsBefore = world.host.calls.length
  world.chat.attachRuntime(world.host.runtime())
  await settle(world)
  const after = world.host.calls.slice(callsBefore).map((call) => call.op)
  assert.ok(after.indexOf('projections') < after.indexOf('follow'))
  assert.equal(admission(world, messageId).state, 'accepted')
  assert.equal(world.host.count('prompt'), 1)
  assert.equal(world.host.admitted.length, 1)
  assert.equal(lastView(world).state, 'ready')
  world.host.claim(S1)
  await settle(world)
  assert.equal(admission(world, messageId).state, 'observed')
})

test('recovery: open admissions are reconciled read-only; nothing is resent', async (t) => {
  const world = await setup(t)
  seedAdmission(world, 'req_pending', [])
  seedAdmission(world, 'req_sent', ['sending'])
  seedAdmission(world, 'req_lost', ['sending', 'unknown'])
  world.host.userMessage(S1, {
    id: 'item-x',
    rpcId: 'req_sent',
    text: 'already there',
  })
  world.chat.attachRuntime(world.host.runtime())
  ok(world.chat.select('bot_1'))
  await settle(world)
  const state = (requestId: string) =>
    world.db.read((tx) => getMessageAdmission(tx, requestId))
  assert.equal(state('req_pending')?.state, 'rejected')
  assert.equal(state('req_pending')?.lastError, 'not_sent')
  assert.equal(state('req_sent')?.state, 'observed')
  assert.equal(state('req_sent')?.bodyText, null)
  assert.equal(state('req_lost')?.state, 'unknown')
  assert.equal(world.host.count('prompt'), 0)
  const failed = userBubbles(lastView(world)).filter(
    (item) => item.kind === 'message' && item.delivery === 'failed',
  )
  assert.equal(failed.length, 2)
})

test('select: only the selected conversation is followed', async (t) => {
  const world = await setup(t)
  world.chat.attachRuntime(world.host.runtime())
  ok(world.chat.select('bot_1'))
  await settle(world)
  assert.equal(world.host.openFollows(S1), 1)
  ok(world.chat.select('bot_2'))
  await settle(world)
  assert.equal(world.host.openFollows(S1), 0)
  assert.equal(world.host.openFollows(S2), 1)
  assert.equal(world.chat.view('bot_1'), undefined)
  assert.equal(world.chat.view('bot_2')?.state, 'ready')
  ok(world.chat.select(null))
  assert.equal(world.host.openFollows(), 0)
  assert.equal(world.chat.botForSession(S1), 'bot_1')
  assert.equal(world.chat.botForSession('corn-unknown'), undefined)
})
