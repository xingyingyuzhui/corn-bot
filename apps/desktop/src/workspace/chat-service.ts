import { randomUUID } from 'node:crypto'
import type { ModelSelection } from '../../../../packages/contracts/src/model-settings.ts'
import type {
  BotCommand,
  ConversationView,
  MessageCommand,
  SendMessageCommand,
  WorkspaceErrorCode,
  WorkspaceResult,
} from '../../../../packages/contracts/src/workspace.ts'
import { RemoteError } from '../../../../packages/dsh-adapter/src/remote-error.ts'
import type { FollowHandlers } from '../../../../packages/dsh-adapter/src/session-follower.ts'
import type { WireEvent } from '../../../../packages/dsh-adapter/src/session-wire.ts'
import {
  type AdmissionState,
  type AdmissionTransition,
  bodyChecksum,
  findMessageAdmissionByClientId,
  findSessionBindingBySessionId,
  getBot,
  getConversation,
  getLiveSessionBinding,
  getMainConversation,
  getMessageAdmission,
  getSessionBinding,
  insertMessageAdmission,
  isLocalDbError,
  type LocalDb,
  listOpenMessageAdmissions,
  listUnsettledMessageAdmissions,
  type MessageAdmissionRow,
  type SessionBindingRow,
  transitionMessageAdmission,
} from '../../../../packages/local-db/src/index.ts'
import type { CornData } from '../data/open.ts'
import type { ApprovalBroker } from './approval-broker.ts'
import { type BotProvisioner, ProvisionerError } from './bot-provisioner.ts'
import {
  admissionView,
  classifyPromptError,
  messageIdFor,
  mintRequestId,
  parseSessionProbe,
  requestIdFor,
  type SendFailure,
  type SessionProbe,
} from './chat-admissions.ts'
import {
  CHAT_TIMING,
  type ChatAudit,
  type ChatRuntime,
  type ChatTiming,
  type Located,
  locateRequest,
} from './chat-runtime.ts'
import { ConversationFollow, type FollowStream } from './conversation-follow.ts'
import {
  type ApprovalOverlay,
  type ApprovalRef,
  opaqueItemIds,
} from './conversation-items.ts'
import {
  type AdmissionObservation,
  ConversationProjector,
  type ProjectionUpdate,
} from './conversation-projector.ts'
import {
  StaleTurnFence,
  stopForegroundTree,
  verifyForegroundTree,
} from './foreground-stop.ts'

/**
 * `ChatService`: the Main-side chat of each Bot's one main conversation
 * (P3 plan §3.7, §3.9; decisions 5A, 8B, 11A, 14A).
 *
 * - Admissions: `clientId` dedupes IPC repeats; the DSH `requestId` is
 *   persisted before any RPC and reused for every retry. A send whose outcome
 *   is unknown is reconciled from the Session (inbox, then journal) before it
 *   is ever put on the wire again; nothing is blindly replayed.
 * - One lane per Session serializes model alignment, prompts, withdrawals and
 *   reconciliation, so the order of sends is the order DSH sees.
 * - Only the selected conversation is followed (a follow activates the
 *   Agent). Its stream feeds the projector, the approval broker and the stop
 *   fence alike.
 * - Logs and audits carry closed codes and counts only: never message text,
 *   Host text, request ids or `$events` client ids.
 */

export interface ChatServiceOptions {
  readonly data: Pick<CornData, 'available' | 'isBindingUsable'>
  readonly provisioner: Pick<BotProvisioner, 'alignModel'>
  readonly approvals: Pick<
    ApprovalBroker,
    'observe' | 'stopTurn' | 'resumeSession' | 'forgetSession' | 'cards'
  >
  /** Each changed Bot view; W1 coalesces these per frame into `changed` pushes. */
  readonly onView: (view: ConversationView) => void
  readonly onAudit?: (audit: ChatAudit) => void
  readonly log?: (line: string) => void
  readonly now?: () => number
  readonly newId?: () => string
  readonly sleep?: (ms: number) => Promise<void>
  /** Runs `fn` after `ms`; returns a cancel. */
  readonly schedule?: (fn: () => void, ms: number) => () => void
  readonly clientTimeZone?: string
  readonly timing?: Partial<ChatTiming>
}

interface Target {
  readonly db: LocalDb
  readonly botId: string
  readonly conversationId: string
  readonly binding: SessionBindingRow
  readonly sessionId: string
}

interface Followed {
  readonly botId: string
  readonly sessionId: string
  readonly conversationId: string
  readonly projector: ConversationProjector
  follow: ConversationFollow | undefined
  reopenFailures: number
  admissionsDirty: boolean
}

const OK: WorkspaceResult<null> = { ok: true, value: null }
const fail = <T>(code: WorkspaceErrorCode): WorkspaceResult<T> => ({
  ok: false,
  error: { code },
})

