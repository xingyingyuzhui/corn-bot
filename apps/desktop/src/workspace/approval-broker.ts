import { randomUUID } from 'node:crypto'
import type {
  ApprovalAnswer,
  ApprovalStatus,
  FeedItem,
  WorkspaceErrorCode,
  WorkspaceResult,
} from '../../../../packages/contracts/src/workspace.ts'
import type {
  ApprovalEventHandlers,
  ApprovalRequestView,
  UnsupportedWaterfall,
} from '../../../../packages/dsh-adapter/src/approval-events.ts'
import { RemoteError } from '../../../../packages/dsh-adapter/src/remote-error.ts'
import type { WireEvent } from '../../../../packages/dsh-adapter/src/session-wire.ts'
import {
  ApprovalLedger,
  type AskedEntry,
  type DurableOutcome,
} from './approval-ledger.ts'

/** Decision 9B: Corn answers `rejected` once a request has waited this long. */
export const APPROVAL_TIMEOUT_MS = 30 * 60_000
/** After a new `ready`, how long a lost request may take to be redelivered. */
export const REDELIVERY_GRACE_MS = 5_000
export const RECONNECT_DELAY_MS = 1_000

/** One `$events` generation; `ApprovalEvents` satisfies it structurally. */
export interface ApprovalChannel {
  readonly generation: number
  answer(eventId: string, value: ApprovalAnswer): Promise<void>
  delegate(eventId: string): Promise<void>
  close(): void
}

export type ApprovalNotice = 'approval-timed-out' | 'question-unsupported'

export type ApprovalBrokerChange =
  | { readonly kind: 'approvals'; readonly sessionId: string }
  | {
      readonly kind: 'notice'
      readonly sessionId: string
      readonly notice: ApprovalNotice
    }

export interface ApprovalBrokerOptions {
  /**
   * Opens one `$events` generation, e.g.
   * `(handlers) => ApprovalEvents.open(mux, transport, handlers)`. May throw
   * while the Host is not connected; the broker retries.
   */
  readonly openEvents: (handlers: ApprovalEventHandlers) => ApprovalChannel
  /** The Bot of a `ready` foreground binding for this Session in the current home. */
  readonly botForSession: (sessionId: string) => string | undefined
  readonly onChange: (change: ApprovalBrokerChange) => void
  readonly timeoutMs?: number
  readonly redeliveryGraceMs?: number
  readonly reconnectDelayMs?: number
}

/** Main-side view of one live approval request. */
export interface ApprovalCard {
  /** Stable for the request's lifetime, across generations. */
  readonly id: string
  /** Opaque; valid only for the current generation while `status` is `pending`. */
  readonly handle: string
  readonly botId: string
  readonly toolName: string
  /** Display only, never logged. */
  readonly reason?: string
  readonly displayReason?: { readonly en: string; readonly zh?: string }
  readonly status: ApprovalStatus
  /** Corn's own timeout answered this request. */
  readonly timedOut: boolean
  /** Main-only correlation with the durable `approval/asked`; never crosses IPC. */
  readonly askedId?: string
  readonly callId?: string
}

/**
 * - `open`: answerable on the current generation.
 * - `submitting`: Corn put (or is putting) `answer` on the wire; only the
 *   durable `approval/decided` settles it.
 * - `detached`: its generation was lost; waits for redelivery.
 * - `closed`: no longer answerable (withdrawn, stopped, turn ended, not
 *   redelivered, stale reply, Host ended).
 * - `decided`: the durable outcome arrived.
 */
type Phase = 'open' | 'submitting' | 'detached' | 'closed' | 'decided'

interface ApprovalRecord {
  readonly eventId: string
  readonly cardId: string
  readonly sessionId: string
  readonly botId: string
  readonly request: ApprovalRequestView
  generation: number
  handle: string
  phase: Phase
  /** What Corn put on the wire; kept across a redelivery, cleared once known not to count. */
  answer: ApprovalAnswer | undefined
  /** Increments per send so a late settlement cannot touch a newer send. */
  attempt: number
  inFlight: boolean
  /** The last send failed without telling whether it reached the Host. */
  uncertain: boolean
  resent: boolean
  timedOut: boolean
  /** The timeout fired while detached; the redelivery is rejected. */
  timeoutDue: boolean
  entry: AskedEntry | undefined
  outcome: DurableOutcome | undefined
  timer: ReturnType<typeof setTimeout> | undefined
}

