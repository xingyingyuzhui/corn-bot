import { randomUUID } from 'node:crypto'
import type { ModelSelection } from '../../../../packages/contracts/src/model-settings.ts'
import type { WorkspaceErrorCode } from '../../../../packages/contracts/src/workspace.ts'
import type {
  ClawAgent,
  ClawRegistryClient,
} from '../../../../packages/dsh-adapter/src/claw-registry-client.ts'
import type {
  ModelCatalog,
  ModelCatalogClient,
} from '../../../../packages/dsh-adapter/src/model-catalog-client.ts'
import {
  ECHO_MISMATCH,
  RemoteError,
} from '../../../../packages/dsh-adapter/src/remote-error.ts'
import type { SessionClient } from '../../../../packages/dsh-adapter/src/session-client.ts'
import {
  type BindingStage,
  type BotRow,
  type ClawAgentRow,
  getBot,
  getClawAgent,
  getLiveSessionBinding,
  getMainConversation,
  insertBot,
  insertClawAgent,
  insertMainConversation,
  insertSessionBinding,
  isLocalDbError,
  type LocalDb,
  listClawAgents,
  type ModelChoice,
  markClawCreateAttempt,
  POLICY_PRESETS,
  type PolicyPreset,
  type SessionBindingRow,
  setBotModelOverride,
  setBotProvisioning,
  setSessionBindingAppliedModel,
  setSessionBindingStage,
} from '../../../../packages/local-db/src/index.ts'
import {
  sameSelection,
  selectionInCatalog,
} from '../model-settings/projection.ts'
import { findAdoptionCandidate, sanitizeAgentTitle } from './claw-adoption.ts'

/**
 * Closed codes a provisioning step leaves in `session_bindings.last_error`.
 * Host and Claw text never reaches the database.
 */
export const PROVISION_ERRORS = [
  /** `registry/create` was refused; nothing was created, a retry is safe. */
  'claw_create_failed',
  /** The create reply was lost; repair may adopt (16A) but never re-creates. */
  'claw_create_unknown',
  /** Outcome only: more than one adoption candidate (orphans reported). */
  'claw_create_ambiguous',
  'claw_preset_failed',
  'claw_policy_failed',
  'session_create_failed',
  /**
   * Stop: DSH or Claw found the Session's preset or cwd differs from the
   * agent's, or the Host echoed another identity (`corn/echo-mismatch`).
   */
  'binding_mismatch',
  /** Stop: the Session is already bound to another Claw agent; Corn never rebinds. */
  'claw_bind_conflict',
  'claw_bind_failed',
  /** `expectedRevision` kept moving after every allowed retry. */
  'claw_revision_conflict',
  'model_catalog_failed',
  /** No usable model: the override or global default is not in the catalog. */
  'model_unavailable',
  /** `selectSessionModel` failed or echoed something else; nothing was substituted. */
  'model_select_failed',
  'claw_state_failed',
] as const
export type ProvisionErrorCode = (typeof PROVISION_ERRORS)[number]
export type ModelErrorCode = Extract<
  ProvisionErrorCode,
  'model_unavailable' | 'model_select_failed'
>

export type ProvisionOutcome =
  | { readonly status: 'ready'; readonly botId: string }
  | {
      readonly status: 'needs_model'
      readonly botId: string
      readonly error: ModelErrorCode
    }
  | {
      readonly status: 'needs_repair'
      readonly botId: string
      readonly error: ProvisionErrorCode
      /** Claw agents left unadopted by an ambiguous lost create; never deleted. */
      readonly orphanAgentIds?: readonly string[]
    }

export type AlignOutcome =
  | {
      readonly status: 'aligned'
      readonly selection: ModelSelection
      /** `true` when `selectSessionModel` ran for this call. */
      readonly changed: boolean
    }
  | { readonly status: 'needs_model'; readonly error: ModelErrorCode }

/** `pending`: the Bot is still provisioning; the model step will apply the intent. */
export type SetModelOutcome = AlignOutcome | { readonly status: 'pending' }

export class ProvisionerError extends Error {
  readonly code: Extract<
    WorkspaceErrorCode,
    'validation' | 'not_found' | 'unavailable' | 'binding_broken' | 'host_error'
  >