/** States the follow may settle as `observed` (the journal is the fact). */
const OBSERVABLE: readonly AdmissionState[] = [
  'sending',
  'unknown',
  'accepted',
  'rejected',
]

const isProvisioned = (binding: SessionBindingRow): boolean =>
  binding.stage === 'ready' || binding.stage === 'needs_model'

const DEFAULT_TIME_ZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
})()

export class ChatService {
  readonly #data: ChatServiceOptions['data']
  readonly #provisioner: ChatServiceOptions['provisioner']
  readonly #approvals: ChatServiceOptions['approvals']
  readonly #onView: ChatServiceOptions['onView']
  readonly #onAudit: NonNullable<ChatServiceOptions['onAudit']>
  readonly #log: (line: string) => void
  readonly #now: () => number
  readonly #newId: () => string
  readonly #sleep: (ms: number) => Promise<void>
  readonly #schedule: NonNullable<ChatServiceOptions['schedule']>
  readonly #timeZone: string
  readonly #timing: ChatTiming

  #runtime: ChatRuntime | undefined
  /** Advances on every attach and detach; work of an older value stops. */
  #generation = 0
  /** The current generation's read-only recovery finished; follows may open. */
  #reconciled = false
  #disposed = false
  #followed: Followed | undefined
  /** A reopen waiting for the next Host generation. */
  #parked: (() => void) | undefined
  readonly #lanes = new Map<string, Promise<unknown>>()
  readonly #fences = new Map<string, StaleTurnFence>()
  readonly #stopping = new Map<string, Promise<WorkspaceResult<null>>>()
  readonly #tasks = new Set<Promise<unknown>>()

  constructor(options: ChatServiceOptions) {
    this.#data = options.data
    this.#provisioner = options.provisioner
    this.#approvals = options.approvals
    this.#onView = options.onView
    this.#onAudit = options.onAudit ?? (() => {})
    this.#log = options.log ?? ((line) => console.warn(line))
    this.#now = options.now ?? Date.now
    this.#newId = options.newId ?? randomUUID
    this.#sleep =
      options.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    this.#schedule =
      options.schedule ??
      ((fn, ms) => {
        const timer = setTimeout(fn, ms)
        return () => clearTimeout(timer)
      })
    this.#timeZone = options.clientTimeZone ?? DEFAULT_TIME_ZONE
    this.#timing = { ...CHAT_TIMING, ...options.timing }
  }

  // -------------------------------------------------------------------------
  // Host generations
  // -------------------------------------------------------------------------

  /**
   * A Host generation is ready. Open admissions are reconciled read-only
   * (projections, then journal pages) before the selected follow opens.
   */
  attachRuntime(runtime: ChatRuntime): void {
    if (this.#disposed) return
    if (this.#runtime !== undefined) this.detachRuntime()
    this.#runtime = runtime
    const generation = ++this.#generation
    this.#reconciled = false
    this.#track(
      this.#reconcileOpen(runtime, generation).finally(() => {
        if (generation !== this.#generation) return
        this.#reconciled = true
        this.#resumeFollow()
      }),
    )
  }

  /**
   * The Host generation ended or is recovering: in-flight sends become
   * `unknown`, the follow closes and the view shows `reconnecting`.
   */
  detachRuntime(): void {
    this.#runtime = undefined
    this.#generation += 1
    this.#reconciled = false
    this.#parked = undefined
    const db = this.#db()
    if (db !== undefined) {
      try {
        db.write((tx) => {
          for (const row of listOpenMessageAdmissions(tx))
            if (row.state === 'sending')
              transitionMessageAdmission(tx, row.requestId, 'unknown', {
                now: this.#now(),
                lastError: 'host_lost',
              })
        })
      } catch {
        this.#log('Corn chat: could not mark in-flight sends unknown')
      }
    }
    const entry = this.#followed
    if (entry === undefined) return
    entry.follow?.stop()
    entry.follow = undefined
    this.#publish(entry.projector.rebaseline('disconnected'))
    this.#refreshAdmissions(entry)
  }

  /** Stops following and drops queued reopen work; pending tasks finish. */
  dispose(): void {
    this.#disposed = true
    this.#runtime = undefined
    this.#generation += 1
    this.#parked = undefined
    this.#followed?.follow?.stop()
    this.#followed = undefined
  }

