import { randomUUID } from 'node:crypto'
import type { ModelSelection } from '../../../../packages/contracts/src/model-settings.ts'
import type {
  BotCommand,
  ConversationView,
  MessageCommand,
  SendMessageCommand,
  WorkspaceResult,
} from '../../../../packages/contracts/src/workspace.ts'
import { RemoteError } from '../../../../packages/dsh-adapter/src/remote-error.ts'
import type {
  AdmissionState,
  MessageAdmissionRow,
} from '../../../../packages/local-db/src/index.ts'
import type { CornData } from '../data/open.ts'
import type { ApprovalBroker } from './approval-broker.ts'
import { type BotProvisioner, ProvisionerError } from './bot-provisioner.ts'
import {
  classifyPromptError,
  messageIdFor,
  mintRequestId,
  parseSessionProbe,
  type SendFailure,
  type SessionProbe,
} from './chat-admissions.ts'
import { ChatFollower } from './chat-follow.ts'
import { ChatLedger, type ChatTarget } from './chat-ledger.ts'
import {
  CHAT_TIMING,
  type ChatAudit,
  type ChatRuntime,
  type ChatTiming,
  fail,
  type Located,
  locateRequest,
  OK,
} from './chat-runtime.ts'
import { ChatStopper } from './chat-stop.ts'

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
 *
 * Admission rows live in `ChatLedger`, the follow in `ChatFollower`, the
 * foreground stop and its stale-Turn fence in `ChatStopper`; this class owns
 * Host generations, the per-Session lanes and the commands.
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

const DEFAULT_TIME_ZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
})()

export class ChatService {
  readonly #provisioner: ChatServiceOptions['provisioner']
  readonly #approvals: ChatServiceOptions['approvals']
  readonly #log: (line: string) => void
  readonly #newId: () => string
  readonly #sleep: (ms: number) => Promise<void>
  readonly #timeZone: string
  readonly #timing: ChatTiming
  readonly #ledger: ChatLedger
  readonly #follower: ChatFollower
  readonly #stopper: ChatStopper

  #runtime: ChatRuntime | undefined
  /** Advances on every attach and detach; work of an older value stops. */
  #generation = 0
  /** The current generation's read-only recovery finished; follows may open. */
  #reconciled = false
  #disposed = false
  readonly #lanes = new Map<string, Promise<unknown>>()
  readonly #tasks = new Set<Promise<unknown>>()

