import assert from 'node:assert/strict'
import { type TestContext, test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import type { ModelSelection } from '../../../packages/contracts/src/model-settings.ts'
import type {
  ConversationView,
  WorkspaceResult,
} from '../../../packages/contracts/src/workspace.ts'
import {
  type AdmissionState,
  getMessageAdmission,
  insertBot,
  insertMainConversation,
  insertMessageAdmission,
  insertSessionBinding,
  type LocalDb,
  MEMORY_LOCATION,
  type MessageAdmissionRow,
  openLocalDb,
  setBotProvisioning,
  setSessionBindingStage,
  transitionMessageAdmission,
} from '../../../packages/local-db/src/index.ts'
import type { AlignOutcome } from '../src/workspace/bot-provisioner.ts'
import { ProvisionerError } from '../src/workspace/bot-provisioner.ts'
import { messageIdFor, requestIdFor } from '../src/workspace/chat-admissions.ts'
import type { ChatAudit } from '../src/workspace/chat-runtime.ts'
import { ChatService } from '../src/workspace/chat-service.ts'
import { FakeChatHost, job, sessionRow } from './helpers/fake-chat-host.ts'

const T0 = 1_760_000_000_000
const HOME = 'home_test'
const S1 = 'corn-1'
const S2 = 'corn-2'
const MODEL: ModelSelection = { provider: 'fake', model: 'corn-gate-model' }
const SECRET = 'top secret prompt body'

interface World {
  readonly db: LocalDb
  readonly host: FakeChatHost
  readonly clock: { value: number }
  readonly chat: ChatService
  readonly views: ConversationView[]
  readonly audits: ChatAudit[]
  readonly logs: string[]
  /** Interleaved order of alignment, prompts and approval calls. */
  readonly order: string[]
  readonly aligned: (ModelSelection | null)[]
  readonly broker: {
    observed: number[][]
    stopped: string[]
    resumed: string[]
    forgotten: string[]
  }
  readonly scheduled: (() => void)[]
  dataReady: boolean
  failWrites: boolean
  alignWith: AlignOutcome | Error
}

async function setup(
  t: TestContext,
  options: {
    readonly timing?: ConstructorParameters<typeof ChatService>[0]['timing']
  } = {},
): Promise<World> {
  const opened = await openLocalDb({ path: MEMORY_LOCATION })
  if (opened.status !== 'ready') assert.fail(JSON.stringify(opened))
  const db = opened.db
  t.after(() => db.close())
  const clock = { value: T0 }
  seedBot(db, 1)
  seedBot(db, 2)
  const host = new FakeChatHost(clock, [S1, S2])
  const writable = {
    read: db.read.bind(db),
    write: (fn: Parameters<LocalDb['write']>[0]) => {
      if (world.failWrites) throw new Error('disk full')
      return db.write(fn)
    },
  } as unknown as LocalDb
  const world: World = {
    db,
    host,
    clock,
    views: [],
    audits: [],
    logs: [],
    order: [],
    aligned: [],
    broker: { observed: [], stopped: [], resumed: [], forgotten: [] },
    scheduled: [],
    dataReady: true,
    failWrites: false,
    alignWith: { status: 'aligned', selection: MODEL, changed: false },
    chat: undefined as unknown as ChatService,
  }
  ;(world as { chat: ChatService }).chat = new ChatService({
    data: {
      available: () =>
        world.dataReady
          ? { ok: true, value: writable }
          : { ok: false, error: { code: 'data_unavailable' } },
      isBindingUsable: (binding) => binding.homeId === HOME,
    },
    provisioner: {
      alignModel: async (_botId, observed) => {
        world.order.push('align')
        world.aligned.push(observed)
        if (world.alignWith instanceof Error) throw world.alignWith
        return world.alignWith
      },
    },
    approvals: {
      observe: (_sessionId, events) => {
        world.broker.observed.push(events.map((event) => event.seq))
      },
      stopTurn: (sessionId) => {
        world.order.push('stopTurn')
        world.broker.stopped.push(sessionId)
      },
      resumeSession: (sessionId) => {
        world.order.push('resume')
        world.broker.resumed.push(sessionId)
      },
      forgetSession: (sessionId) => {
        world.broker.forgotten.push(sessionId)
      },
      cards: () => [],
    },
    onView: (view) => world.views.push(view),
    onAudit: (audit) => world.audits.push(audit),
    log: (line) => world.logs.push(line),
    now: () => {
      clock.value += 10
      return clock.value
    },
    newId: (() => {
      let n = 0
      return () => `uuid-${++n}`
    })(),
    sleep: async () => {},
    schedule: (fn) => {
      world.scheduled.push(fn)
      return () => {
        const index = world.scheduled.indexOf(fn)
        if (index >= 0) world.scheduled.splice(index, 1)
      }
    },
    clientTimeZone: 'UTC',
    timing: { stop: { passDelayMs: 0 }, ...options.timing },
  })
  return world
}

function seedBot(
  db: LocalDb,
  n: number,
  options: {
    homeId?: string
    stage?: 'ready' | 'needs_model' | 'planned'
  } = {},
): void {
  db.write((tx) => {
    insertBot(tx, {
      botId: `bot_${n}`,
      displayName: `Bot ${n}`,
      avatarVariant: null,
      sortKey: String(n),
      modelOverride: null,
      now: T0,
    })
    insertMainConversation(tx, {
      conversationId: `conv_${n}`,
      botId: `bot_${n}`,
      now: T0,
    })
    insertSessionBinding(tx, {
      bindingId: `bind_${n}`,
      conversationId: `conv_${n}`,
      dshSessionId: `corn-${n}`,
      homeId: options.homeId ?? HOME,
      now: T0,
    })
    const stage = options.stage ?? 'ready'
    if (stage !== 'planned') {
      setSessionBindingStage(tx, `bind_${n}`, stage, {
        now: T0,
        lastError: null,
      })
      setBotProvisioning(tx, `bot_${n}`, 'ready', { now: T0 })
    }
  })
}

/** Lets queued microtasks, follow snapshots and background sends finish. */
async function settle(world: World): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await world.chat.idle()
    await setImmediate()
  }
}