  /** Resolves once every send, reconciliation and stop verification has settled. */
  async idle(): Promise<void> {
    while (this.#tasks.size > 0) await Promise.allSettled([...this.#tasks])
  }

  // -------------------------------------------------------------------------
  // Selection and views
  // -------------------------------------------------------------------------

  /**
   * Decision 14A: follow only the selected Bot's main conversation; the
   * previous follow closes. `null` follows nothing.
   */
  select(botId: string | null): WorkspaceResult<null> {
    const current = this.#followed
    if (botId === null) {
      this.#unfollow()
      return OK
    }
    const target = this.#target(botId)
    if (!target.ok) {
      this.#unfollow()
      return target
    }
    const { sessionId, conversationId } = target.value
    if (current?.botId === botId && current.sessionId === sessionId) return OK
    this.#unfollow()
    if (current !== undefined && current.botId === botId)
      this.forgetSession(current.sessionId)
    const entry: Followed = {
      botId,
      sessionId,
      conversationId,
      projector: new ConversationProjector({
        botId,
        mintId: opaqueItemIds(conversationId),
        messageIdFor,
        onAdmissionObserved: (observation) =>
          this.#observed(entry, observation),
        approvalOverlay: (ref) => this.#overlay(sessionId, ref),
      }),
      follow: undefined,
      reopenFailures: 0,
      admissionsDirty: false,
    }
    this.#followed = entry
    this.#refreshAdmissions(entry)
    if (this.#runtime !== undefined && this.#reconciled)
      this.#startFollow(entry)
    return OK
  }

  /** The followed Bot's current view; `undefined` for any other Bot. */
  view(botId: string): ConversationView | undefined {
    const entry = this.#followed
    return entry?.botId === botId ? entry.projector.view() : undefined
  }

  /** W1 routes the broker's `approvals` changes here. */
  approvalsChanged(sessionId: string): void {
    const entry = this.#followed
    if (entry?.sessionId === sessionId) this.#publish(entry.projector.refresh())
  }

  /**
   * The broker's `botForSession`: the Bot of a provisioned foreground binding
   * of the current home, else `undefined` (the request fails closed).
   */
  botForSession(sessionId: string): string | undefined {
    const available = this.#data.available()
    if (!available.ok) return undefined
    try {
      return available.value.read((tx) => {
        const binding = findSessionBindingBySessionId(tx, sessionId)
        if (
          binding === null ||
          !isProvisioned(binding) ||
          !this.#data.isBindingUsable(binding)
        )
          return undefined
        return getConversation(tx, binding.conversationId)?.botId
      })
    } catch {
      return undefined
    }
  }

  /** A binding retired: drop its follow, approvals and stop fence. */
  forgetSession(sessionId: string): void {
    if (this.#followed?.sessionId === sessionId) this.#unfollow()
    this.#approvals.forgetSession(sessionId)
    this.#fences.delete(sessionId)
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  /**
   * Resolves to the message id once the admission is durable; delivery then
   * shows in the view. A repeated `clientId` returns the original id and
   * never reaches DSH again.
   */
  async sendMessage(
    command: SendMessageCommand,
  ): Promise<WorkspaceResult<string>> {
    const resolved = this.#target(command.botId)
    if (!resolved.ok) return resolved
    const target = resolved.value
    const repeat = this.#repeat(target, command)
    if (repeat !== undefined) return repeat
    if (this.#runtime === undefined) return fail('runtime_not_ready')
    const requestId = mintRequestId(this.#newId())
    try {
      target.db.write((tx) =>
        insertMessageAdmission(tx, {
          requestId,
          conversationId: target.conversationId,
          bindingId: target.binding.bindingId,
          clientId: command.clientId,
          bodyText: command.text,
          now: this.#now(),
        }),
      )
    } catch (error) {
      if (isLocalDbError(error, 'constraint'))
        return this.#repeat(target, command) ?? fail('conflict')
      return fail('data_unavailable')
    }
    this.#admissionsChanged(target.conversationId)
    this.#track(
      this.#lane(target.sessionId, () => this.#deliver(target, requestId)),
    )
    return { ok: true, value: messageIdFor(requestId) as string }
  }

  /**
   * Manual resend with the original `requestId`. `rejected` goes back on the
   * wire; `unknown` is reconciled first and only resent if DSH has no trace.
   * Delivered or in-flight messages are left alone.
   */
  async resend(command: MessageCommand): Promise<WorkspaceResult<null>> {
    const found = this.#admission(command)
    if (!found.ok) return found
    const { target, row } = found.value
    switch (row.state) {
      case 'withdrawn':
        return fail('stale')
      case 'observed':
      case 'accepted':
      case 'pending':
      case 'sending':
        return OK
      case 'rejected':
      case 'unknown':
        break
      default: {
        const unreachable: never = row.state
        throw new Error(`Unhandled admission state ${String(unreachable)}`)
      }
    }
    if (this.#runtime === undefined) return fail('runtime_not_ready')
    this.#track(
      this.#lane(target.sessionId, () =>
        this.#resendInLane(target, row.requestId),
      ),
    )
    return OK
  }

  /**
   * Withdraws a message that has not started: an unsent one locally, one DSH
   * already queued with `updateQueue remove`. A message DSH has recorded is
   * `stale`.
   */
  async cancelQueued(command: MessageCommand): Promise<WorkspaceResult<null>> {
    const found = this.#admission(command)
    if (!found.ok) return found
    const { target } = found.value
    return this.#lane(target.sessionId, () =>
      this.#withdrawInLane(target, found.value.row.requestId),
    )
  }

  /**
   * Decision 8B: stop this conversation's Session tree leaf first, the parent
   * Turn last. Queued messages stay queued. Until the next send, any Turn the
   * Session starts is stale and cancelled at once.
   */
  cancelTurn(command: BotCommand): Promise<WorkspaceResult<null>> {
    const resolved = this.#target(command.botId)
    if (!resolved.ok) return Promise.resolve(resolved)
    const runtime = this.#runtime
    if (runtime === undefined) return Promise.resolve(fail('runtime_not_ready'))
    const { sessionId, botId } = resolved.value
    const running = this.#stopping.get(sessionId)
    if (running !== undefined) return running
    const stop = this.#stop(runtime, botId, sessionId).finally(() => {
      this.#stopping.delete(sessionId)
    })
    this.#stopping.set(sessionId, stop)
    return stop
  }

  /** One older history page of the followed conversation. */
  async loadEarlier(command: BotCommand): Promise<WorkspaceResult<null>> {
    const resolved = this.#target(command.botId)
    if (!resolved.ok) return resolved
    if (this.#runtime === undefined) return fail('runtime_not_ready')
    const entry = this.#followed
    if (entry?.botId !== command.botId || entry.follow === undefined)
      return fail('stale')
    try {
      const result = await entry.follow.loadEarlier()
      return result === 'stale' ? fail('stale') : OK
    } catch {
      return fail('host_error')
    }
  }

  // -------------------------------------------------------------------------
  // Delivery
  // -------------------------------------------------------------------------

  /** Model alignment (11A), then the prompt with bounded same-generation retries. */
  async #deliver(target: Target, requestId: string): Promise<void> {
    const runtime = this.#runtime
    const generation = this.#generation
    if (runtime === undefined) {
      this.#settleUnsent(target, requestId, 'runtime_not_ready')
      return
    }
    // A new user prompt ends the previous stop.
    this.#approvals.resumeSession(target.sessionId)
    this.#fences.delete(target.sessionId)
    let probe: SessionProbe | null | undefined
    try {
      probe = parseSessionProbe(
        await runtime.sessions.projections(target.sessionId),
      )
    } catch {
      probe = undefined
    }
    if (probe === null) {
      this.#settleUnsent(target, requestId, 'binding_broken')
      return
    }
    const failure = await this.#align(target, probe?.modelSelection ?? null)
    if (failure !== undefined) {
      this.#settleUnsent(target, requestId, failure)
      return
    }
    if (generation !== this.#generation) {
      this.#settleUnsent(target, requestId, 'runtime_not_ready')
      return
    }
    for (let retry = 0; ; retry += 1) {
      const sending = this.#move(target, requestId, 'sending', {
        from: ['pending', 'rejected', 'unknown'],
        countAttempt: true,
      })
      // Withdrawn or observed meanwhile, or the write failed: no RPC.
      if (sending === null || sending.bodyText === null) return
      try {
        await runtime.sessions.prompt({
          sessionId: target.sessionId,
          requestId,
          mode: 'queue',
          content: [{ type: 'text', text: sending.bodyText }],
          clientTimeZone: this.#timeZone,
        })
        this.#move(target, requestId, 'accepted', { from: ['sending'] })
        return
      } catch (error) {
        const outcome = classifyPromptError(error)
        this.#move(target, requestId, outcome.kind, {
          from: ['sending'],
          lastError: outcome.code,
        })
        if (outcome.kind === 'rejected') return
      }
      if (
        !(await this.#awaitRetry(target, requestId, runtime, generation, retry))
      )
        return
    }
  }

  /**
   * Before a same-generation retry: back off, then reconcile. `true` only
   * when DSH shows no trace of the request and it may go on the wire again.
   */
  async #awaitRetry(
    target: Target,
    requestId: string,
    runtime: ChatRuntime,
    generation: number,
    retry: number,
  ): Promise<boolean> {
    const { promptRetries, retryDelaysMs } = this.#timing
    if (retry >= promptRetries) return false
    await this.#sleep(
      retryDelaysMs[Math.min(retry, retryDelaysMs.length - 1)] ?? 0,
    )
    if (generation !== this.#generation) return false
    const row = this.#read(target, requestId)
    if (row?.state !== 'unknown') return false
    return this.#applyLocated(
      target,
      requestId,
      await this.#locate(runtime, target.sessionId, row),
    )
  }

  async #resendInLane(target: Target, requestId: string): Promise<void> {
    const runtime = this.#runtime
    const row = this.#read(target, requestId)
    if (runtime === undefined || row === null) return
    if (row.state === 'unknown') {
      const located = await this.#locate(runtime, target.sessionId, row)
      if (!this.#applyLocated(target, requestId, located)) return
    }
    if (row.state === 'rejected' || row.state === 'unknown')
      await this.#deliver(target, requestId)
  }

  async #withdrawInLane(
    target: Target,
    requestId: string,
  ): Promise<WorkspaceResult<null>> {
    const row = this.#read(target, requestId)
    if (row === null) return fail('not_found')
    switch (row.state) {
      case 'withdrawn':
        return OK
      case 'observed':
        return fail('stale')
      case 'sending':
        return fail('unavailable')
      case 'pending':
      case 'rejected':
        return this.#move(target, requestId, 'withdrawn', {
          from: ['pending', 'rejected'],
        }) === null
          ? fail('stale')
          : OK
      case 'accepted':
      case 'unknown':
        return this.#withdrawHeld(target, row)
      default: {
        const unreachable: never = row.state
        throw new Error(`Unhandled admission state ${String(unreachable)}`)
      }
    }
  }

  /** An `accepted`/`unknown` send: remove it from DSH's inbox when it is still there. */
  async #withdrawHeld(
    target: Target,
    row: MessageAdmissionRow,
  ): Promise<WorkspaceResult<null>> {
    const runtime = this.#runtime
    if (runtime === undefined) return fail('runtime_not_ready')
    const located = await this.#locate(runtime, target.sessionId, row)
    switch (located.kind) {
      case 'journal':
        this.#applyLocated(target, row.requestId, located)
        return fail('stale')
      case 'inbox':
        try {
          await runtime.sessions.updateQueue({
            sessionId: target.sessionId,
            itemId: located.itemId,
            action: { kind: 'remove' },
          })
        } catch (error) {
          if (
            error instanceof RemoteError &&
            error.code === 'session/queue-item-not-found'
          ) {
            // Claimed meanwhile: the journal now holds it.
            this.#applyLocated(
              target,
              row.requestId,
              await this.#locate(runtime, target.sessionId, row),
            )
            return fail('stale')
          }
          return fail('host_error')
        }
        return this.#move(target, row.requestId, 'withdrawn', {
          from: ['accepted', 'unknown'],
        }) === null
          ? fail('stale')
          : OK
      case 'absent':
        if (row.state !== 'unknown') return fail('stale')
        return this.#move(target, row.requestId, 'withdrawn', {
          from: ['unknown'],
        }) === null
          ? fail('stale')
          : OK
      case 'missing':
        return fail('binding_broken')
      case 'unreadable':
        return fail('host_error')
      default: {
        const unreachable: never = located
        throw new Error(`Unhandled location ${String(unreachable)}`)
      }
    }
  }

  /** Decision 11A through P1; a failure is the admission's closed code. */
  async #align(
    target: Target,
    observed: ModelSelection | null,
  ): Promise<SendFailure | undefined> {
    try {
      const outcome = await this.#provisioner.alignModel(target.botId, observed)
      return outcome.status === 'aligned' ? undefined : 'model_unavailable'
    } catch (error) {
      return error instanceof ProvisionerError &&
        error.code === 'binding_broken'
        ? 'binding_broken'
        : 'host_error'
    }
  }

  /** Only a never-sent (`pending`) admission is refused locally; others keep their state. */
  #settleUnsent(target: Target, requestId: string, code: SendFailure): void {
    this.#move(target, requestId, 'rejected', {
      from: ['pending'],
      lastError: code,
    })
  }

  // -------------------------------------------------------------------------
  // Reconciliation
  // -------------------------------------------------------------------------

  #locate(
    runtime: ChatRuntime,
    sessionId: string,
    row: MessageAdmissionRow,
  ): Promise<Located> {
    return locateRequest(
      runtime.sessions,
      { sessionId, requestId: row.requestId, createdAt: row.createdAt },
      this.#timing,
    )
  }

  /** Records what was found; `true` when DSH has no trace (a resend may go out). */
  #applyLocated(target: Target, requestId: string, located: Located): boolean {
    switch (located.kind) {
      case 'journal':
        this.#move(target, requestId, 'observed', {
          from: ['sending', 'unknown', 'accepted', 'rejected'],
          observedSeq: located.seq,
        })
        return false
      case 'inbox':
        this.#move(target, requestId, 'accepted', {
          from: ['sending', 'unknown'],
        })
        return false
      case 'absent':
        return true
      case 'missing':
      case 'unreadable':
        return false
      default: {
        const unreachable: never = located
        throw new Error(`Unhandled location ${String(unreachable)}`)
      }
    }
  }

  /**
   * Plan §3.7 read-only recovery. `pending` never reached the wire and is
   * refused as `not_sent`; `sending`/`unknown` are looked up and stay
   * `unknown` (manual resend) when DSH has no trace. Nothing is resent here.
   */
  async #reconcileOpen(
    runtime: ChatRuntime,
    generation: number,
  ): Promise<void> {
    const db = this.#db()
    if (db === undefined) return
    let rows: readonly MessageAdmissionRow[]
    try {
      rows = db.read((tx) => listOpenMessageAdmissions(tx))
    } catch {
      return
    }
    const work: Promise<unknown>[] = []
    for (const row of rows) {
      const target = this.#bindingTarget(db, row)
      if (target === undefined) continue
      work.push(
        this.#lane(target.sessionId, async () => {
          if (generation !== this.#generation) return
          const current = this.#read(target, row.requestId)
          if (current === null) return
          if (current.state === 'pending') {
            this.#settleUnsent(target, row.requestId, 'not_sent')
            return
          }
          if (current.state !== 'sending' && current.state !== 'unknown') return
          const located = await this.#locate(runtime, target.sessionId, current)
          if (generation !== this.#generation) return
          this.#applyLocated(target, row.requestId, located)
          this.#move(target, row.requestId, 'unknown', {
            from: ['sending'],
            lastError: 'host_lost',
          })
        }),
      )
    }
    await Promise.allSettled(work)
  }

  /** The send target of an admission's binding, when it is still live and usable. */
  #bindingTarget(db: LocalDb, row: MessageAdmissionRow): Target | undefined {
    try {
      return db.read((tx) => {
        const binding = getSessionBinding(tx, row.bindingId)
        if (
          binding === null ||
          !isProvisioned(binding) ||
          !this.#data.isBindingUsable(binding)
        )
          return undefined
        const conversation = getConversation(tx, binding.conversationId)
        if (conversation === null) return undefined
        return {
          db,
          botId: conversation.botId,
          conversationId: conversation.conversationId,
          binding,
          sessionId: binding.dshSessionId,
        }
      })
    } catch {
      return undefined
    }
  }

  // -------------------------------------------------------------------------
  // Stop
  // -------------------------------------------------------------------------

  async #stop(
    runtime: ChatRuntime,
    botId: string,
    sessionId: string,
  ): Promise<WorkspaceResult<null>> {
    this.#approvals.stopTurn(sessionId)
    const followed = this.#followed
    this.#fences.set(
      sessionId,
      new StaleTurnFence(
        followed?.sessionId === sessionId
          ? followed.projector.cursor
          : undefined,
        this.#now(),
      ),
    )
    const ports = { sessions: runtime.sessions, jobs: runtime.jobs }
    const report = await stopForegroundTree(ports, sessionId, {
      now: this.#now,
      sleep: this.#sleep,
      ...this.#timing.stop,
    })
    this.#audit({ kind: 'stop', botId, ...report })
    this.#track(
      this.#sleep(this.#timing.verifyDelayMs)
        .then(() => verifyForegroundTree(ports, sessionId))
        .then((verification) =>
          this.#audit({ kind: 'stop-verify', botId, verification }),
        ),
    )
    return report.parentCancel === 'failed' ? fail('host_error') : OK
  }

  /** The stale-Turn fallback on the followed stream: cancel at `turn/start`, count steps. */
  #watchStale(entry: Followed, events: readonly WireEvent[]): void {
    const fence = this.#fences.get(entry.sessionId)
    if (fence === undefined) return
    for (const signal of fence.observe(events)) {
      switch (signal.kind) {
        case 'stale-turn': {
          this.#audit({
            kind: 'stale-turn',
            botId: entry.botId,
            turn: signal.turn,
          })
          const runtime = this.#runtime
          if (runtime === undefined) break
          this.#track(
            runtime.sessions.cancel(entry.sessionId).catch(() => {
              this.#log('Corn chat: stale turn cancel failed')
            }),
          )
          break
        }
        case 'leaked-request':
          this.#audit({
            kind: 'leaked-request',
            botId: entry.botId,
            turn: signal.turn,
            total: fence.leakedRequests,
          })
          break
        default: {
          const unreachable: never = signal
          throw new Error(`Unhandled stale signal ${String(unreachable)}`)
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Follow
  // -------------------------------------------------------------------------

  #startFollow(entry: Followed): void {
    const follow = new ConversationFollow({
      projector: entry.projector,
      openFollow: (handlers) => this.#openFollow(entry, handlers),
      page: (request) => {
        const runtime = this.#runtime
        if (runtime === undefined)
          return Promise.reject(
            new RemoteError('corn/disconnected', 'Host is not ready'),
          )
        return runtime.sessions.page({ sessionId: entry.sessionId, ...request })
      },
      onView: (view) => this.#emitView(view),
      scheduleReopen: (_reason, reopen) => this.#scheduleReopen(entry, reopen),
    })
    entry.follow = follow
    follow.start()
  }

  /**
   * Tees the follow: durable events reach the approval broker first (so the
   * projection's approval overlay is current), then the projector, then the
   * stale-Turn fence. An open that throws is reported asynchronously as a
   * lost stream so the follow schedules its next try.
   */
  #openFollow(entry: Followed, handlers: FollowHandlers): FollowStream {
    const tee: FollowHandlers = {
      onSnapshot: (snapshot) => {
        entry.reopenFailures = 0
        this.#approvals.observe(entry.sessionId, snapshot.records)
        handlers.onSnapshot(snapshot)
        this.#watchStale(entry, snapshot.records)
        this.#flushAdmissions(entry)
      },
      onEvent: (event) => {
        this.#approvals.observe(entry.sessionId, [event])
        handlers.onEvent(event)
        this.#watchStale(entry, [event])
        this.#flushAdmissions(entry)
      },
      onAssistantStream: (frame) => handlers.onAssistantStream?.(frame),
      onGap: (gap) => handlers.onGap(gap),
      onError: (error) => handlers.onError(error),
    }
    try {
      const runtime = this.#runtime
      if (runtime === undefined)
        throw new RemoteError('corn/disconnected', 'Host is not ready')
      return runtime.openFollow(entry.sessionId, tee)
    } catch (error) {
      let closed = false
      queueMicrotask(() => {
        if (!closed)
          handlers.onError(
            error instanceof Error ? error : new Error('Follow open failed'),
          )
      })
      return {
        close: () => {
          closed = true
        },
      }
    }
  }

  /** Bounded exponential backoff while the Host is up; otherwise wait for the next generation. */
  #scheduleReopen(entry: Followed, reopen: () => void): () => void {
    if (this.#followed !== entry) return () => {}
    entry.reopenFailures += 1
    const { reopenBaseMs, reopenMaxMs, reopenFailureLimit } = this.#timing
    if (
      this.#runtime === undefined ||
      entry.reopenFailures > reopenFailureLimit
    ) {
      if (entry.reopenFailures > reopenFailureLimit)
        this.#publish(entry.projector.fail())
      this.#parked = reopen
      return () => {
        if (this.#parked === reopen) this.#parked = undefined
      }
    }
    const delay = Math.min(
      reopenBaseMs * 2 ** (entry.reopenFailures - 1),
      reopenMaxMs,
    )
    return this.#schedule(reopen, delay)
  }

  /** After attach: start the selected follow or run its parked reopen. */
  #resumeFollow(): void {
    const entry = this.#followed
    if (entry === undefined || this.#runtime === undefined) return
    entry.reopenFailures = 0
    if (entry.follow === undefined) {
      this.#startFollow(entry)
      return
    }
    const parked = this.#parked
    this.#parked = undefined
    parked?.()
  }

  #unfollow(): void {
    const entry = this.#followed
    this.#followed = undefined
    this.#parked = undefined
    entry?.follow?.stop()
  }

  // -------------------------------------------------------------------------
  // Admissions and views
  // -------------------------------------------------------------------------

  /** `onAdmissionObserved`: runs inside the projector, so the view refresh is deferred. */
  #observed(entry: Followed, observation: AdmissionObservation): void {
    const db = this.#db()
    if (db === undefined) return
    try {
      const moved = db.write((tx) => {
        const row = getMessageAdmission(tx, observation.requestId)
        if (
          row === null ||
          row.conversationId !== entry.conversationId ||
          !OBSERVABLE.includes(row.state)
        )
          return false
        transitionMessageAdmission(tx, row.requestId, 'observed', {
          now: this.#now(),
          observedSeq: observation.seq,
        })
        return true
      })
      if (moved) entry.admissionsDirty = true
    } catch {
      this.#log('Corn chat: could not record an observed send')
    }
  }

  #flushAdmissions(entry: Followed): void {
    if (!entry.admissionsDirty || this.#followed !== entry) return
    entry.admissionsDirty = false
    this.#refreshAdmissions(entry)
  }

  #admissionsChanged(conversationId: string): void {
    const entry = this.#followed
    if (entry?.conversationId === conversationId) this.#refreshAdmissions(entry)
  }

  #refreshAdmissions(entry: Followed): void {
    const db = this.#db()
    let rows: readonly MessageAdmissionRow[] = []
    if (db !== undefined) {
      try {
        rows = db.read((tx) =>
          listUnsettledMessageAdmissions(tx, entry.conversationId),
        )
      } catch {
        rows = []
      }
    }
    this.#publish(
      entry.projector.setAdmissions(
        rows.flatMap((row) => {
          const view = admissionView(row)
          return view === undefined ? [] : [view]
        }),
      ),
    )
  }

  #overlay(sessionId: string, ref: ApprovalRef): ApprovalOverlay | undefined {
    const card = this.#approvals
      .cards(sessionId)
      .find(
        (candidate) =>
          candidate.askedId === ref.approvalId ||
          (ref.callId !== undefined && candidate.callId === ref.callId),
      )
    return card === undefined
      ? undefined
      : { handle: card.handle, status: card.status }
  }

  #publish(update: ProjectionUpdate): void {
    if (update.view !== undefined) this.#emitView(update.view)
  }

  #emitView(view: ConversationView): void {
    try {
      this.#onView(view)
    } catch {
      // A failing listener must not break follow callbacks.
    }
  }

  // -------------------------------------------------------------------------
  // Lookup and persistence
  // -------------------------------------------------------------------------

  #db(): LocalDb | undefined {
    const available = this.#data.available()
    return available.ok ? available.value : undefined
  }

  /** The Bot's one main conversation and its usable live binding. */
  #target(botId: string): WorkspaceResult<Target> {
    const available = this.#data.available()
    if (!available.ok) return available
    const db = available.value
    let result: WorkspaceResult<Target>
    try {
      result = db.read((tx): WorkspaceResult<Target> => {
        const bot = getBot(tx, botId)
        if (bot === null) return fail('not_found')
        const conversation = getMainConversation(tx, botId)
        const binding =
          conversation === null
            ? null
            : getLiveSessionBinding(tx, conversation.conversationId)
        if (conversation === null || binding === null)
          return fail('binding_broken')
        if (!isProvisioned(binding))
          return fail(
            bot.provisioning === 'creating' ? 'unavailable' : 'binding_broken',
          )
        if (!this.#data.isBindingUsable(binding)) return fail('binding_broken')
        return {
          ok: true,
          value: {
            db,
            botId,
            conversationId: conversation.conversationId,
            binding,
            sessionId: binding.dshSessionId,
          },
        }
      })
    } catch {
      return fail('data_unavailable')
    }
    return result
  }

  /** A repeated `clientId`: the original message id, or `conflict` for other text. */
  #repeat(
    target: Target,
    command: SendMessageCommand,
  ): WorkspaceResult<string> | undefined {
    const existing = target.db.read((tx) =>
      findMessageAdmissionByClientId(
        tx,
        target.conversationId,
        command.clientId,
      ),
    )
    if (existing === null) return undefined
    const messageId = messageIdFor(existing.requestId)
    if (
      messageId === undefined ||
      existing.bodySha256 !== bodyChecksum(command.text)
    )
      return fail('conflict')
    return { ok: true, value: messageId }
  }

  #admission(
    command: MessageCommand,
  ): WorkspaceResult<{ target: Target; row: MessageAdmissionRow }> {
    const resolved = this.#target(command.botId)
    if (!resolved.ok) return resolved
    const requestId = requestIdFor(command.messageId)
    if (requestId === undefined) return fail('not_found')
    const row = this.#read(resolved.value, requestId)
    if (row === null) return fail('not_found')
    return { ok: true, value: { target: resolved.value, row } }
  }

  /** The admission when it belongs to the target's conversation. */
  #read(target: Target, requestId: string): MessageAdmissionRow | null {
    try {
      const row = target.db.read((tx) => getMessageAdmission(tx, requestId))
      return row?.conversationId === target.conversationId ? row : null
    } catch {
      return null
    }
  }

  /**
   * One guarded transition: applied only from the listed states, so racing
   * paths (follow, prompt reply, detach) never fight. `null` when skipped or
   * when the write failed (the caller then sends nothing).
   */
  #move(
    target: Target,
    requestId: string,
    to: AdmissionState,
    options: {
      readonly from: readonly AdmissionState[]
    } & Omit<AdmissionTransition, 'now'>,
  ): MessageAdmissionRow | null {
    const { from, ...transition } = options
    let moved: MessageAdmissionRow | null
    try {
      moved = target.db.write((tx) => {
        const row = getMessageAdmission(tx, requestId)
        if (
          row === null ||
          row.conversationId !== target.conversationId ||
          !from.includes(row.state)
        )
          return null
        return transitionMessageAdmission(tx, requestId, to, {
          ...transition,
          now: this.#now(),
        })
      })
    } catch {
      this.#log(`Corn chat: admission write failed (${to})`)
      return null
    }
    if (moved !== null) this.#admissionsChanged(target.conversationId)
    return moved
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  #lane<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.#lanes.get(sessionId) ?? Promise.resolve())
      .catch(() => {})
      .then(fn)
    this.#lanes.set(sessionId, run)
    const release = () => {
      if (this.#lanes.get(sessionId) === run) this.#lanes.delete(sessionId)
    }
    void run.then(release, release)
    return run
  }

  #track(task: Promise<unknown>): void {
    const tracked = task.catch(() => {
      this.#log('Corn chat: background task failed')
    })
    this.#tasks.add(tracked)
    void tracked.finally(() => this.#tasks.delete(tracked))
  }

  #audit(entry: ChatAudit): void {
    try {
      this.#onAudit(entry)
    } catch {
      // Auditing must not break the stop path.
    }
  }
}
