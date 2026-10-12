import type {
  ConversationState,
  ConversationView,
  DeliveryState,
  FeedItem,
} from '../../../../packages/contracts/src/workspace.ts'
import type { SessionPage } from '../../../../packages/dsh-adapter/src/session-client.ts'
import type {
  AssistantStreamFrame,
  FollowSnapshot,
  WireEvent,
} from '../../../../packages/dsh-adapter/src/session-wire.ts'
import {
  type ApprovalOverlay,
  type ApprovalRef,
  paragraphsOf,
  projectRecords,
  userRequestId,
} from './conversation-items.ts'
import { TransientReply } from './transient-reply.ts'

/**
 * `ConversationProjector`: the Main-side fold from one DSH Session follow
 * (opening snapshot, gap-free durable events, process-local assistant
 * frames) plus Corn's own admissions into the Bot's `ConversationView`
 * (P3 plan §3.7).
 *
 * Durable events are the only facts. A provisional reply is shown while it
 * streams and is replaced by its durable `assistant/message`; it never counts
 * as a reply on its own. Any break in continuity yields `rebaseline`, and the
 * caller reopens the follow so the next snapshot rebuilds the window.
 *
 * Synchronous and I/O free. It never logs: message text, Host text and Corn
 * client ids stay in memory.
 */

/** Why the follow must be reopened. Closed set; carries no Host text. */
export type RebaselineReason =
  /** A durable seq skipped ahead of `cursor + 1`. */
  | 'seq-gap'
  /** A surface `replace` (compaction): P3 rebuilds instead of patching. */
  | 'surface-replace'
  /** Assistant frames broke the attempt sequence. */
  | 'stream-continuity'
  /** The follow stream closed or failed. */
  | 'disconnected'

/** One update for the per-frame push: the whole Bot view, replaced per Bot. */
export interface ProjectionUpdate {
  /** Present when anything visible changed. */
  readonly view?: ConversationView
  /** Present when the caller must reopen the follow. */
  readonly rebaseline?: RebaselineReason
}

/**
 * A Corn-side send DSH has not been observed holding yet. Rendered after the
 * durable feed until a `user/message` echoing its `requestId` lands.
 */
export interface AdmissionView {
  /** Main-issued id `sendMessage` returned. */
  readonly messageId: string
  /** DSH `SessionRequestId`; matched against `user/message.source.rpcId`. */
  readonly requestId: string
  readonly text: string
  readonly delivery: DeliveryState
  /** User-facing reason when `delivery` is `failed`. */
  readonly failure?: string
}

export interface AdmissionObservation {
  readonly requestId: string
  /** Durable seq of the `user/message` that carried the request. */
  readonly seq: number
}

/** The cut and anchor of the next older history page. */
export interface EarlierPageRequest {
  readonly throughSeq: number
  readonly beforeSeq: number
}

export interface ConversationProjectorOptions {
  readonly botId: string
  readonly readOnly?: boolean
  /** Stable opaque feed ids; see `opaqueItemIds`. */
  readonly mintId: (key: string) => string
  /** Main-issued message id for a Corn request, so the bubble keeps its id. */
  readonly messageIdFor?: (requestId: string) => string | undefined
  /**
   * Called once per durable `user/message` that echoes a request id, each
   * time it enters the window (rebuilds repeat it). The receiver must be
   * idempotent: it marks the admission `observed` at `seq`.
   */
  readonly onAdmissionObserved?: (observation: AdmissionObservation) => void
  /** Live answerer state for approvals the journal has not decided yet. */
  readonly approvalOverlay?: (ref: ApprovalRef) => ApprovalOverlay | undefined
}

export interface ProjectorDiagnostics {
  readonly rebaselines: number
  readonly unknownEvents: number
  readonly unknownChunks: number
}

const NO_UPDATE: ProjectionUpdate = {}

const sameItems = (a: readonly FeedItem[], b: readonly FeedItem[]): boolean =>
  a.length === b.length && JSON.stringify(a) === JSON.stringify(b)

