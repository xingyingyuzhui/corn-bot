import assert from 'node:assert/strict'
import { type TestContext, test } from 'node:test'
import type { ModelSelection } from '../../../packages/contracts/src/model-settings.ts'
import {
  getBot,
  getClawAgent,
  getLiveSessionBinding,
  getMainConversation,
  type LocalDb,
  listClawAgents,
  MEMORY_LOCATION,
  type ModelChoice,
  openLocalDb,
  type SessionBindingRow,
  setSessionBindingStage,
} from '../../../packages/local-db/src/index.ts'
import {
  type BotDraft,
  BotProvisioner,
  HOST_CLOCK_SKEW_MS,
  type ProvisionErrorCode,
  ProvisionerError,
  type ProvisionOutcome,
} from '../src/workspace/bot-provisioner.ts'
import {
  CLAW_TITLE_MAX,
  sanitizeAgentTitle,
} from '../src/workspace/claw-adoption.ts'
import {
  CATALOG_PROVIDER,
  type FakeOp,
  FakeProvisionHost,
  type Fault,
  MODEL_A,
  MODEL_ALT,
  MODEL_THIRD,
} from './helpers/fake-provision-host.ts'

const T0 = 1_760_000_000_000
const HOME_ID = 'home_test'
const LOST: Fault = { mode: 'lost' }
const DROPPED: Fault = { mode: 'dropped' }

/** RPC endpoints the provisioner may reach; anything else (settings/*) fails the test. */
const ALLOWED_RPC = new Set([
  'session/create',
  'session/selectModel',
  'session/modelCatalog',
])

interface World {
  readonly db: LocalDb
  readonly host: FakeProvisionHost
  readonly clock: { value: number }
  provisioner: BotProvisioner
  restart(): BotProvisioner
}

async function setup(t: TestContext): Promise<World> {
  const opened = await openLocalDb({ path: MEMORY_LOCATION })
  if (opened.status !== 'ready') assert.fail(JSON.stringify(opened))
  const db = opened.db
  t.after(() => db.close())
  const clock = { value: T0 }
  const host = new FakeProvisionHost(clock)
  let seq = 0
  const make = () =>
    new BotProvisioner({
      db,
      ...host.clients(),
      homeId: HOME_ID,
      now: () => {
        clock.value += 10
        return clock.value
      },
      newId: () => {
        seq += 1
        return `id${seq}`
      },
    })
  const world: World = {
    db,
    host,
    clock,
    provisioner: make(),
    restart() {
      world.provisioner = make()
      return world.provisioner
    },
  }
  t.after(() => assertModelIsolation(host))
  return world
}

/** §5: Session scope only, never a settings write, never an unknown endpoint. */
function assertModelIsolation(host: FakeProvisionHost): void {
  for (const call of host.calls) {
    if (call.op.startsWith('registry/')) continue
    assert.ok(ALLOWED_RPC.has(call.op), `unexpected RPC ${call.op}`)
  }
  for (const body of host.bodies('session/selectModel')) {
    assert.equal(
      (body as { request: { scope?: string } }).request.scope,
      'session',
    )
  }
}

const draft = (overrides: Partial<BotDraft> = {}): BotDraft => ({
  displayName: 'Research Bot',
  avatarVariant: null,
  ...overrides,
})

const choice = (selection: ModelSelection): ModelChoice => ({
  provider: selection.provider,
  model: selection.model,
  effort: selection.reasoningEffort ?? null,
})

function binding(world: World, botId: string): SessionBindingRow {
  return world.db.read((tx) => {
    const conversation = getMainConversation(tx, botId)
    assert.ok(conversation)
    const row = getLiveSessionBinding(tx, conversation.conversationId)
    assert.ok(row)
    return row
  })
}

function bot(world: World, botId: string) {
  const row = world.db.read((tx) => getBot(tx, botId))
  assert.ok(row)
  return row
}