  constructor(code: ProvisionerError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export interface BotDraft {
  readonly displayName: string
  readonly avatarVariant: string | null
  /** Decision 6B; defaults to `research`. */
  readonly policyPreset?: PolicyPreset
  /** `null`/omitted: follow the global default (decision 11A). */
  readonly modelOverride?: ModelChoice | null
  readonly sortKey?: string
}

export interface BotProvisionerDeps {
  readonly db: LocalDb
  readonly registry: Pick<
    ClawRegistryClient,
    'create' | 'ensurePreset' | 'policy' | 'list' | 'bind' | 'state'
  >
  readonly sessions: Pick<SessionClient, 'create' | 'selectSessionModel'>
  readonly catalog: Pick<ModelCatalogClient, 'read'>
  /** DSH home marker id the bindings belong to. */
  readonly homeId: string
  readonly now?: () => number
  readonly newId?: () => string
  readonly hostClockSkewMs?: number
}

/** Allowed lag of the Host clock behind Corn's when judging "created after the attempt". */
export const HOST_CLOCK_SKEW_MS = 5000
/** Plan §3.6 step 6: re-read the revision and retry at most this many times. */
export const REVISION_RETRIES = 3

/** Claw create rejections that happen before anything is written. */
const CREATE_REFUSALS = new Set([
  'REGISTRY_NAME_INVALID',
  'REGISTRY_WORKSPACE_EXISTS',
  'corn/endpoint-denied',
])
/** DSH `session/create` identity conflicts (`agent.ts` `ensureSession`, dsh-v0.2.0-rc.2). */
const SESSION_CONFLICTS = new Set([
  'agent-preset/conflict',
  'session/conflict',
  'session/agent-busy',
  ECHO_MISMATCH,
])
const BIND_MISMATCHES = new Set([
  'REGISTRY_PRESET_MISMATCH',
  'REGISTRY_WORKSPACE_MISMATCH',
])
/** Deterministic identity conflicts: repair reports them and calls nothing. */
const STOP_ERRORS: ReadonlySet<string | null> = new Set<ProvisionErrorCode>([
  'binding_mismatch',
  'claw_bind_conflict',
])
const REVISION_CONFLICT = 'REGISTRY_REVISION_CONFLICT'
const BIND_CONFLICT = 'REGISTRY_BIND_CONFLICT'

const remoteCode = (error: unknown): string | null =>
  error instanceof RemoteError ? error.code : null

function createRefused(error: unknown): boolean {
  const code = remoteCode(error)
  return (
    code !== null &&
    (CREATE_REFUSALS.has(code) || /^corn\/http-4\d\d$/u.test(code))
  )
}

function toSelection(choice: ModelChoice): ModelSelection {
  return {
    provider: choice.provider,
    model: choice.model,
    ...(choice.effort === null ? {} : { reasoningEffort: choice.effort }),
  }
}

function toChoice(selection: ModelSelection): ModelChoice {
  return {
    provider: selection.provider,
    model: selection.model,
    effort: selection.reasoningEffort ?? null,
  }
}

/** The override, else the global default; `null` when the catalog cannot run it. */
function desiredSelection(
  bot: BotRow,
  catalog: ModelCatalog,
): ModelSelection | null {
  const wanted =
    bot.modelOverride === null
      ? catalog.default
      : toSelection(bot.modelOverride)
  return wanted !== null && selectionInCatalog(catalog, wanted) ? wanted : null
}

interface Loaded {
  readonly bot: BotRow
  readonly binding: SessionBindingRow
  readonly agent: ClawAgentRow | null
}

type Step = 'continue' | ProvisionOutcome

/**
 * Bot creation and repair (plan §3.6). Every step checkpoints in the local
 * DB before its Host call, so `repair` resumes from the last durable stage.
 * Calls for one Bot are serialized; different Bots run independently.
 */
export class BotProvisioner {
  readonly #deps: BotProvisionerDeps
  readonly #now: () => number
  readonly #newId: () => string
  readonly #skewMs: number
  readonly #tails = new Map<string, Promise<unknown>>()

  constructor(deps: BotProvisionerDeps) {
    this.#deps = deps
    this.#now = deps.now ?? Date.now
    this.#newId = deps.newId ?? randomUUID
    this.#skewMs = deps.hostClockSkewMs ?? HOST_CLOCK_SKEW_MS
  }

  /**
   * Step 0 runs synchronously (bot `creating`, main conversation, `planned`
   * binding with a pre-minted `corn-` Session id), then the steps follow.
   */
  create(draft: BotDraft): Promise<ProvisionOutcome> {
    const policyPreset = draft.policyPreset ?? 'research'
    if (
      sanitizeAgentTitle(draft.displayName).length === 0 ||
      !POLICY_PRESETS.includes(policyPreset)
    )
      return Promise.reject(new ProvisionerError('validation', 'Invalid draft'))
    const id = this.#newId()
    const botId = `bot_${id}`
    const now = this.#now()
    try {
      this.#deps.db.write((tx) => {
        insertBot(tx, {
          botId,
          displayName: draft.displayName,
          avatarVariant: draft.avatarVariant,
          sortKey: draft.sortKey ?? String(now).padStart(16, '0'),
          modelOverride: draft.modelOverride ?? null,
          policyPreset,
          now,
        })
        insertMainConversation(tx, {
          conversationId: `conv_${id}`,
          botId,
          now,
        })
        insertSessionBinding(tx, {
          bindingId: `bind_${id}`,
          conversationId: `conv_${id}`,
          dshSessionId: `corn-${id}`,
          homeId: this.#deps.homeId,
          now,
        })
      })
    } catch (error) {
      return Promise.reject(dbInputError(error))
    }
    return this.#serialize(botId, () => this.#advance(botId))
  }