type SendResult = 'sent' | 'lost' | 'stale' | 'unknown'

const ok: WorkspaceResult<null> = { ok: true, value: null }
const fail = (code: WorkspaceErrorCode): WorkspaceResult<null> => ({
  ok: false,
  error: { code },
})

/**
 * Binds DSH approval requests to Corn's foreground Sessions (P3 plan §3.8).
 * The Renderer only ever holds an opaque handle; an answer is put on the wire
 * only for an open request of the current `$events` generation, and the card
 * settles only from the durable `approval/decided`. Gateway `cancel` frames
 * follow every settlement as well as withdrawals, so they only close a
 * request; an RPC success means nothing until the journal agrees.
 */
export class ApprovalBroker {
  readonly #openEvents: ApprovalBrokerOptions['openEvents']
  readonly #botForSession: ApprovalBrokerOptions['botForSession']
  readonly #onChange: ApprovalBrokerOptions['onChange']
  readonly #timeoutMs: number
  readonly #graceMs: number
  readonly #reconnectMs: number

  #active = false
  #token: object | undefined
  #channel: ApprovalChannel | undefined
  #generation: number | undefined
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined
  #graceTimer: ReturnType<typeof setTimeout> | undefined

  readonly #records = new Map<string, ApprovalRecord>()
  readonly #handles = new Map<string, ApprovalRecord>()
  /** Handles of pruned records, kept so they stay `stale` rather than unknown. */
  readonly #retired = new Map<string, string>()
  readonly #ledgers = new Map<string, ApprovalLedger>()
  readonly #stopped = new Set<string>()

  constructor(options: ApprovalBrokerOptions) {
    this.#openEvents = options.openEvents
    this.#botForSession = options.botForSession
    this.#onChange = options.onChange
    this.#timeoutMs = options.timeoutMs ?? APPROVAL_TIMEOUT_MS
    this.#graceMs = options.redeliveryGraceMs ?? REDELIVERY_GRACE_MS
    this.#reconnectMs = options.reconnectDelayMs ?? RECONNECT_DELAY_MS
  }