function onlyBotId(world: World): string {
  const ids = world.db.read((tx) =>
    tx.all('SELECT bot_id FROM bots').map((row) => String(row.bot_id)),
  )
  assert.equal(ids.length, 1)
  return ids[0] as string
}

function expectRepair(
  outcome: ProvisionOutcome,
  error: ProvisionErrorCode,
): void {
  assert.equal(outcome.status, 'needs_repair', JSON.stringify(outcome))
  assert.equal((outcome as { error: string }).error, error)
}

/** One Claw agent, one DSH Session (the pre-minted id), one Claw binding, all ready. */
function assertProvisioned(world: World, botId: string): void {
  const row = binding(world, botId)
  assert.equal(row.stage, 'ready')
  assert.equal(row.lastError, null)
  assert.equal(bot(world, botId).provisioning, 'ready')
  assert.match(row.dshSessionId, /^corn-/u)
  assert.deepEqual([...world.host.sessions.keys()], [row.dshSessionId])
  const created = new Set(
    world.host
      .bodies('session/create')
      .map(
        (body) =>
          (body as { request: { sessionId: string } }).request.sessionId,
      ),
  )
  assert.deepEqual([...created], [row.dshSessionId])
  assert.equal(world.host.agents.size, 1)
  const agent = world.db.read((tx) => getClawAgent(tx, botId))
  assert.ok(agent)
  assert.equal(
    world.host.bindings.get(row.dshSessionId)?.agentId,
    agent.agentId,
  )
  assert.equal(world.host.bindings.get(row.dshSessionId)?.state, 'ready')
}

test('happy path: every step runs once, in order, and ends ready', async (t) => {
  const world = await setup(t)
  const outcome = await world.provisioner.create(
    draft({ policyPreset: 'developer' }),
  )
  assert.equal(outcome.status, 'ready')
  const botId = outcome.botId
  assertProvisioned(world, botId)
  assert.deepEqual(
    world.host.calls
      .map((call) => call.op)
      .filter((op) => op !== 'registry/list'),
    [
      'registry/create',
      'registry/preset/ensure',
      'registry/policy',
      'session/create',
      'registry/session/bind',
      'session/modelCatalog',
      'registry/session/state',
    ],
  )
  assert.deepEqual(world.host.bodies('registry/policy'), [
    { agentId: 'wa_1', policy: { preset: 'developer' } },
  ])
  const agent = world.db.read((tx) => getClawAgent(tx, botId))
  assert.equal(agent?.policyPreset, 'developer')
  const session = world.host.sessions.get(binding(world, botId).dshSessionId)
  assert.deepEqual(session, {
    cwd: agent?.canonicalRoot,
    agentPreset: agent?.dshPreset,
  })
  // Follow-global writes nothing at creation (aligned before each send).
  assert.equal(world.host.count('session/selectModel'), 0)
  assert.equal(binding(world, botId).appliedModel, null)
  assert.equal(world.host.globalDefault, MODEL_A)
})

test('policy preset defaults to research', async (t) => {
  const world = await setup(t)
  const outcome = await world.provisioner.create(draft())
  assert.equal(outcome.status, 'ready')
  assert.deepEqual(world.host.bodies('registry/policy'), [
    { agentId: 'wa_1', policy: { preset: 'research' } },
  ])
})

test('invalid drafts are refused before anything is written', async (t) => {
  const world = await setup(t)
  for (const bad of [
    draft({ displayName: '' }),
    draft({ displayName: ' \u0000\t ' }),
    draft({ policyPreset: 'admin' as never }),
  ]) {
    await assert.rejects(world.provisioner.create(bad), (error) => {
      assert.ok(error instanceof ProvisionerError)
      assert.equal(error.code, 'validation')
      return true
    })
  }
  assert.equal(
    world.db.read((tx) => tx.all('SELECT bot_id FROM bots')).length,
    0,
  )
  assert.equal(world.host.calls.length, 0)
})