export class ConversationProjector {
  readonly #options: ConversationProjectorOptions
  readonly #reply = new TransientReply()
  #state: ConversationState = 'loading'
  /** One contiguous ascending run of durable events ending at `#cursor`. */
  #records: WireEvent[] = []
  /** Last durable seq applied; `undefined` before the first snapshot. */
  #cursor: number | undefined
  #hasEarlier = false
  #admissions: readonly AdmissionView[] = []
  readonly #observedRequests = new Set<string>()
  #durableItems: readonly FeedItem[] = []
  #unknownEvents = 0
  #rebaselines = 0
  /** The parts the current view was composed from, for cheap change checks. */
  #shown: {
    readonly durable: readonly FeedItem[]
    readonly tail: readonly FeedItem[]
  } = { durable: [], tail: [] }
  #view: ConversationView

  constructor(options: ConversationProjectorOptions) {
    this.#options = options
    this.#view = this.#compose([])
  }

  view(): ConversationView {
    return this.#view
  }

  get cursor(): number | undefined {
    return this.#cursor
  }

  diagnostics(): ProjectorDiagnostics {
    return {
      rebaselines: this.#rebaselines,
      unknownEvents: this.#unknownEvents,
      unknownChunks: this.#reply.unknownChunks,
    }
  }

  /**
   * Replaces the window with a follow's opening snapshot. Older pages already
   * loaded are kept only when they still join the new window without a gap.
   */
  snapshot(snapshot: FollowSnapshot): ProjectionUpdate {
    const first = snapshot.records[0]?.seq ?? snapshot.cursor + 1
    const keep =
      this.#cursor !== undefined &&
      (this.#records[0]?.seq ?? Number.POSITIVE_INFINITY) < first &&
      this.#cursor >= first - 1
    const older = keep ? this.#records.filter((event) => event.seq < first) : []
    this.#hasEarlier = keep ? this.#hasEarlier : snapshot.hasMore
    this.#records = [...older, ...snapshot.records]
    this.#cursor = snapshot.cursor
    this.#state = 'ready'
    this.#reply.reset(snapshot.assistantStream)
    this.#observe(this.#records)
    this.#reproject()
    return this.#emit()
  }

  /** Applies one durable event; duplicates and stale seqs are ignored. */
  event(event: WireEvent): ProjectionUpdate {
    const cursor = this.#cursor
    if (cursor === undefined || this.#state !== 'ready') return NO_UPDATE
    if (event.seq <= cursor) return NO_UPDATE
    if (event.seq !== cursor + 1) return this.rebaseline('seq-gap')
    if (typeof event.surfaceOp === 'object')
      return this.rebaseline('surface-replace')
    this.#records.push(event)
    this.#cursor = event.seq
    this.#reply.hold(event)
    this.#observe([event])
    this.#reproject()
    return this.#emit()
  }

  assistantStream(frame: AssistantStreamFrame): ProjectionUpdate {
    if (this.#cursor === undefined || this.#state !== 'ready') return NO_UPDATE
    const decision = this.#reply.frame(
      frame,
      (seq) => this.#cursor !== undefined && seq <= this.#cursor,
    )
    switch (decision.type) {
      case 'none':
        return NO_UPDATE
      case 'changed':
        return this.#emit()
      case 'settled':
        this.#reproject()
        return this.#emit()
      case 'rebaseline':
        return this.rebaseline('stream-continuity')
      default: {
        const unreachable: never = decision
        throw new Error(`Unknown reply decision ${String(unreachable)}`)
      }
    }
  }

  /**
   * Marks the conversation `reconnecting` until the next snapshot. History
   * stays; the provisional reply is dropped because a broken stream is not a
   * reply. Events and frames are ignored until the reopened snapshot.
   */
  rebaseline(reason: RebaselineReason): ProjectionUpdate {
    this.#rebaselines += 1
    this.#state = this.#cursor === undefined ? 'loading' : 'reconnecting'
    this.#reply.drop()
    this.#reproject()
    return { ...this.#emit(), rebaseline: reason }
  }

  /** The follow cannot be reopened (e.g. the Session is gone); history stays. */
  fail(): ProjectionUpdate {
    this.#state = 'error'
    this.#reply.drop()
    this.#reproject()
    return this.#emit()
  }

  /** Replaces the not-yet-observed sends shown after the durable feed. */
  setAdmissions(admissions: readonly AdmissionView[]): ProjectionUpdate {
    this.#admissions = admissions
    return this.#emit()
  }

  /** Recomputes after live approval state changed outside the journal. */
  refresh(): ProjectionUpdate {
    this.#reproject()
    return this.#emit()
  }

  /** The next `session/page` to request, or `null` when none is due. */
  earlierPage(): EarlierPageRequest | null {
    const cursor = this.#cursor
    if (cursor === undefined || !this.#hasEarlier) return null
    return {
      throughSeq: cursor,
      beforeSeq: this.#records[0]?.seq ?? cursor + 1,
    }
  }

  /**
   * Prepends one older page. A page for an anchor that is no longer current
   * (a rebuild ran meanwhile) or that does not join the window is dropped.
   */
  applyEarlier(
    request: EarlierPageRequest,
    page: SessionPage,
  ): ProjectionUpdate {
    const anchor = this.earlierPage()
    if (anchor === null || anchor.beforeSeq !== request.beforeSeq)
      return NO_UPDATE
    const last = page.records.at(-1)
    if (last !== undefined && last.seq !== anchor.beforeSeq - 1)
      return NO_UPDATE
    this.#records = [...page.records, ...this.#records]
    this.#hasEarlier = page.records.length > 0 && page.hasMore
    this.#observe(page.records)
    this.#reproject()
    return this.#emit()
  }

  #observe(events: readonly WireEvent[]): void {
    for (const event of events) {
      const requestId = userRequestId(event)
      if (requestId === undefined) continue
      this.#observedRequests.add(requestId)
      this.#options.onAdmissionObserved?.({ requestId, seq: event.seq })
    }
  }

  #reproject(): void {
    const projected = projectRecords(this.#records, {
      mintId: this.#options.mintId,
      messageIdFor: (requestId) => this.#options.messageIdFor?.(requestId),
      approvalOverlay: (ref) => this.#options.approvalOverlay?.(ref),
      held: (seq) => this.#reply.isHeld(seq),
    })
    this.#unknownEvents = projected.unknownEvents
    if (!sameItems(projected.items, this.#durableItems))
      this.#durableItems = projected.items
  }

  /** Provisional reply and pending sends, after the durable feed. */
  #tail(): readonly FeedItem[] {
    const items: FeedItem[] = []
    const attemptId = this.#reply.attemptId
    if (attemptId !== undefined)
      items.push({
        kind: 'message',
        id: this.#options.mintId(`attempt:${attemptId}`),
        author: 'bot',
        paragraphs: paragraphsOf(this.#reply.text()),
        streaming: true,
      })
    for (const admission of this.#admissions) {
      if (this.#observedRequests.has(admission.requestId)) continue
      items.push({
        kind: 'message',
        id: admission.messageId,
        author: 'user',
        paragraphs: paragraphsOf(admission.text),
        delivery: admission.delivery,
        ...(admission.delivery === 'failed' && admission.failure !== undefined
          ? { failure: admission.failure }
          : {}),
      })
    }
    return items
  }

  #compose(tail: readonly FeedItem[]): ConversationView {
    this.#shown = { durable: this.#durableItems, tail }
    return {
      botId: this.#options.botId,
      state: this.#state,
      readOnly: this.#options.readOnly ?? false,
      items: [...this.#durableItems, ...tail],
      hasEarlier: this.#hasEarlier,
    }
  }

  #emit(): ProjectionUpdate {
    const tail = this.#tail()
    if (
      this.#state === this.#view.state &&
      this.#hasEarlier === this.#view.hasEarlier &&
      this.#durableItems === this.#shown.durable &&
      sameItems(tail, this.#shown.tail)
    )
      return NO_UPDATE
    this.#view = this.#compose(tail)
    return { view: this.#view }
  }
}