  constructor(options: ChatServiceOptions) {
    this.#provisioner = options.provisioner
    this.#approvals = options.approvals
    this.#log = options.log ?? ((line) => console.warn(line))
    const now = options.now ?? Date.now
    this.#newId = options.newId ?? randomUUID
    this.#sleep =
      options.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    this.#timeZone = options.clientTimeZone ?? DEFAULT_TIME_ZONE
    this.#timing = { ...CHAT_TIMING, ...options.timing }
    const runtime = () => this.#runtime
    this.#ledger = new ChatLedger({
      data: options.data,
      now,
      log: this.#log,
      onChanged: (conversationId) =>
        this.#follower.admissionsChanged(conversationId),
    })
    const schedule =
      options.schedule ??
      ((fn, ms) => {
        const timer = setTimeout(fn, ms)
        return () => clearTimeout(timer)
      })
    this.#stopper = new ChatStopper({
      approvals: options.approvals,
      runtime,
      cursor: (sessionId) => this.#follower.cursor(sessionId),
      onAudit: options.onAudit ?? (() => {}),
      track: (task) => this.#track(task),
      log: this.#log,
      now,
      sleep: this.#sleep,
      schedule,
      timing: this.#timing,
      onPending: (sessionId) => this.#ledger.rejectPending(sessionId),
      onPhase: (botId) => this.#follower.republish(botId),
      onColdEvents: (sessionId, events) =>
        this.#approvals.observe(sessionId, events),
    })
    this.#follower = new ChatFollower({
      approvals: options.approvals,
      ledger: this.#ledger,
      runtime,
      stopPhase: (botId) => this.#stopper.phase(botId),
      onEvents: (target, events) =>
        this.#stopper.watch(target.botId, target.sessionId, events),
      onControlLost: (botId, sessionId) =>
        this.#stopper.armCold(botId, sessionId),
      onView: options.onView,
      schedule,
      timing: this.#timing,
    })
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
        this.#follower.resume()
        this.#stopper.armUnwatched((sessionId) =>
          this.#follower.hasWarm(sessionId),
        )
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
    this.#stopper.invalidate()
    this.#ledger.markInFlightUnknown()
    this.#follower.detach()
  }

  /** Stops following and drops queued reopen work; pending tasks finish. */
  dispose(): void {
    this.#disposed = true
    this.#runtime = undefined
    this.#generation += 1
    this.#stopper.invalidate()
    this.#follower.dispose()
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
    const current = this.#follower.current
    if (botId === null) {
      this.#releaseFollow(current)
      return OK
    }
    const target = this.#ledger.target(botId)
    if (!target.ok) {
      this.#releaseFollow(current)
      return target
    }
    const { sessionId, conversationId } = target.value
    if (current?.botId === botId && current.sessionId === sessionId) return OK
    this.#releaseFollow(current)
    if (current !== undefined && current.botId === botId)
      this.forgetSession(current.sessionId)
    this.#follower.follow(
      { botId, sessionId, conversationId },
      this.#runtime !== undefined && this.#reconciled,
    )
    return OK
  }

  /** The followed Bot's current view; `undefined` for any other Bot. */
  view(botId: string): ConversationView | undefined {
    return this.#follower.view(botId)
  }

  /** W1 routes the broker's `approvals` changes here. */
  approvalsChanged(sessionId: string): void {
    this.#follower.approvalsChanged(sessionId)
  }

  /**
   * The broker's `botForSession`: the Bot of a provisioned foreground binding
   * of the current home, else `undefined` (the request fails closed).
   */
  botForSession(sessionId: string): string | undefined {
    return this.#ledger.botForSession(sessionId)
  }

  /**
   * Leave the current follow. A Session that is still stop-protected keeps
   * its warm stream as a control watch instead of opening another Agent.
   */
  #releaseFollow(current: { readonly sessionId: string } | undefined): void {
    if (current !== undefined && this.#stopper.protects(current.sessionId)) {
      this.#follower.demote(current.sessionId)
      return
    }
    this.#follower.unfollow()
  }

  /** A binding retired: drop its follow, approvals and stop fence. */
  forgetSession(sessionId: string): void {
    this.#follower.forget(sessionId)
    this.#approvals.forgetSession(sessionId)
    this.#stopper.lift(sessionId)
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
    const resolved = this.#ledger.target(command.botId)
    if (!resolved.ok) return resolved
    const target = resolved.value
    const repeat = this.#ledger.repeat(target, command)
    if (repeat !== undefined) return repeat
    if (this.#stopper.blocksDispatch(target.sessionId))
      return fail('unavailable')
    if (this.#runtime === undefined) return fail('runtime_not_ready')
    const requestId = mintRequestId(this.#newId())
    const admitted = this.#ledger.admit(target, command, requestId)
    // A concurrent repeat resolves to the original message; only a new row is delivered.
    if (admitted.ok && admitted.value === messageIdFor(requestId))
      this.#track(
        this.#lane(target.sessionId, () => this.#deliver(target, requestId)),
      )
    return admitted
  }

  /**
   * Manual resend with the original `requestId`. `rejected` goes back on the
   * wire; `unknown` is reconciled first and only resent if DSH has no trace.
   * Delivered or in-flight messages are left alone.
   */
  async resend(command: MessageCommand): Promise<WorkspaceResult<null>> {
    const found = this.#ledger.admission(command)
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
    if (this.#stopper.blocksDispatch(target.sessionId))
      return fail('unavailable')
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
    const found = this.#ledger.admission(command)
    if (!found.ok) return found
    const { target, row } = found.value
    // A still-local pending row is withdrawn before any Session lane runs,
    // so a held prompt cannot dispatch it first. Host-visible states stay
    // on the lane and are reconciled, never declared withdrawn locally.
    if (row.state === 'withdrawn') return OK
    if (row.state === 'pending')
      return this.#ledger.withdrawPending(target, row.requestId)
    return this.#lane(target.sessionId, () =>
      this.#withdrawInLane(target, row.requestId),
    )
  }

  /**
   * Decision 8B: stop this conversation's Session tree leaf first, the parent
   * Turn last. Queued messages stay queued. Until the next send, any Turn the
   * Session starts is stale and cancelled at once.
   */
  cancelTurn(command: BotCommand): Promise<WorkspaceResult<null>> {
    const resolved = this.#ledger.target(command.botId)
    if (!resolved.ok) return Promise.resolve(resolved)
    const runtime = this.#runtime
    if (runtime === undefined) return Promise.resolve(fail('runtime_not_ready'))
    const { sessionId, botId } = resolved.value
    return this.#stopper.stop(runtime, botId, sessionId)
  }

  /** One older history page of the followed conversation. */
  async loadEarlier(command: BotCommand): Promise<WorkspaceResult<null>> {
    const resolved = this.#ledger.target(command.botId)
    if (!resolved.ok) return resolved
    if (this.#runtime === undefined) return fail('runtime_not_ready')
    return this.#follower.loadEarlier(command.botId)
  }

  // -------------------------------------------------------------------------
  // Delivery
  // -------------------------------------------------------------------------

  /** Model alignment (11A), then the prompt with bounded same-generation retries. */
  async #deliver(target: ChatTarget, requestId: string): Promise<void> {
    const current = this.#ledger.read(target, requestId)
    // Withdrawn or already recorded: do not lift a stop, align a model, or prompt.
    if (
      current === null ||
      current.state === 'withdrawn' ||
      current.state === 'observed' ||
      current.state === 'accepted' ||
      current.state === 'sending' ||
      (current.state === 'rejected' && current.lastError === 'not_sent')
    )
      return
    if (this.#stopper.blocksDispatch(target.sessionId)) return
    const runtime = this.#runtime
    const generation = this.#generation
    if (runtime === undefined) {
      this.#ledger.settleUnsent(target, requestId, 'runtime_not_ready')
      return
    }
    // Only a confirmed stop is lifted, and only by this explicit send.
    if (!this.#stopper.continueIfConfirmed(target.sessionId)) return
    let probe: SessionProbe | null | undefined
    try {
      probe = parseSessionProbe(
        await runtime.sessions.projections(target.sessionId),
      )
    } catch {
      probe = undefined
    }
    if (probe === null) {
      this.#ledger.settleUnsent(target, requestId, 'binding_broken')
      return
    }
    const failure = await this.#align(target, probe?.modelSelection ?? null)
    if (failure !== undefined) {
      this.#ledger.settleUnsent(target, requestId, failure)
      return
    }
    if (generation !== this.#generation) {
      this.#ledger.settleUnsent(target, requestId, 'runtime_not_ready')
      return
    }
    for (let retry = 0; ; retry += 1) {
      if (this.#stopper.blocksDispatch(target.sessionId)) return
      const sending = this.#ledger.move(target, requestId, 'sending', {
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
        this.#ledger.move(target, requestId, 'accepted', { from: ['sending'] })
        return
      } catch (error) {
        const outcome = classifyPromptError(error)
        this.#ledger.move(target, requestId, outcome.kind, {
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
    target: ChatTarget,
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
    const row = this.#ledger.read(target, requestId)
    if (row?.state !== 'unknown') return false
    return this.#ledger.applyLocated(
      target,
      requestId,
      await this.#locate(runtime, target.sessionId, row),
    )
  }

  async #resendInLane(target: ChatTarget, requestId: string): Promise<void> {
    const runtime = this.#runtime
    const row = this.#ledger.read(target, requestId)
    if (runtime === undefined || row === null) return
    if (row.state === 'unknown') {
      const located = await this.#locate(runtime, target.sessionId, row)
      if (!this.#ledger.applyLocated(target, requestId, located)) return
    }
    if (row.state === 'rejected' || row.state === 'unknown')
      await this.#deliver(target, requestId)
  }

  async #withdrawInLane(
    target: ChatTarget,
    requestId: string,
  ): Promise<WorkspaceResult<null>> {
    const row = this.#ledger.read(target, requestId)
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
        return this.#withdraw(target, requestId, ['pending', 'rejected'])
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
    target: ChatTarget,
    row: MessageAdmissionRow,
  ): Promise<WorkspaceResult<null>> {
    const runtime = this.#runtime
    if (runtime === undefined) return fail('runtime_not_ready')
    const located = await this.#locate(runtime, target.sessionId, row)
    switch (located.kind) {
      case 'journal':
        this.#ledger.applyLocated(target, row.requestId, located)
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
            this.#ledger.applyLocated(
              target,
              row.requestId,
              await this.#locate(runtime, target.sessionId, row),
            )
            return fail('stale')
          }
          return fail('host_error')
        }
        return this.#withdraw(target, row.requestId, ['accepted', 'unknown'])
      case 'absent':
        if (row.state !== 'unknown') return fail('stale')
        return this.#withdraw(target, row.requestId, ['unknown'])
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

  #withdraw(
    target: ChatTarget,
    requestId: string,
    from: readonly AdmissionState[],
  ): WorkspaceResult<null> {
    return this.#ledger.move(target, requestId, 'withdrawn', { from }) === null
      ? fail('stale')
      : OK
  }

  /** Decision 11A through P1; a failure is the admission's closed code. */
  async #align(
    target: ChatTarget,
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

  /**
   * Plan §3.7 read-only recovery. `pending` never reached the wire and is
   * refused as `not_sent`; `sending`/`unknown` are looked up and stay
   * `unknown` (manual resend) when DSH has no trace. Nothing is resent here.
   */
  async #reconcileOpen(
    runtime: ChatRuntime,
    generation: number,
  ): Promise<void> {
    const db = this.#ledger.db()
    if (db === undefined) return
    const rows = this.#ledger.listOpen(db)
    if (rows === undefined) return
    const work: Promise<unknown>[] = []
    for (const row of rows) {
      const target = this.#ledger.bindingTarget(db, row)
      if (target === undefined) continue
      work.push(
        this.#lane(target.sessionId, async () => {
          if (generation !== this.#generation) return
          const current = this.#ledger.read(target, row.requestId)
          if (current === null) return
          if (current.state === 'pending') {
            this.#ledger.settleUnsent(target, row.requestId, 'not_sent')
            return
          }
          if (current.state !== 'sending' && current.state !== 'unknown') return
          const located = await this.#locate(runtime, target.sessionId, current)
          if (generation !== this.#generation) return
          this.#ledger.applyLocated(target, row.requestId, located)
          this.#ledger.move(target, row.requestId, 'unknown', {
            from: ['sending'],
            lastError: 'host_lost',
          })
        }),
      )
    }
    await Promise.allSettled(work)
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
}
