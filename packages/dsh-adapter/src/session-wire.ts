import { RemoteError } from './remote-error.ts'

/**
 * Structural parsers for the DSH Session follow/page wire
 * (`session-controller/src/types.ts` at dsh-v0.2.0-rc.2). They validate
 * envelopes and identities only; event `data` and stream chunks stay opaque
 * JSON for the Main-side projector.
 */

/** Canonical placement of a current surface event. */
export type SurfaceOp =
  | 'append'
  | {
      readonly op: 'replace'
      readonly startSeq: number
      readonly endSeq: number
    }

/** One durable Session event (`SessionWireEvent`). */
export interface WireEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
  readonly ignorable: boolean
  /** Omitted when absent, or opaque on an unknown ignorable event. */
  readonly surfaceOp?: SurfaceOp
  readonly sourceEventSeqs?: readonly number[]
}

/** Session identity facts from the follow snapshot header (`SessionWireHeader`). */
export interface SessionHeaderView {
  readonly sessionId: string
  readonly createdAt: number
  readonly isSeeded: boolean
  readonly cwd?: string
  readonly parentSessionId?: string
  readonly origin?: 'subagent'
  readonly agentPreset?: string
}

export interface ProjectionBaseline {
  readonly asOfSeq: number
  readonly values: Readonly<Record<string, unknown>>
}

/** Active attempt at a follow opening; `stream` holds compact records. */
export interface AssistantStreamAttempt {
  readonly attemptId: string
  readonly startedAfterSeq: number
  readonly turn: number
  readonly step: number
  readonly nextIndex: number
  readonly stream: readonly unknown[]
}

export interface AssistantStreamBaseline {
  readonly revision: number
  readonly activeAttempt?: AssistantStreamAttempt
}

/** Process-local assistant presentation frame (`SessionAssistantStreamFrame`). */
export type AssistantStreamFrame =
  | {
      readonly type: 'start'
      readonly attemptId: string
      readonly revision: number
      readonly startedAfterSeq: number
      readonly turn: number
      readonly step: number
    }
  | {
      readonly type: 'chunk'
      readonly attemptId: string
      readonly revision: number
      readonly index: number
      readonly time: number
      /** Raw `StreamChunk`; read it through {@link classifyStreamChunk}. */
      readonly chunk: unknown
    }
  | {
      readonly type: 'end'
      readonly attemptId: string
      readonly revision: number
      readonly index: number
      readonly outcome:
        | {
            readonly kind: 'committed'
            readonly eventType: 'assistant/message' | 'assistant/attempt'
            readonly seq: number
          }
        | { readonly kind: 'abandoned' }
    }

export interface FollowSnapshot {
  readonly type: 'snapshot'
  readonly header: SessionHeaderView
  readonly cursor: number
  readonly records: readonly WireEvent[]
  readonly hasMore: boolean
  readonly projections: ProjectionBaseline
  readonly assistantStream?: AssistantStreamBaseline
}

export type FollowFrame =
  | FollowSnapshot
  | { readonly type: 'event'; readonly event: WireEvent }
  | { readonly type: 'assistant-stream'; readonly frame: AssistantStreamFrame }

/** What P3 can render from one live chunk or compact baseline record. */
export type AssistantChunkView =
  | { readonly kind: 'text'; readonly index: number; readonly text: string }
  | {
      readonly kind: 'reasoning'
      readonly index: number
      readonly text: string
    }
  | { readonly kind: 'other'; readonly type: string }

const invalid = (what: string): RemoteError =>
  new RemoteError('corn/invalid-response', `Invalid ${what}`)

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isIndex = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0

/** A durable cursor: `-1` before the first event. */
const isCursor = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= -1

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

function surfaceOp(value: unknown): SurfaceOp | undefined {
  if (value === 'append') return 'append'
  if (
    isPlainRecord(value) &&
    value.op === 'replace' &&
    isIndex(value.startSeq) &&
    isIndex(value.endSeq)
  )
    return { op: 'replace', startSeq: value.startSeq, endSeq: value.endSeq }
  return undefined
}