interface StepCase {
  readonly op: FakeOp
  readonly stage: SessionBindingRow['stage']
  readonly error: ProvisionErrorCode
  readonly faults: readonly Fault[]
  readonly override?: ModelSelection
}

const STEP_CASES: readonly StepCase[] = [
  {
    op: 'registry/create',
    stage: 'planned',
    error: 'claw_create_failed',
    faults: [{ mode: 'reject', code: 'REGISTRY_WORKSPACE_EXISTS' }],
  },
  {
    op: 'registry/preset/ensure',
    stage: 'agent_created',
    error: 'claw_preset_failed',
    faults: [
      DROPPED,
      LOST,
      { mode: 'reject', code: 'REGISTRY_PRESET_UNAVAILABLE' },
    ],
  },
  {
    op: 'registry/policy',
    stage: 'preset_ensured',
    error: 'claw_policy_failed',
    faults: [DROPPED, LOST],
  },
  {
    op: 'session/create',
    stage: 'preset_ensured',
    error: 'session_create_failed',
    faults: [DROPPED, LOST, { mode: 'reject', code: 'gateway/internal' }],
  },
  {
    op: 'registry/session/bind',
    stage: 'verified',
    error: 'claw_bind_failed',
    faults: [DROPPED, LOST],
  },
  {
    op: 'session/modelCatalog',
    stage: 'bound',
    error: 'model_catalog_failed',
    faults: [DROPPED],
  },
  {
    op: 'registry/session/state',
    stage: 'model_applied',
    error: 'claw_state_failed',
    faults: [DROPPED, LOST],
  },
]

for (const step of STEP_CASES) {
  for (const fault of step.faults) {
    test(`${step.op} ${fault.mode}: checkpoint ${step.stage}, repair resumes`, async (t) => {
      const world = await setup(t)
      world.host.fail(step.op, fault)
      const outcome = await world.provisioner.create(draft())
      expectRepair(outcome, step.error)
      const botId = outcome.botId
      const row = binding(world, botId)
      assert.equal(row.stage, step.stage)
      assert.equal(row.lastError, step.error)
      assert.equal(bot(world, botId).provisioning, 'needs_repair')

      // A restarted Main resumes from the durable checkpoint alone.
      const repaired = await world.restart().repair(botId)
      assert.equal(repaired.status, 'ready', JSON.stringify(repaired))
      assertProvisioned(world, botId)
      // Repairing again is a no-op.
      const calls = world.host.calls.length
      assert.equal((await world.provisioner.repair(botId)).status, 'ready')
      assert.equal(world.host.calls.length, calls)
    })
  }
}

test('selectSessionModel failure: needs_model, nothing substituted, repair applies', async (t) => {
  const world = await setup(t)
  world.host.fail('session/selectModel', DROPPED)
  const outcome = await world.provisioner.create(
    draft({ modelOverride: choice(MODEL_ALT) }),
  )
  assert.deepEqual(outcome, {
    status: 'needs_model',
    botId: outcome.botId,
    error: 'model_select_failed',
  })
  const row = binding(world, outcome.botId)
  assert.equal(row.stage, 'needs_model')
  assert.equal(row.appliedModel, null)
  assert.equal(world.host.bindings.get(row.dshSessionId)?.state, 'needs_model')
  assert.equal(world.host.count('session/selectModel'), 1)

  const repaired = await world.provisioner.repair(outcome.botId)
  assert.equal(repaired.status, 'ready')
  assertProvisioned(world, outcome.botId)
  assert.deepEqual(
    binding(world, outcome.botId).appliedModel,
    choice(MODEL_ALT),
  )
  assert.equal(world.host.globalDefault, MODEL_A)
})

test('a wrong selectSessionModel echo is needs_model, not a fallback', async (t) => {
  const world = await setup(t)
  world.host.selectEcho = MODEL_A
  const outcome = await world.provisioner.create(
    draft({ modelOverride: choice(MODEL_ALT) }),
  )
  assert.equal(outcome.status, 'needs_model')
  assert.equal(binding(world, outcome.botId).appliedModel, null)
})