  /** Opens `$events` for the current Host generation and keeps it open. */
  connect(): void {
    this.#active = true
    if (this.#token !== undefined) return
    clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = undefined
    this.#open()
  }

  /**
   * The Host generation ended: every unsettled request is closed for good,
   * since a Host restart interrupts its turns.
   */
  disconnect(): void {
    this.#active = false
    clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = undefined
    this.#dropChannel()
    const touched = new Set<string>()
    for (const record of this.#records.values()) {
      if (record.phase === 'decided' || record.phase === 'closed') continue
      record.answer = undefined
      this.#close(record)
      touched.add(record.sessionId)
    }
    this.#emitApprovals(touched)
  }

  /** Answers one request by its handle; never free text, never another Bot's. */
  async answer(
    botId: string,
    handle: string,
    value: ApprovalAnswer,
  ): Promise<WorkspaceResult<null>> {
    if (value !== 'allowed-once' && value !== 'rejected')
      return fail('validation')
    const record = this.#handles.get(handle)
    if (record === undefined || record.botId !== botId)
      return fail(this.#retired.get(handle) === botId ? 'stale' : 'not_found')
    if (
      record.handle !== handle ||
      record.generation !== this.#generation ||
      record.phase === 'detached'
    )
      return fail('stale')
    switch (record.phase) {
      case 'decided':
        return record.outcome === value ? ok : fail('stale')
      case 'closed':
        return fail('stale')
      case 'submitting':
        if (record.answer !== value) return fail('stale')
        if (record.inFlight || !record.uncertain) return ok
        return this.#reply(await this.#send(record, value))
      case 'open':
        if (this.#turnEnded(record)) {
          this.#close(record)
          this.#emitApprovals([record.sessionId])
          return fail('stale')
        }
        record.phase = 'submitting'
        record.answer = value
        this.#emitApprovals([record.sessionId])
        return this.#reply(await this.#send(record, value))
      default:
        return assertNever(record.phase)
    }
  }

  /**
   * Feeds durable Session events in seq order: a follow snapshot's records or
   * one live event. Overlaps are skipped.
   */
  observe(sessionId: string, events: readonly WireEvent[]): void {
    let ledger = this.#ledgers.get(sessionId)
    if (ledger === undefined) {
      ledger = new ApprovalLedger()
      this.#ledgers.set(sessionId, ledger)
    }
    let changed = false
    for (const fact of ledger.observe(events)) {
      switch (fact.kind) {
        case 'decided': {
          const claimant = fact.entry.claimedBy
          const record =
            claimant === undefined ? undefined : this.#records.get(claimant)
          if (record !== undefined) {
            this.#decide(record, fact.entry.outcome)
            changed = true
          }
          break
        }
        case 'turn-ended':
          this.#stopped.delete(sessionId)
          changed = this.#endTurn(sessionId, ledger) || changed
          break
        default:
          assertNever(fact)
      }
    }
    changed = this.#link(sessionId) || changed
    if (changed) this.#emitApprovals([sessionId])
  }

  /**
   * Decision 8B: the foreground turn is being stopped. Its requests are
   * never answered from now on, and requests that arrive before the turn is
   * seen ending (or {@link resumeSession}) are closed on arrival.
   */
  stopTurn(sessionId: string): void {
    this.#stopped.add(sessionId)
    let changed = false
    for (const record of this.#sessionRecords(sessionId)) {
      if (record.phase === 'decided' || record.phase === 'closed') continue
      this.#close(record)
      changed = true
    }
    if (changed) this.#emitApprovals([sessionId])
  }

  /** Lifts the stop fence, e.g. before the next prompt of this Session. */
  resumeSession(sessionId: string): void {
    this.#stopped.delete(sessionId)
  }

  /** Drops every trace of a Session, e.g. when its binding is retired. */
  forgetSession(sessionId: string): void {
    for (const record of this.#sessionRecords(sessionId)) this.#prune(record)
    this.#ledgers.delete(sessionId)
    this.#stopped.delete(sessionId)
  }

  cards(sessionId: string): readonly ApprovalCard[] {
    return this.#sessionRecords(sessionId).map(cardOf)
  }

  #open(): void {
    const token = {}
    this.#token = token
    const live = () => this.#token === token
    const handlers: ApprovalEventHandlers = {
      onReady: (generation) => {
        if (live()) this.#onReady(generation)
      },
      onApproval: (request, generation) => {
        if (live() && generation === this.#generation)
          this.#onApproval(request, generation)
      },
      onUnsupported: (waterfall, generation) => {
        if (live() && generation === this.#generation)
          this.#onUnsupported(waterfall)
      },
      onCancel: (eventId, generation) => {
        if (live()) this.#onCancel(eventId, generation)
      },
      onError: () => {
        if (live()) this.#onLost()
      },
    }
    try {
      const channel = this.#openEvents(handlers)
      if (live()) this.#channel = channel
      else channel.close()
    } catch {
      if (live()) this.#onLost()
    }
  }

  #onReady(generation: number): void {
    this.#generation = generation
    clearTimeout(this.#graceTimer)
    this.#graceTimer = setTimeout(() => {
      this.#graceTimer = undefined
      const touched = new Set<string>()
      for (const record of this.#records.values()) {
        if (record.phase !== 'detached') continue
        this.#close(record)
        touched.add(record.sessionId)
      }
      this.#emitApprovals(touched)
    }, this.#graceMs)
  }

  #onApproval(request: ApprovalRequestView, generation: number): void {
    const existing = this.#records.get(request.eventId)
    if (existing !== undefined) {
      this.#redeliver(existing, generation)
      return
    }
    const botId = this.#botForSession(request.sessionId)
    if (botId === undefined) {
      this.#delegate(request.eventId)
      return
    }
    const record: ApprovalRecord = {
      eventId: request.eventId,
      cardId: `approval-${randomUUID()}`,
      sessionId: request.sessionId,
      botId,
      request,
      generation,
      handle: '',
      phase: this.#stopped.has(request.sessionId) ? 'closed' : 'open',
      answer: undefined,
      attempt: 0,
      inFlight: false,
      uncertain: false,
      resent: false,
      timedOut: false,
      timeoutDue: false,
      entry: undefined,
      outcome: undefined,
      timer: undefined,
    }
    this.#records.set(record.eventId, record)
    this.#mintHandle(record)
    if (record.phase === 'open')
      record.timer = setTimeout(() => this.#onTimeout(record), this.#timeoutMs)
    this.#link(record.sessionId)
    this.#emitApprovals([record.sessionId])
  }

  /** The Gateway redelivers a still-pending request under the same `eventId`. */
  #redeliver(record: ApprovalRecord, generation: number): void {
    if (record.phase !== 'detached') return
    record.generation = generation
    this.#mintHandle(record)
    if (record.timeoutDue) {
      this.#timeOut(record)
    } else if (record.answer !== undefined && !record.resent) {
      record.resent = true
      record.phase = 'submitting'
      void this.#send(record, record.answer)
    } else {
      record.answer = undefined
      record.phase = 'open'
    }
    this.#emitApprovals([record.sessionId])
  }

  #onUnsupported(waterfall: UnsupportedWaterfall): void {
    this.#delegate(waterfall.eventId)
    if (
      waterfall.event === 'user-questions/request' &&
      this.#botForSession(waterfall.sessionId) !== undefined
    )
      this.#emit({
        kind: 'notice',
        sessionId: waterfall.sessionId,
        notice: 'question-unsupported',
      })
  }

  /** Not a withdrawal by itself: the Gateway also sends it after any settlement. */
  #onCancel(eventId: string, generation: number): void {
    const record = this.#records.get(eventId)
    if (
      record === undefined ||
      record.generation !== generation ||
      record.phase !== 'open'
    )
      return
    this.#close(record)
    this.#emitApprovals([record.sessionId])
  }

  #onLost(): void {
    this.#dropChannel()
    const touched = new Set<string>()
    for (const record of this.#records.values()) {
      if (record.phase !== 'open' && record.phase !== 'submitting') continue
      record.phase = 'detached'
      touched.add(record.sessionId)
    }
    this.#emitApprovals(touched)
    if (!this.#active) return
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined
      if (this.#active && this.#token === undefined) this.#open()
    }, this.#reconnectMs)
  }

  #dropChannel(): void {
    const channel = this.#channel
    this.#token = undefined
    this.#channel = undefined
    this.#generation = undefined
    clearTimeout(this.#graceTimer)
    this.#graceTimer = undefined
    channel?.close()
  }

  #onTimeout(record: ApprovalRecord): void {
    record.timer = undefined
    switch (record.phase) {
      case 'submitting':
        // An answer the Host took, or one still in flight, is left to the journal.
        if (!record.uncertain) return
        this.#timeOut(record)
        this.#emitApprovals([record.sessionId])
        return
      case 'open':
        this.#timeOut(record)
        this.#emitApprovals([record.sessionId])
        return
      case 'detached':
        record.timeoutDue = true
        return
      case 'closed':
      case 'decided':
        return
      default:
        assertNever(record.phase)
    }
  }

  /** The single timeout reply; the durable decision still settles the card. */
  #timeOut(record: ApprovalRecord): void {
    record.timeoutDue = false
    record.timedOut = true
    record.phase = 'submitting'
    record.answer = 'rejected'
    this.#emit({
      kind: 'notice',
      sessionId: record.sessionId,
      notice: 'approval-timed-out',
    })
    void this.#send(record, 'rejected')
  }

  async #send(
    record: ApprovalRecord,
    value: ApprovalAnswer,
  ): Promise<SendResult> {
    const channel = this.#channel
    const generation = record.generation
    if (channel === undefined || generation !== this.#generation) return 'lost'
    const attempt = ++record.attempt
    const current = () =>
      record.attempt === attempt &&
      record.generation === generation &&
      record.phase === 'submitting'
    record.inFlight = true
    record.uncertain = false
    try {
      await channel.answer(record.eventId, value)
      return 'sent'
    } catch (error) {
      if (!current()) return 'lost'
      const code = error instanceof RemoteError ? error.code : undefined
      if (code === 'corn/events-unavailable') return 'lost'
      if (code === 'corn/event-stale') {
        // This generation can no longer deliver it; the answer never counted.
        record.answer = undefined
        this.#close(record)
        this.#emitApprovals([record.sessionId])
        return 'stale'
      }
      record.uncertain = true
      return 'unknown'
    } finally {
      if (record.attempt === attempt) record.inFlight = false
    }
  }

  #reply(result: SendResult): WorkspaceResult<null> {
    switch (result) {
      case 'sent':
      case 'lost':
        return ok
      case 'stale':
        return fail('stale')
      case 'unknown':
        return fail('host_error')
      default:
        return assertNever(result)
    }
  }

  #delegate(eventId: string): void {
    this.#channel?.delegate(eventId).catch(() => {
      // The Gateway fails the request closed once this generation is gone.
    })
  }

  /** Correlates unlinked live requests with asks of the open turn. */
  #link(sessionId: string): boolean {
    const ledger = this.#ledgers.get(sessionId)
    if (ledger === undefined) return false
    let changed = false
    for (const record of this.#sessionRecords(sessionId)) {
      if (record.entry !== undefined) continue
      const entry = ledger.claim(record.eventId, record.request.callId)
      if (entry === undefined) continue
      record.entry = entry
      changed = true
      if (entry.outcome !== undefined) this.#decide(record, entry.outcome)
    }
    return changed
  }

  /**
   * Prunes the requests of turns now seen ending; the journal's asked/decided
   * pair carries their history from here, and their handles turn `stale`.
   */
  #endTurn(sessionId: string, ledger: ApprovalLedger): boolean {
    let changed = false
    for (const record of this.#sessionRecords(sessionId)) {
      if (record.entry === undefined || !ledger.hasEnded(record.entry.epoch))
        continue
      this.#prune(record)
      changed = true
    }
    return changed
  }

  #turnEnded(record: ApprovalRecord): boolean {
    const entry = record.entry
    return (
      entry !== undefined &&
      (this.#ledgers.get(record.sessionId)?.hasEnded(entry.epoch) ?? false)
    )
  }

  #decide(record: ApprovalRecord, outcome: DurableOutcome | undefined): void {
    if (outcome === undefined) return
    record.outcome = outcome
    record.phase = 'decided'
    clearTimeout(record.timer)
    record.timer = undefined
  }

  #close(record: ApprovalRecord): void {
    record.phase = 'closed'
    clearTimeout(record.timer)
    record.timer = undefined
  }

  #mintHandle(record: ApprovalRecord): void {
    record.handle = `aph_${randomUUID()}`
    this.#handles.set(record.handle, record)
  }

  #prune(record: ApprovalRecord): void {
    clearTimeout(record.timer)
    record.timer = undefined
    this.#records.delete(record.eventId)
    for (const [handle, owner] of this.#handles) {
      if (owner !== record) continue
      this.#handles.delete(handle)
      this.#retired.set(handle, record.botId)
    }
  }

  #sessionRecords(sessionId: string): ApprovalRecord[] {
    return [...this.#records.values()].filter(
      (record) => record.sessionId === sessionId,
    )
  }

  #emitApprovals(sessionIds: Iterable<string>): void {
    for (const sessionId of new Set(sessionIds))
      this.#emit({ kind: 'approvals', sessionId })
  }

  #emit(change: ApprovalBrokerChange): void {
    try {
      this.#onChange(change)
    } catch {
      // A failing listener must not break the `$events` callbacks.
    }
  }
}