export function parseWireEvent(raw: unknown): WireEvent {
  if (
    !isPlainRecord(raw) ||
    !isId(raw.type) ||
    !isIndex(raw.seq) ||
    typeof raw.time !== 'number' ||
    !Object.hasOwn(raw, 'data') ||
    (raw.ignorable !== undefined && raw.ignorable !== true)
  )
    throw invalid('Session event')
  const ignorable = raw.ignorable === true
  const op = surfaceOp(raw.surfaceOp)
  if (raw.surfaceOp !== undefined && op === undefined && !ignorable)
    throw invalid('Session event surface')
  const sources = raw.sourceEventSeqs
  const validSources = Array.isArray(sources) && sources.every(isIndex)
  if (sources !== undefined && !validSources && !ignorable)
    throw invalid('Session event sources')
  return {
    type: raw.type,
    seq: raw.seq,
    time: raw.time,
    data: raw.data,
    ignorable,
    ...(op === undefined ? {} : { surfaceOp: op }),
    ...(validSources ? { sourceEventSeqs: sources as number[] } : {}),
  }
}

/** History records (`SessionEventEntry[]`) that must be one gap-free ascending run. */
export function parseEventRecords(raw: unknown): readonly WireEvent[] {
  if (!Array.isArray(raw)) throw invalid('Session history records')
  const events = raw.map((entry) => {
    if (!isPlainRecord(entry) || entry.type !== 'event')
      throw invalid('Session history record')
    return parseWireEvent(entry.event)
  })
  for (let index = 1; index < events.length; index++) {
    if (
      (events[index] as WireEvent).seq !==
      (events[index - 1] as WireEvent).seq + 1
    )
      throw invalid('Session history continuity')
  }
  return events
}

export function parseWireHeader(raw: unknown): SessionHeaderView {
  if (
    !isPlainRecord(raw) ||
    typeof raw.version !== 'number' ||
    !isId(raw.id) ||
    typeof raw.createdAt !== 'number' ||
    typeof raw.isSeeded !== 'boolean' ||
    (raw.cwd !== undefined && typeof raw.cwd !== 'string') ||
    (raw.parentSession !== undefined && !isId(raw.parentSession)) ||
    (raw.origin !== undefined && raw.origin !== 'subagent') ||
    (raw.agentPreset !== undefined && !isId(raw.agentPreset))
  )
    throw invalid('Session header')
  return {
    sessionId: raw.id,
    createdAt: raw.createdAt,
    isSeeded: raw.isSeeded,
    ...(raw.cwd === undefined ? {} : { cwd: raw.cwd as string }),
    ...(raw.parentSession === undefined
      ? {}
      : { parentSessionId: raw.parentSession as string }),
    ...(raw.origin === undefined ? {} : { origin: 'subagent' as const }),
    ...(raw.agentPreset === undefined
      ? {}
      : { agentPreset: raw.agentPreset as string }),
  }
}

function parseProjectionBaseline(raw: unknown): ProjectionBaseline {
  if (
    !isPlainRecord(raw) ||
    !isCursor(raw.asOfSeq) ||
    !isPlainRecord(raw.values)
  )
    throw invalid('Session projection baseline')
  return { asOfSeq: raw.asOfSeq, values: raw.values }
}

function parseAssistantStreamBaseline(raw: unknown): AssistantStreamBaseline {
  if (!isPlainRecord(raw) || !isIndex(raw.revision))
    throw invalid('assistant stream baseline')
  if (raw.activeAttempt === undefined) return { revision: raw.revision }
  const attempt = raw.activeAttempt
  if (
    !isPlainRecord(attempt) ||
    !isId(attempt.attemptId) ||
    !isCursor(attempt.startedAfterSeq) ||
    !isIndex(attempt.turn) ||
    !isIndex(attempt.step) ||
    !isIndex(attempt.nextIndex) ||
    !Array.isArray(attempt.stream)
  )
    throw invalid('assistant stream attempt')
  return {
    revision: raw.revision,
    activeAttempt: {
      attemptId: attempt.attemptId,
      startedAfterSeq: attempt.startedAfterSeq,
      turn: attempt.turn,
      step: attempt.step,
      nextIndex: attempt.nextIndex,
      stream: attempt.stream,
    },
  }
}

