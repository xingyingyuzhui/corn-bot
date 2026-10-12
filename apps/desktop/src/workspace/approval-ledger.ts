import {
  isPlainRecord,
  type WireEvent,
} from '../../../../packages/dsh-adapter/src/session-wire.ts'

/**
 * Durable approval facts of one DSH Session, folded from its journal
 * (`user-approval/src/types.ts` at dsh-v0.2.0-rc.2):
 * `approval/asked {id, toolName, callId?, reason?}` and
 * `approval/decided {id, outcome}`, enclosed by `turn/start`/`turn/end`.
 * The durable `id` shares nothing with the Gateway `eventId`; a live request
 * is correlated to its ask by `callId`, or by order within the open turn.
 */

export type DurableOutcome =
  | 'allowed-once'
  | 'rejected'
  | 'cancelled'
  | 'unavailable'

const OUTCOMES: ReadonlySet<string> = new Set<DurableOutcome>([
  'allowed-once',
  'rejected',
  'cancelled',
  'unavailable',
])

export interface AskedEntry {
  readonly askedId: string
  readonly callId: string | undefined
  /** Ledger turn epoch the ask was observed in. */
  readonly epoch: number
  outcome: DurableOutcome | undefined
  /** Gateway `eventId` of the live request correlated to this ask. */
  claimedBy: string | undefined
}

export type LedgerFact =
  | { readonly kind: 'turn-ended' }
  | { readonly kind: 'decided'; readonly entry: AskedEntry }

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

export class ApprovalLedger {
  #lastSeq = -1
  /** Count of turns seen closing; an ask's epoch ends when this passes it. */
  #epoch = 0
  #open = false
  #asked: AskedEntry[] = []
  #byId = new Map<string, AskedEntry>()

  /**
   * Folds events in seq order; already-seen seqs are skipped, so snapshot
   * windows and live events can overlap freely.
   */
  observe(events: readonly WireEvent[]): readonly LedgerFact[] {
    const facts: LedgerFact[] = []
    for (const event of events) {
      if (event.seq <= this.#lastSeq) continue
      this.#lastSeq = event.seq
      const fact = this.#fold(event)
      if (fact !== undefined) facts.push(fact)
    }
    return facts
  }

  /** Whether the turn holding an ask of `epoch` has closed. */
  hasEnded(epoch: number): boolean {
    return epoch < this.#epoch
  }

  /**
   * The earliest unclaimed ask of the open turn with the same `callId` (both
   * absent counts as equal). Asks of closed turns never match, so replayed
   * history cannot capture a live request; an ask already decided can, since
   * the journal may outrun `$events`.
   */
  claim(eventId: string, callId: string | undefined): AskedEntry | undefined {
    if (!this.#open) return undefined
    const entry = this.#asked.find(
      (candidate) =>
        candidate.claimedBy === undefined &&
        candidate.epoch === this.#epoch &&
        candidate.callId === callId,
    )
    if (entry !== undefined) entry.claimedBy = eventId
    return entry
  }

  #fold(event: WireEvent): LedgerFact | undefined {
    const data = isPlainRecord(event.data) ? event.data : undefined
    switch (event.type) {
      case 'turn/start': {
        const ended = this.#open
        if (ended) this.#epoch++
        this.#open = true
        this.#prune()
        return ended ? { kind: 'turn-ended' } : undefined
      }
      case 'turn/end':
        if (!this.#open) return undefined
        this.#epoch++
        this.#open = false
        return { kind: 'turn-ended' }
      case 'approval/asked': {
        if (data === undefined || !isId(data.id) || this.#byId.has(data.id))
          return undefined
        // An ask is always turn-enclosed, even when the window began mid-turn.
        this.#open = true
        const entry: AskedEntry = {
          askedId: data.id,
          callId: isId(data.callId) ? data.callId : undefined,
          epoch: this.#epoch,
          outcome: undefined,
          claimedBy: undefined,
        }
        this.#asked.push(entry)
        this.#byId.set(entry.askedId, entry)
        return undefined
      }
      case 'approval/decided': {
        if (data === undefined || !isId(data.id)) return undefined
        const entry = this.#byId.get(data.id)
        if (
          entry === undefined ||
          entry.outcome !== undefined ||
          typeof data.outcome !== 'string' ||
          !OUTCOMES.has(data.outcome)
        )
          return undefined
        entry.outcome = data.outcome as DurableOutcome
        return { kind: 'decided', entry }
      }
      default:
        return undefined
    }
  }

  /** Keeps asks of the current and the last closed turn only. */
  #prune(): void {
    this.#asked = this.#asked.filter((entry) => entry.epoch >= this.#epoch - 1)
    this.#byId = new Map(this.#asked.map((entry) => [entry.askedId, entry]))
  }
}
