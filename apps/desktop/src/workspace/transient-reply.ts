import {
  type AssistantChunkView,
  type AssistantStreamBaseline,
  type AssistantStreamFrame,
  classifyStreamChunk,
  classifyStreamRecord,
  isPlainRecord,
  type WireEvent,
} from '../../../../packages/dsh-adapter/src/session-wire.ts'

/**
 * The provisional reply bubble: one live assistant attempt folded to text,
 * joined to its durable settlement. The continuity rules follow the official
 * client fold (`session-controller/src/client/sessions/assistant-stream.ts`
 * at dsh-v0.2.0-rc.2): a durable settlement for the live attempt is held
 * until the attempt's `end` names it, and any break in the frame sequence
 * asks for a rebaseline rather than guessing.
 */

/** What a frame or durable event did to the provisional reply. */
export type ReplyDecision =
  | { readonly type: 'none' }
  /** The provisional text appeared, grew or was dropped. */
  | { readonly type: 'changed' }
  /** The held settlement `seq` is now visible; the provisional text is gone. */
  | { readonly type: 'settled'; readonly seq: number }
  | { readonly type: 'rebaseline' }

/** Chunk kinds the live protocol defines but P3 does not render (`StreamChunk`). */
const QUIET_CHUNK_TYPES: ReadonlySet<string> = new Set([
  'block-start',
  'block-end',
  'tool-call-delta',
  'tool-call-chunks',
  'usage',
  'finish',
])

interface Attempt {
  readonly attemptId: string
  readonly startedAfterSeq: number
  readonly turn: number
  readonly step: number
  nextIndex: number
  /** Visible text per content block index, in first-seen order. */
  readonly blocks: Map<number, string>
}

type SettlementType = 'assistant/message' | 'assistant/attempt'

const NONE: ReplyDecision = { type: 'none' }
const CHANGED: ReplyDecision = { type: 'changed' }
const REBASELINE: ReplyDecision = { type: 'rebaseline' }

export class TransientReply {
  #attempt: Attempt | undefined
  readonly #held = new Map<number, SettlementType>()
  #unknownChunks = 0

  /** Chunks of a kind this build does not know; counted, never kept. */
  get unknownChunks(): number {
    return this.#unknownChunks
  }

  /** Attempt key for the bubble id while text is visible. */
  get attemptId(): string | undefined {
    return this.text().length > 0 ? this.#attempt?.attemptId : undefined
  }

  isHeld(seq: number): boolean {
    return this.#held.has(seq)
  }

  /** Visible provisional text; empty while only reasoning or tools streamed. */
  text(): string {
    const attempt = this.#attempt
    if (attempt === undefined) return ''
    return [...attempt.blocks.values()]
      .filter((text) => text.length > 0)
      .join('\n\n')
  }

  /** Forgets everything; a dropped stream never counts as a reply. */
  drop(): void {
    this.#attempt = undefined
    this.#held.clear()
  }

  /** Adopts the opening snapshot's still-live attempt from its compact records. */
  reset(baseline: AssistantStreamBaseline | undefined): void {
    this.drop()
    const opening = baseline?.activeAttempt
    if (opening === undefined) return
    const attempt: Attempt = {
      attemptId: opening.attemptId,
      startedAfterSeq: opening.startedAfterSeq,
      turn: opening.turn,
      step: opening.step,
      nextIndex: opening.nextIndex,
      blocks: new Map(),
    }
    for (const record of opening.stream)
      this.#fold(attempt, classifyStreamRecord(record))
    this.#attempt = attempt
  }

  /**
   * Called for each newly applied durable event. Returns `true` when the
   * event is the live attempt's settlement and must stay hidden until `end`.
   */
  hold(event: WireEvent): boolean {
    const attempt = this.#attempt
    if (attempt === undefined) return false
    const data = isPlainRecord(event.data) ? event.data : {}
    if (event.type === 'turn/end' && data.turn === attempt.turn) {
      // The turn closed without an `end` frame: nothing provisional survives it.
      if (this.#held.size === 0) this.#attempt = undefined
      return false
    }
    if (
      (event.type !== 'assistant/message' &&
        event.type !== 'assistant/attempt') ||
      (event.type === 'assistant/message' && event.surfaceOp !== 'append') ||
      event.seq <= attempt.startedAfterSeq ||
      data.turn !== attempt.turn ||
      data.step !== attempt.step
    )
      return false
    this.#held.set(event.seq, event.type)
    return true
  }

  /**
   * Folds one live frame. `published` tells whether a durable seq is already
   * visible, for a settlement that arrived before its attempt was known.
   */
  frame(
    frame: AssistantStreamFrame,
    published: (seq: number) => boolean,
  ): ReplyDecision {
    switch (frame.type) {
      case 'start':
        if (this.#attempt !== undefined || this.#held.size > 0)
          return REBASELINE
        this.#attempt = {
          attemptId: frame.attemptId,
          startedAfterSeq: frame.startedAfterSeq,
          turn: frame.turn,
          step: frame.step,
          nextIndex: 0,
          blocks: new Map(),
        }
        return NONE
      case 'chunk': {
        const attempt = this.#attempt
        // Opened after this attempt began: its settlement publishes directly.
        if (attempt === undefined || attempt.attemptId !== frame.attemptId)
          return NONE
        if (frame.index !== attempt.nextIndex) return REBASELINE
        attempt.nextIndex += 1
        return this.#fold(attempt, classifyStreamChunk(frame.chunk))
          ? CHANGED
          : NONE
      }
      case 'end': {
        const attempt = this.#attempt
        if (attempt === undefined || attempt.attemptId !== frame.attemptId)
          return NONE
        this.#attempt = undefined
        if (frame.index !== attempt.nextIndex) return REBASELINE
        const { outcome } = frame
        if (outcome.kind === 'abandoned')
          return this.#held.size === 0 ? CHANGED : REBASELINE
        const held = this.#held.get(outcome.seq)
        if (held === undefined)
          return published(outcome.seq) ? CHANGED : REBASELINE
        if (held !== outcome.eventType) return REBASELINE
        this.#held.delete(outcome.seq)
        return { type: 'settled', seq: outcome.seq }
      }
      default: {
        const unreachable: never = frame
        throw new Error(`Unknown stream frame ${String(unreachable)}`)
      }
    }
  }

  /** Returns `true` when visible text changed. */
  #fold(attempt: Attempt, view: AssistantChunkView): boolean {
    switch (view.kind) {
      case 'text':
        if (view.text.length === 0) return false
        attempt.blocks.set(
          view.index,
          (attempt.blocks.get(view.index) ?? '') + view.text,
        )
        return true
      case 'reasoning':
        return false
      case 'other':
        if (!QUIET_CHUNK_TYPES.has(view.type)) this.#unknownChunks += 1
        return false
      default: {
        const unreachable: never = view
        throw new Error(`Unknown chunk view ${String(unreachable)}`)
      }
    }
  }
}
