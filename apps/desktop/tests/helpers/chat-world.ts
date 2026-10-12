import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import type { ModelSelection } from '../../../../packages/contracts/src/model-settings.ts'
import type {
  ConversationView,
  WorkspaceResult,
} from '../../../../packages/contracts/src/workspace.ts'
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
} from '../../../../packages/local-db/src/index.ts'
import type { AlignOutcome } from '../../src/workspace/bot-provisioner.ts'
import { requestIdFor } from '../../src/workspace/chat-admissions.ts'
import type { ChatAudit } from '../../src/workspace/chat-runtime.ts'
import { ChatService } from '../../src/workspace/chat-service.ts'
import { FakeChatHost } from './fake-chat-host.ts'

/** A ChatService over a real in-memory local-db and a fake Host. */
export const T0 = 1_760_000_000_000
export const HOME = 'home_test'
export const S1 = 'corn-1'
export const S2 = 'corn-2'
export const MODEL: ModelSelection = {
  provider: 'fake',
  model: 'corn-gate-model',
}
export const SECRET = 'top secret prompt body'

export interface World {
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

export async function setup(
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

export function seedBot(
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
export async function settle(world: World): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await world.chat.idle()
    await setImmediate()
  }
}

export function admission(
  world: World,
  messageId: string,
): MessageAdmissionRow {
  const requestId = requestIdFor(messageId)
  assert.ok(requestId)
  const row = world.db.read((tx) => getMessageAdmission(tx, requestId))
  assert.ok(row)
  return row
}

export function ok<T>(result: WorkspaceResult<T>): T {
  if (!result.ok) assert.fail(`expected ok, got ${result.error.code}`)
  return result.value
}

export function code<T>(result: WorkspaceResult<T>): string {
  assert.equal(result.ok, false)
  return result.ok ? '' : result.error.code
}

export const lastView = (world: World): ConversationView => {
  const view = world.views.at(-1)
  assert.ok(view)
  return view
}

export function userBubbles(view: ConversationView) {
  return view.items.filter(
    (item) => item.kind === 'message' && item.author === 'user',
  )
}

/** Logs, audits and views of Main never carry prompt text or DSH request ids. */
export function assertNoLeaks(world: World): void {
  const persisted = JSON.stringify([world.logs, world.audits])
  assert.ok(!persisted.includes(SECRET))
  assert.ok(!persisted.includes('req_'))
  assert.ok(!persisted.includes('rpcId'))
  const pushed = JSON.stringify(world.views)
  assert.ok(!pushed.includes('req_'), 'request ids never reach the Renderer')
}

export function seedAdmission(
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