function statusOf(record: ApprovalRecord): ApprovalStatus {
  switch (record.phase) {
    case 'open':
      return 'pending'
    case 'submitting':
      return 'submitting'
    case 'detached':
      return record.answer === undefined ? 'pending' : 'submitting'
    case 'closed':
      return record.answer === undefined ? 'cancelled' : 'submitting'
    case 'decided':
      // `unavailable` is DSH failing closed with no answer: not answered.
      return record.outcome === 'allowed-once' || record.outcome === 'rejected'
        ? record.outcome
        : 'cancelled'
    default:
      return assertNever(record.phase)
  }
}

function cardOf(record: ApprovalRecord): ApprovalCard {
  const { request } = record
  return {
    id: record.cardId,
    handle: record.handle,
    botId: record.botId,
    toolName: request.toolName,
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    ...(request.displayReason === undefined
      ? {}
      : { displayReason: request.displayReason }),
    status: statusOf(record),
    timedOut: record.timedOut,
    ...(record.entry === undefined ? {} : { askedId: record.entry.askedId }),
    ...(request.callId === undefined ? {} : { callId: request.callId }),
  }
}

/** The Renderer-safe feed item of a card: no DSH ids, display text only. */
export function approvalFeedItem(
  card: ApprovalCard,
): Extract<FeedItem, { kind: 'approval' }> {
  return {
    kind: 'approval',
    id: card.id,
    handle: card.handle,
    title: card.toolName,
    detail:
      card.displayReason?.zh ?? card.displayReason?.en ?? card.reason ?? '',
    status: card.status,
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled approval state ${String(value)}`)
}