function admission(world: World, messageId: string): MessageAdmissionRow {
  const requestId = requestIdFor(messageId)
  assert.ok(requestId)
  const row = world.db.read((tx) => getMessageAdmission(tx, requestId))
  assert.ok(row)
  return row
}

function ok<T>(result: WorkspaceResult<T>): T {
  if (!result.ok) assert.fail(`expected ok, got ${result.error.code}`)
  return result.value
}

function code<T>(result: WorkspaceResult<T>): string {
  assert.equal(result.ok, false)
  return result.ok ? '' : result.error.code
}

const lastView = (world: World): ConversationView => {
  const view = world.views.at(-1)
  assert.ok(view)
  return view
}

function userBubbles(view: ConversationView) {
  return view.items.filter(
    (item) => item.kind === 'message' && item.author === 'user',
  )
}

/** Logs, audits and views of Main never carry prompt text or DSH request ids. */
function assertNoLeaks(world: World): void {
  const persisted = JSON.stringify([world.logs, world.audits])
  assert.ok(!persisted.includes(SECRET))
  assert.ok(!persisted.includes('req_'))
  assert.ok(!persisted.includes('rpcId'))
  const pushed = JSON.stringify(world.views)
  assert.ok(!pushed.includes('req_'), 'request ids never reach the Renderer')
}

function seedAdmission(
  world: World,
  requestId: string,
  path: readonly AdmissionState[],
): void {
  world.db.write((tx) => {
    insertMessageAdmission(tx, {
      requestId,
      conversationId: 'conv_1',
      bindingId: 'bind_1',
      clientId: `client-${requestId}`,
      bodyText: SECRET,
      now: world.clock.value,
    })
    for (const state of path)
      transitionMessageAdmission(tx, requestId, state, {
        now: world.clock.value,
        ...(state === 'sending' ? { countAttempt: true } : {}),
      })
  })
}

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