test('a crash between a checkpoint and its call repeats only idempotent calls', async (t) => {
  const world = await setup(t)
  const outcome = await world.provisioner.create(draft())
  const botId = outcome.botId
  const row = binding(world, botId)
  // As if Main died right after writing `session_created` (echo lost).
  world.db.write((tx) =>
    setSessionBindingStage(tx, row.bindingId, 'session_created', {
      now: world.clock.value,
      lastError: null,
    }),
  )
  assert.equal((await world.restart().repair(botId)).status, 'ready')
  assertProvisioned(world, botId)
  assert.equal(world.host.count('registry/create'), 1)
  assert.equal(world.host.count('session/create'), 2)
  assert.equal(world.host.count('registry/session/bind'), 2)
})

test('lost create reply with exactly one candidate: adopted, never re-created', async (t) => {
  const world = await setup(t)
  world.host.fail('registry/create', LOST)
  const outcome = await world.provisioner.create(
    draft({ displayName: '  Research\t\tBot  ' }),
  )
  expectRepair(outcome, 'claw_create_unknown')
  const row = binding(world, outcome.botId)
  assert.equal(row.stage, 'planned')
  assert.equal(row.lastError, 'claw_create_unknown')
  assert.equal(world.host.agents.size, 1)

  const repaired = await world.restart().repair(outcome.botId)
  assert.equal(repaired.status, 'ready', JSON.stringify(repaired))
  assertProvisioned(world, outcome.botId)
  assert.equal(world.host.count('registry/create'), 1)
  const agent = world.db.read((tx) => getClawAgent(tx, outcome.botId))
  assert.equal(agent?.agentId, 'wa_1')
})

test('adoption tolerates a small Host clock lag but not a stale agent', async (t) => {
  for (const [offset, adopted] of [
    [-(HOST_CLOCK_SKEW_MS - 1000), true],
    [-(HOST_CLOCK_SKEW_MS + 1000), false],
  ] as const) {
    const world = await setup(t)
    world.host.hostOffsetMs = offset
    world.host.fail('registry/create', LOST)
    const outcome = await world.provisioner.create(draft())
    const repaired = await world.provisioner.repair(outcome.botId)
    if (adopted) assert.equal(repaired.status, 'ready')
    else expectRepair(repaired, 'claw_create_unknown')
  }
})

test('lost create with zero candidates stays needs_repair and does not re-create', async (t) => {
  const world = await setup(t)
  world.host.fail('registry/create', DROPPED)
  const outcome = await world.provisioner.create(draft())
  expectRepair(outcome, 'claw_create_unknown')
  const before = binding(world, outcome.botId)
  // Same-title agents that must not count: one older than the attempt, one owned by another Bot.
  world.host.addAgent('Research Bot', T0 - 60_000)
  const other = await world.provisioner.create(draft())
  assert.equal(other.status, 'ready')

  for (let i = 0; i < 2; i += 1) {
    const repaired = await world.provisioner.repair(outcome.botId)
    expectRepair(repaired, 'claw_create_unknown')
  }
  assert.equal(world.host.count('registry/create'), 2)
  const after = binding(world, outcome.botId)
  assert.equal(after.stage, 'planned')
  // The checkpoint's updated_at is the attempt time; repair never rewrites it.
  assert.equal(after.updatedAt, before.updatedAt)
  assert.equal(
    world.db.read((tx) => getClawAgent(tx, outcome.botId)),
    null,
  )
})