export function parseAssistantStreamFrame(raw: unknown): AssistantStreamFrame {
  if (!isPlainRecord(raw) || !isId(raw.attemptId) || !isIndex(raw.revision))
    throw invalid('assistant stream frame')
  const { attemptId, revision } = raw
  if (raw.type === 'start') {
    if (
      !isCursor(raw.startedAfterSeq) ||
      !isIndex(raw.turn) ||
      !isIndex(raw.step)
    )
      throw invalid('assistant stream start')
    return {
      type: 'start',
      attemptId,
      revision,
      startedAfterSeq: raw.startedAfterSeq,
      turn: raw.turn,
      step: raw.step,
    }
  }
  if (raw.type === 'chunk') {
    if (
      !isIndex(raw.index) ||
      typeof raw.time !== 'number' ||
      !isPlainRecord(raw.chunk)
    )
      throw invalid('assistant stream chunk')
    return {
      type: 'chunk',
      attemptId,
      revision,
      index: raw.index,
      time: raw.time,
      chunk: raw.chunk,
    }
  }
  if (raw.type === 'end') {
    const outcome = raw.outcome
    if (!isIndex(raw.index) || !isPlainRecord(outcome))
      throw invalid('assistant stream end')
    if (outcome.kind === 'abandoned')
      return {
        type: 'end',
        attemptId,
        revision,
        index: raw.index,
        outcome: { kind: 'abandoned' },
      }
    if (
      outcome.kind !== 'committed' ||
      (outcome.eventType !== 'assistant/message' &&
        outcome.eventType !== 'assistant/attempt') ||
      !isIndex(outcome.seq)
    )
      throw invalid('assistant stream outcome')
    return {
      type: 'end',
      attemptId,
      revision,
      index: raw.index,
      outcome: {
        kind: 'committed',
        eventType: outcome.eventType,
        seq: outcome.seq,
      },
    }
  }
  throw invalid('assistant stream frame type')
}

export function parseFollowFrame(raw: unknown): FollowFrame {
  if (!isPlainRecord(raw)) throw invalid('follow frame')
  if (raw.type === 'event')
    return { type: 'event', event: parseWireEvent(raw.event) }
  if (raw.type === 'assistant-stream')
    return {
      type: 'assistant-stream',
      frame: parseAssistantStreamFrame(raw.frame),
    }
  if (raw.type !== 'snapshot') throw invalid('follow frame type')
  if (!isCursor(raw.cursor) || typeof raw.hasMore !== 'boolean')
    throw invalid('follow snapshot')
  const records = parseEventRecords(raw.records)
  const last = records.at(-1)
  if (last !== undefined && last.seq > raw.cursor)
    throw invalid('follow snapshot cursor')
  return {
    type: 'snapshot',
    header: parseWireHeader(raw.header),
    cursor: raw.cursor,
    records,
    hasMore: raw.hasMore,
    projections: parseProjectionBaseline(raw.projections),
    ...(raw.assistantStream === undefined
      ? {}
      : { assistantStream: parseAssistantStreamBaseline(raw.assistantStream) }),
  }
}

/**
 * Classifies one live `StreamChunk` (`llm/src/types.ts` L452). Only text and
 * reasoning deltas carry renderable text; tool-call arguments, block payloads,
 * usage and finish metadata are reduced to their type.
 */
export function classifyStreamChunk(chunk: unknown): AssistantChunkView {
  if (!isPlainRecord(chunk)) return { kind: 'other', type: 'invalid' }
  if (
    (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') &&
    isIndex(chunk.index) &&
    typeof chunk.text === 'string'
  )
    return {
      kind: chunk.type === 'text-delta' ? 'text' : 'reasoning',
      index: chunk.index,
      text: chunk.text,
    }
  return {
    kind: 'other',
    type: typeof chunk.type === 'string' ? chunk.type : 'invalid',
  }
}

/**
 * Classifies one compact record of a snapshot attempt stream
 * (`AssistantStreamRecord`, `llm/src/assistant-stream.ts` L20): packed text
 * and reasoning runs are joined; a raw `chunk` record is classified as live.
 */
export function classifyStreamRecord(record: unknown): AssistantChunkView {
  if (!isPlainRecord(record)) return { kind: 'other', type: 'invalid' }
  if (record.type === 'chunk') return classifyStreamChunk(record.chunk)
  if (
    (record.type === 'text-chunks' || record.type === 'reasoning-chunks') &&
    isIndex(record.index) &&
    Array.isArray(record.texts) &&
    record.texts.every((text) => typeof text === 'string')
  )
    return {
      kind: record.type === 'text-chunks' ? 'text' : 'reasoning',
      index: record.index,
      text: record.texts.join(''),
    }
  return {
    kind: 'other',
    type: typeof record.type === 'string' ? record.type : 'invalid',
  }
}