  /** Resumes from the last checkpoint; a `ready` Bot is a no-op. */
  repair(botId: string): Promise<ProvisionOutcome> {
    return this.#serialize(botId, () => this.#advance(botId))
  }

  /**
   * Records the override intent (`null` = follow global). A provisioned Bot
   * is aligned at once from its last applied model; Session scope only.
   */
  setModel(
    botId: string,
    override: ModelChoice | null,
  ): Promise<SetModelOutcome> {
    return this.#serialize(botId, async () => {
      this.#write((tx) => {
        setBotModelOverride(tx, botId, override, { now: this.#now() })
      })
      const loaded = this.#load(botId)
      if (!isProvisioned(loaded.binding.stage)) return { status: 'pending' }
      return this.#align(loaded, loaded.binding.appliedModel)
    })
  }

  /**
   * Decision 11A: before each send, align the Session to the desired model
   * (override, else the current global default). `observed` is the Session's
   * projected `modelSelection`; `null` when it has none.
   */
  alignModel(
    botId: string,
    observed: ModelSelection | null,
  ): Promise<AlignOutcome> {
    return this.#serialize(botId, async () => {
      const loaded = this.#load(botId)
      if (!isProvisioned(loaded.binding.stage))
        throw new ProvisionerError('binding_broken', 'Bot is not provisioned')
      return this.#align(loaded, observed === null ? null : toChoice(observed))
    })
  }

  #serialize<T>(botId: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.#tails.get(botId) ?? Promise.resolve())
      .catch(() => {})
      .then(fn)
    this.#tails.set(botId, run)
    const release = () => {
      if (this.#tails.get(botId) === run) this.#tails.delete(botId)
    }
    void run.then(release, release)
    return run
  }

  #write(fn: Parameters<LocalDb['write']>[0]): void {
    try {
      this.#deps.db.write(fn)
    } catch (error) {
      throw dbInputError(error)
    }
  }

  #load(botId: string): Loaded {
    return this.#deps.db.read((tx) => {
      const bot = getBot(tx, botId)
      if (bot === null) throw new ProvisionerError('not_found', 'Bot not found')
      const conversation = getMainConversation(tx, botId)
      const binding =
        conversation === null
          ? null
          : getLiveSessionBinding(tx, conversation.conversationId)
      if (binding === null)
        throw new ProvisionerError('binding_broken', 'Bot has no live binding')
      return { bot, binding, agent: getClawAgent(tx, botId) }
    })
  }

  async #advance(botId: string): Promise<ProvisionOutcome> {
    for (;;) {
      const loaded = this.#load(botId)
      const { lastError } = loaded.binding
      if (STOP_ERRORS.has(lastError))
        return this.#needsRepair(botId, lastError as ProvisionErrorCode)
      const step = await this.#step(loaded)
      if (step !== 'continue') return step
    }
  }

  #step(loaded: Loaded): Promise<Step> {
    const { stage } = loaded.binding
    switch (stage) {
      case 'planned':
        return this.#createAgent(loaded)
      case 'agent_created':
        return this.#ensurePreset(loaded)
      case 'preset_ensured':
      case 'session_created':
        return this.#createSession(loaded)
      case 'verified':
        return this.#bind(loaded)
      case 'bound':
      case 'needs_model':
        return this.#applyModel(loaded)
      case 'model_applied':
        return this.#markReady(loaded)
      case 'ready':
        return loaded.binding.lastError === null
          ? Promise.resolve(this.#ready(loaded))
          : this.#markReady(loaded)
      case 'retired':
        throw new ProvisionerError('binding_broken', 'Binding is retired')
      default: {
        const unreachable: never = stage
        throw new Error(`Unhandled binding stage ${String(unreachable)}`)
      }
    }
  }

  /** Step 1. The only non-idempotent call: checkpoint `claw_create_unknown` first. */
  async #createAgent(loaded: Loaded): Promise<Step> {
    if (loaded.binding.lastError === 'claw_create_unknown')
      return this.#adopt(loaded)
    let marked = loaded
    this.#write((tx) => {
      const binding = markClawCreateAttempt(tx, loaded.binding.bindingId, {
        now: this.#now(),
        lastError: 'claw_create_unknown',
      })
      marked = { ...loaded, binding }
    })
    let created: ClawAgent
    try {
      created = await this.#deps.registry.create(loaded.bot.displayName)
    } catch (error) {
      return createRefused(error)
        ? this.#fail(marked, 'claw_create_failed')
        : this.#needsRepair(loaded.bot.botId, 'claw_create_unknown')
    }
    this.#recordAgent(marked, created)
    return 'continue'
  }

  /**
   * Decision 16A: the window opens at `claw_create_attempted_at`. The binding
   * keeps `claw_create_unknown` until an agent is recorded, so repair never
   * falls back to calling `registry/create` again.
   */
  async #adopt(loaded: Loaded): Promise<Step> {
    const { bot, binding } = loaded
    const attemptedAt = binding.clawCreateAttemptedAt
    if (attemptedAt === null)
      return this.#needsRepair(bot.botId, 'claw_create_unknown')
    let list: Awaited<ReturnType<BotProvisionerDeps['registry']['list']>>
    try {
      list = await this.#deps.registry.list()
    } catch {
      return this.#needsRepair(bot.botId, 'claw_create_unknown')
    }
    const knownAgentIds = new Set(
      this.#deps.db.read((tx) => listClawAgents(tx)).map((row) => row.agentId),
    )
    const result = findAdoptionCandidate(list, {
      name: bot.displayName,
      attemptedAt,
      clockSkewMs: this.#skewMs,
      sessionId: binding.dshSessionId,
      knownAgentIds,
    })
    switch (result.kind) {
      case 'adopt':
        this.#recordAgent(loaded, result.agent)
        return 'continue'
      case 'none':
        return this.#needsRepair(bot.botId, 'claw_create_unknown')
      case 'ambiguous':
        return this.#needsRepair(
          bot.botId,
          'claw_create_ambiguous',
          result.agentIds,
        )
      default: {
        const unreachable: never = result
        throw new Error(`Unhandled adoption ${String(unreachable)}`)
      }
    }
  }

  #recordAgent(loaded: Loaded, agent: ClawAgent): void {
    const botId = loaded.bot.botId
    const now = this.#now()
    this.#write((tx) => {
      insertClawAgent(tx, {
        botId,
        agentId: agent.agentId,
        workspaceId: agent.workspaceId,
        canonicalRoot: agent.canonicalRoot,
        dshPreset: agent.dshPreset,
        // `null` only on a Bot created before migration 0002 without an agent.
        policyPreset: loaded.bot.policyPreset ?? 'research',
        now,
      })
      setSessionBindingStage(tx, loaded.binding.bindingId, 'agent_created', {
        now,
        lastError: null,
      })
    })
  }

  /** Step 2. */
  async #ensurePreset(loaded: Loaded): Promise<Step> {
    const agent = requireAgent(loaded)
    try {
      await this.#deps.registry.ensurePreset(agent)
    } catch {
      return this.#fail(loaded, 'claw_preset_failed')
    }
    this.#checkpoint(loaded, 'preset_ensured', null)
    return 'continue'
  }

  /**
   * Steps 3–5. Policy and `session/create` are idempotent (DSH creates or
   * resumes the pre-minted id and refuses a different preset or cwd), so
   * `session_created` without `verified` simply repeats them for the echo.
   */
  async #createSession(loaded: Loaded): Promise<Step> {
    const agent = requireAgent(loaded)
    try {
      await this.#deps.registry.policy(agent.agentId, agent.policyPreset)
    } catch {
      return this.#fail(loaded, 'claw_policy_failed')
    }
    const request = {
      sessionId: loaded.binding.dshSessionId,
      cwd: agent.canonicalRoot,
      agentPreset: agent.dshPreset,
    }
    let echo: { sessionId: string; agentPreset: string }
    try {
      echo = await this.#deps.sessions.create(request)
    } catch (error) {
      const code = remoteCode(error)
      return this.#fail(
        loaded,
        code !== null && SESSION_CONFLICTS.has(code)
          ? 'binding_mismatch'
          : 'session_create_failed',
      )
    }
    const created = this.#checkpoint(loaded, 'session_created', null)
    if (
      echo.sessionId !== request.sessionId ||
      echo.agentPreset !== request.agentPreset
    )
      return this.#fail(created, 'binding_mismatch')
    this.#checkpoint(created, 'verified', null)
    return 'continue'
  }

  /** Step 6. Claw re-checks preset and cwd against the Session it inspects. */
  async #bind(loaded: Loaded): Promise<Step> {
    const agent = requireAgent(loaded)
    try {
      await this.#withRevisionRetry(() =>
        this.#deps.registry.bind(agent, loaded.binding.dshSessionId),
      )
    } catch (error) {
      const code = remoteCode(error)
      if (code === REVISION_CONFLICT)
        return this.#fail(loaded, 'claw_revision_conflict')
      if (code === BIND_CONFLICT)
        return this.#fail(loaded, 'claw_bind_conflict')
      if (code !== null && BIND_MISMATCHES.has(code))
        return this.#fail(loaded, 'binding_mismatch')
      return this.#fail(loaded, 'claw_bind_failed')
    }
    this.#checkpoint(loaded, 'bound', null)
    return 'continue'
  }

  /**
   * Step 7. An override is selected on the Session; follow-global writes
   * nothing here (aligned before each send). Either way the model must be in
   * a fresh catalog, else `needs_model`; no other model is ever substituted.
   */
  async #applyModel(loaded: Loaded): Promise<Step> {
    let catalog: ModelCatalog
    try {
      catalog = await this.#deps.catalog.read()
    } catch {
      return this.#fail(loaded, 'model_catalog_failed')
    }
    const desired = desiredSelection(loaded.bot, catalog)
    if (desired === null) return this.#needsModel(loaded, 'model_unavailable')
    const choice = toChoice(desired)
    if (
      loaded.bot.modelOverride !== null &&
      !sameSelection(nullableSelection(loaded.binding.appliedModel), desired)
    ) {
      try {
        await this.#deps.sessions.selectSessionModel({
          sessionId: loaded.binding.dshSessionId,
          ...desired,
        })
      } catch {
        return this.#needsModel(loaded, 'model_select_failed')
      }
      this.#write((tx) => {
        setSessionBindingAppliedModel(tx, loaded.binding.bindingId, choice, {
          now: this.#now(),
        })
      })
    }
    this.#checkpoint(loaded, 'model_applied', null)
    return 'continue'
  }

  /** Step 8 (also re-syncs Claw for a `ready` binding left with `claw_state_failed`). */
  async #markReady(loaded: Loaded): Promise<Step> {
    try {
      await this.#withRevisionRetry(() =>
        this.#deps.registry.state(loaded.binding.dshSessionId, 'ready'),
      )
    } catch {
      return this.#fail(loaded, 'claw_state_failed')
    }
    this.#write((tx) => {
      const now = this.#now()
      setSessionBindingStage(tx, loaded.binding.bindingId, 'ready', {
        now,
        lastError: null,
      })
      if (loaded.bot.provisioning !== 'ready')
        setBotProvisioning(tx, loaded.bot.botId, 'ready', { now })
    })
    return this.#ready(loaded)
  }

  async #align(
    loaded: Loaded,
    observed: ModelChoice | null,
  ): Promise<AlignOutcome> {
    const { binding } = loaded
    let catalog: ModelCatalog
    try {
      catalog = await this.#deps.catalog.read()
    } catch {
      throw new ProvisionerError('host_error', 'Model catalog unavailable')
    }
    const desired = desiredSelection(loaded.bot, catalog)
    if (desired === null) {
      const outcome = await this.#needsModel(loaded, 'model_unavailable')
      return { status: 'needs_model', error: outcome.error }
    }
    const changed = !sameSelection(nullableSelection(observed), desired)
    if (changed) {
      try {
        await this.#deps.sessions.selectSessionModel({
          sessionId: binding.dshSessionId,
          ...desired,
        })
      } catch {
        const outcome = await this.#needsModel(loaded, 'model_select_failed')
        return { status: 'needs_model', error: outcome.error }
      }
    }
    const choice = toChoice(desired)
    if (
      !sameSelection(nullableSelection(binding.appliedModel), desired) ||
      binding.stage !== 'ready'
    ) {
      let clawSynced = binding.stage === 'ready'
      if (!clawSynced) {
        try {
          await this.#withRevisionRetry(() =>
            this.#deps.registry.state(binding.dshSessionId, 'ready'),
          )
          clawSynced = true
        } catch {
          clawSynced = false
        }
      }
      this.#write((tx) => {
        const now = this.#now()
        setSessionBindingAppliedModel(tx, binding.bindingId, choice, { now })
        if (binding.stage !== 'ready')
          setSessionBindingStage(tx, binding.bindingId, 'ready', {
            now,
            lastError: clawSynced ? null : 'claw_state_failed',
          })
      })
    }
    return { status: 'aligned', selection: desired, changed }
  }

  /** Local stage first, then Claw `needs_model`; a Claw failure keeps the model code. */
  async #needsModel(
    loaded: Loaded,
    error: ModelErrorCode,
  ): Promise<Extract<ProvisionOutcome, { status: 'needs_model' }>> {
    this.#write((tx) => {
      const now = this.#now()
      setSessionBindingStage(tx, loaded.binding.bindingId, 'needs_model', {
        now,
        lastError: error,
      })
      if (loaded.bot.provisioning !== 'ready')
        setBotProvisioning(tx, loaded.bot.botId, 'ready', { now })
    })
    try {
      await this.#withRevisionRetry(() =>
        this.#deps.registry.state(loaded.binding.dshSessionId, 'needs_model'),
      )
    } catch {
      // Claw catches up on the next repair or alignment.
    }
    return { status: 'needs_model', botId: loaded.bot.botId, error }
  }

  async #withRevisionRetry(call: () => Promise<void>): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await call()
        return
      } catch (error) {
        if (
          remoteCode(error) !== REVISION_CONFLICT ||
          attempt >= REVISION_RETRIES
        )
          throw error
      }
    }
  }

  #checkpoint(
    loaded: Loaded,
    stage: BindingStage,
    lastError: ProvisionErrorCode | null,
  ): Loaded {
    let binding = loaded.binding
    this.#write((tx) => {
      binding = setSessionBindingStage(tx, loaded.binding.bindingId, stage, {
        now: this.#now(),
        lastError,
      })
    })
    return { ...loaded, binding }
  }

  /** Records the failure on the binding (stage unchanged) and flags the Bot. */
  #fail(loaded: Loaded, error: ProvisionErrorCode): ProvisionOutcome {
    if (loaded.binding.lastError !== error)
      this.#checkpoint(loaded, loaded.binding.stage, error)
    return this.#needsRepair(loaded.bot.botId, error)
  }

  #needsRepair(
    botId: string,
    error: ProvisionErrorCode,
    orphanAgentIds?: readonly string[],
  ): ProvisionOutcome {
    this.#write((tx) => {
      const bot = getBot(tx, botId)
      if (bot !== null && bot.provisioning !== 'needs_repair')
        setBotProvisioning(tx, botId, 'needs_repair', { now: this.#now() })
    })
    return {
      status: 'needs_repair',
      botId,
      error,
      ...(orphanAgentIds === undefined ? {} : { orphanAgentIds }),
    }
  }

  #ready(loaded: Loaded): ProvisionOutcome {
    return { status: 'ready', botId: loaded.bot.botId }
  }
}

function isProvisioned(stage: BindingStage): boolean {
  return stage === 'ready' || stage === 'needs_model'
}

function nullableSelection(choice: ModelChoice | null): ModelSelection | null {
  return choice === null ? null : toSelection(choice)
}

function requireAgent(loaded: Loaded): ClawAgentRow {
  if (loaded.agent === null)
    throw new ProvisionerError('binding_broken', 'Claw agent row is missing')
  return loaded.agent
}

function dbInputError(error: unknown): unknown {
  if (!isLocalDbError(error)) return error
  if (error.code === 'invalid_input')
    return new ProvisionerError('validation', 'Invalid Bot input')
  if (error.code === 'not_found')
    return new ProvisionerError('not_found', 'Bot not found')
  return error
}