test('lost create with two candidates reports both orphans and adopts neither', async (t) => {
  const world = await setup(t)
  world.host.fail('registry/create', LOST)
  const outcome = await world.provisioner.create(draft())
  world.host.addAgent('Research Bot')
  const repaired = await world.provisioner.repair(outcome.botId)
  assert.deepEqual(repaired, {
    status: 'needs_repair',
    botId: outcome.botId,
    error: 'claw_create_ambiguous',
    orphanAgentIds: ['wa_1', 'wa_2'],
  })
  assert.equal(world.db.read((tx) => listClawAgents(tx)).length, 0)
  assert.equal(binding(world, outcome.botId).lastError, 'claw_create_unknown')
  assert.equal(world.host.count('registry/create'), 1)
  assert.equal(world.host.agents.size, 2)
})

test('adoption compares the Claw-sanitized title', () => {
  assert.equal(sanitizeAgentTitle('  a\u0000b \n\t c  '), 'a b c')
  const long = `${'x'.repeat(CLAW_TITLE_MAX - 1)} yz`
  assert.equal(sanitizeAgentTitle(long), 'x'.repeat(CLAW_TITLE_MAX - 1))
})

test('DSH preset conflict at session/create stops with binding_mismatch', async (t) => {
  const world = await setup(t)
  world.host.fail(
    'session/create',
    { mode: 'reject', code: 'agent-preset/conflict' },
    { mode: 'reject', code: 'agent-preset/conflict' },
  )
  const outcome = await world.provisioner.create(draft())
  expectRepair(outcome, 'binding_mismatch')
  assert.equal(binding(world, outcome.botId).stage, 'preset_ensured')
  expectRepair(
    await world.provisioner.repair(outcome.botId),
    'binding_mismatch',
  )
  assert.equal(world.host.count('registry/session/bind'), 0)
  assert.equal(world.host.sessions.size, 0)
})

test('a Session that already exists with another preset is never bound', async (t) => {
  const world = await setup(t)
  world.host.sessions.set('corn-id1', {
    cwd: '/claw/agent-1',
    agentPreset: 'wa-someone-else',
  })
  const outcome = await world.provisioner.create(draft())
  expectRepair(outcome, 'binding_mismatch')
  assert.equal(world.host.bindings.size, 0)
})

test('Claw preset or cwd mismatch at bind stops with binding_mismatch', async (t) => {
  const world = await setup(t)
  world.host.fail('registry/session/bind', {
    mode: 'reject',
    code: 'REGISTRY_PRESET_MISMATCH',
  })
  expectRepair(await world.provisioner.create(draft()), 'binding_mismatch')
})

test('bind revision conflicts: three retries succeed, a fourth conflict stops', async (t) => {
  const conflict: Fault = { mode: 'reject', code: 'REGISTRY_REVISION_CONFLICT' }
  const world = await setup(t)
  world.host.fail('registry/session/bind', conflict, conflict, conflict)
  assert.equal((await world.provisioner.create(draft())).status, 'ready')
  assert.equal(world.host.count('registry/session/bind'), 4)

  const stuck = await setup(t)
  stuck.host.fail(
    'registry/session/bind',
    conflict,
    conflict,
    conflict,
    conflict,
  )
  const outcome = await stuck.provisioner.create(draft())
  expectRepair(outcome, 'claw_revision_conflict')
  assert.equal(binding(stuck, outcome.botId).stage, 'verified')
  assert.equal((await stuck.provisioner.repair(outcome.botId)).status, 'ready')
})

test('a Session bound to another agent stops and is never rebound', async (t) => {
  const world = await setup(t)
  world.host.fail('registry/session/bind', {
    mode: 'reject',
    code: 'REGISTRY_BIND_CONFLICT',
  })
  const outcome = await world.provisioner.create(draft())
  expectRepair(outcome, 'claw_bind_conflict')
  assert.equal(binding(world, outcome.botId).stage, 'verified')
})

test('create and repair of one Bot are serialized: no duplicate agent or Session', async (t) => {
  const world = await setup(t)
  const release = world.host.hold('registry/create')
  const creating = world.provisioner.create(draft())
  const botId = onlyBotId(world)
  assert.equal(bot(world, botId).provisioning, 'creating')
  const repairing = world.provisioner.repair(botId)
  const again = world.provisioner.repair(botId)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(world.host.count('registry/create'), 1)
  release()
  const outcomes = await Promise.all([creating, repairing, again])
  assert.deepEqual(
    outcomes.map((outcome) => outcome.status),
    ['ready', 'ready', 'ready'],
  )
  assertProvisioned(world, botId)
  assert.equal(world.host.count('registry/create'), 1)
  assert.equal(world.host.count('session/create'), 1)
})

test('repair of an unknown Bot is not_found', async (t) => {
  const world = await setup(t)
  await assert.rejects(world.provisioner.repair('bot_missing'), (error) => {
    assert.ok(error instanceof ProvisionerError)
    assert.equal(error.code, 'not_found')
    return true
  })
})

test('override at creation is selected on the Session only', async (t) => {
  const world = await setup(t)
  const outcome = await world.provisioner.create(
    draft({ modelOverride: choice(MODEL_THIRD) }),
  )
  assert.equal(outcome.status, 'ready')
  const sessionId = binding(world, outcome.botId).dshSessionId
  assert.deepEqual(world.host.bodies('session/selectModel'), [
    { request: { sessionId, ...MODEL_THIRD, scope: 'session' } },
  ])
  assert.deepEqual(
    binding(world, outcome.botId).appliedModel,
    choice(MODEL_THIRD),
  )
  assert.equal(world.host.globalDefault, MODEL_A)
})

test('an override outside the catalog is needs_model with no request', async (t) => {
  const world = await setup(t)
  const outcome = await world.provisioner.create(
    draft({
      modelOverride: {
        provider: CATALOG_PROVIDER,
        model: 'gone',
        effort: null,
      },
    }),
  )
  assert.deepEqual(outcome, {
    status: 'needs_model',
    botId: outcome.botId,
    error: 'model_unavailable',
  })
  const row = binding(world, outcome.botId)
  assert.equal(row.stage, 'needs_model')
  assert.equal(world.host.bindings.get(row.dshSessionId)?.state, 'needs_model')
  assert.equal(world.host.count('session/selectModel'), 0)

  const fixed = await world.provisioner.setModel(
    outcome.botId,
    choice(MODEL_ALT),
  )
  assert.deepEqual(fixed, {
    status: 'aligned',
    selection: MODEL_ALT,
    changed: true,
  })
  assertProvisioned(world, outcome.botId)
  assert.deepEqual(bot(world, outcome.botId).modelOverride, choice(MODEL_ALT))
})

test('follow-global with no global default is needs_model', async (t) => {
  const world = await setup(t)
  world.host.globalDefault = null
  const outcome = await world.provisioner.create(draft())
  assert.equal(outcome.status, 'needs_model')
  world.host.globalDefault = MODEL_A
  assert.equal((await world.provisioner.repair(outcome.botId)).status, 'ready')
})

test('setModel set and clear: Session scope only, global default untouched', async (t) => {
  const world = await setup(t)
  const { botId } = await world.provisioner.create(draft())
  const sessionId = binding(world, botId).dshSessionId

  assert.deepEqual(await world.provisioner.setModel(botId, choice(MODEL_ALT)), {
    status: 'aligned',
    selection: MODEL_ALT,
    changed: true,
  })
  assert.deepEqual(bot(world, botId).modelOverride, choice(MODEL_ALT))
  assert.deepEqual(binding(world, botId).appliedModel, choice(MODEL_ALT))

  assert.deepEqual(await world.provisioner.setModel(botId, null), {
    status: 'aligned',
    selection: MODEL_A,
    changed: true,
  })
  assert.equal(bot(world, botId).modelOverride, null)
  assert.deepEqual(binding(world, botId).appliedModel, choice(MODEL_A))
  assert.deepEqual(
    world.host
      .bodies('session/selectModel')
      .map(
        (body) =>
          (body as { request: { sessionId: string; model: string } }).request,
      ),
    [
      { sessionId, ...MODEL_ALT, scope: 'session' },
      { sessionId, ...MODEL_A, scope: 'session' },
    ],
  )
  assert.equal(world.host.globalDefault, MODEL_A)
})

test('setModel to a model outside the catalog: needs_model, intent kept, no request', async (t) => {
  const world = await setup(t)
  const { botId } = await world.provisioner.create(draft())
  const gone = { provider: CATALOG_PROVIDER, model: 'gone', effort: null }
  assert.deepEqual(await world.provisioner.setModel(botId, gone), {
    status: 'needs_model',
    error: 'model_unavailable',
  })
  assert.deepEqual(bot(world, botId).modelOverride, gone)
  assert.equal(binding(world, botId).stage, 'needs_model')
  assert.equal(world.host.count('session/selectModel'), 0)
  const outcome = await world.provisioner.alignModel(botId, null)
  assert.equal(outcome.status, 'needs_model')
  assert.equal(world.host.count('session/selectModel'), 0)
})

test('setModel while provisioning only records the intent for the model step', async (t) => {
  const world = await setup(t)
  world.host.fail('registry/session/bind', DROPPED)
  const { botId } = await world.provisioner.create(draft())
  assert.deepEqual(await world.provisioner.setModel(botId, choice(MODEL_ALT)), {
    status: 'pending',
  })
  assert.equal(world.host.count('session/selectModel'), 0)
  assert.equal((await world.provisioner.repair(botId)).status, 'ready')
  assert.deepEqual(binding(world, botId).appliedModel, choice(MODEL_ALT))
})

test('follow-global alignment before each send tracks the current global default', async (t) => {
  const world = await setup(t)
  const { botId } = await world.provisioner.create(draft())
  const pinned = await world.provisioner.create(
    draft({ displayName: 'Pinned', modelOverride: choice(MODEL_THIRD) }),
  )

  assert.deepEqual(await world.provisioner.alignModel(botId, null), {
    status: 'aligned',
    selection: MODEL_A,
    changed: true,
  })
  assert.deepEqual(await world.provisioner.alignModel(botId, MODEL_A), {
    status: 'aligned',
    selection: MODEL_A,
    changed: false,
  })
  const selects = world.host.count('session/selectModel')

  // The global default changes through the official settings path (not Corn).
  world.host.globalDefault = MODEL_ALT
  assert.deepEqual(await world.provisioner.alignModel(botId, MODEL_A), {
    status: 'aligned',
    selection: MODEL_ALT,
    changed: true,
  })
  assert.deepEqual(binding(world, botId).appliedModel, choice(MODEL_ALT))
  // An override Bot ignores the global change.
  assert.deepEqual(
    await world.provisioner.alignModel(pinned.botId, MODEL_THIRD),
    { status: 'aligned', selection: MODEL_THIRD, changed: false },
  )
  assert.equal(world.host.count('session/selectModel'), selects + 1)
})

test('alignment refuses a Bot that is not provisioned', async (t) => {
  const world = await setup(t)
  world.host.fail('registry/session/bind', DROPPED)
  const { botId } = await world.provisioner.create(draft())
  await assert.rejects(world.provisioner.alignModel(botId, null), (error) => {
    assert.ok(error instanceof ProvisionerError)
    assert.equal(error.code, 'binding_broken')
    return true
  })
})

test('alignment recovers a needs_model Bot once the model is runnable', async (t) => {
  const world = await setup(t)
  world.host.globalDefault = null
  const { botId } = await world.provisioner.create(draft())
  assert.equal(binding(world, botId).stage, 'needs_model')
  world.host.globalDefault = MODEL_ALT
  assert.deepEqual(await world.provisioner.alignModel(botId, null), {
    status: 'aligned',
    selection: MODEL_ALT,
    changed: true,
  })
  assertProvisioned(world, botId)
})
