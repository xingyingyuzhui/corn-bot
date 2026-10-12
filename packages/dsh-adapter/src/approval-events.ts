import { RemoteError } from './remote-error.ts'
import { isPlainRecord } from './session-wire.ts'
import type { HostStreamMux, HostTransport } from './transport.ts'

/** Display text limits; reasons may contain paths or command lines. */
export const APPROVAL_REASON_MAX_CODE_POINTS = 500
const TOOL_NAME_MAX_LENGTH = 256

/**
 * One `approval/request` waterfall as the Gateway projects it: the Agent and
 * signal are stripped, leaving `{toolName, callId?, reason?, displayReason?}`
 * (`user-approval/src/types.ts` L63–76). `sessionId` is the frame `agentId`,
 * which is `agent.id`, the Session identity.
 */
export interface ApprovalRequestView {
  readonly eventId: string
  readonly sessionId: string
  readonly toolName: string
  readonly callId?: string
  /** Truncated; for display only, never logged. */
  readonly reason?: string
  /** Only `en` and `zh`, each truncated. */
  readonly displayReason?: { readonly en: string; readonly zh?: string }
}

/** A waterfall Corn does not answer (e.g. `user-questions/request`, or a malformed approval). */
export interface UnsupportedWaterfall {
  readonly event: string
  readonly eventId: string
  readonly sessionId: string
}

/** A parsed `$events` item; `ready` keeps the generation `clientId` private to this module. */
type EventsFrame =
  | { readonly type: 'ready'; readonly clientId: string }
  | { readonly type: 'approval'; readonly request: ApprovalRequestView }
  | { readonly type: 'unsupported'; readonly waterfall: UnsupportedWaterfall }
  | { readonly type: 'cancel'; readonly eventId: string }
  | { readonly type: 'emit'; readonly event: string }

export type ApprovalAnswer = 'allowed-once' | 'rejected'

const invalid = (what: string): RemoteError =>
  new RemoteError('corn/invalid-response', `Invalid ${what}`)

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const own = Object.keys(value)
  return (
    own.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  )
}

export function truncateCodePoints(value: string, maximum: number): string {
  let count = 0
  let end = 0
  for (const codePoint of value) {
    if (count === maximum) return `${value.slice(0, end)}…`
    count++
    end += codePoint.length
  }
  return value
}

const display = (value: string) =>
  truncateCodePoints(value, APPROVAL_REASON_MAX_CODE_POINTS)

function approvalRequest(
  eventId: string,
  sessionId: string,
  raw: Record<string, unknown>,
): ApprovalRequestView | undefined {
  const { toolName, callId, reason, displayReason } = raw
  if (
    !isId(toolName) ||
    toolName.length > TOOL_NAME_MAX_LENGTH ||
    (callId !== undefined && !isId(callId)) ||
    (reason !== undefined && typeof reason !== 'string')
  )
    return undefined
  let localized: ApprovalRequestView['displayReason']
  if (displayReason !== undefined) {
    if (!isPlainRecord(displayReason) || typeof displayReason.en !== 'string')
      return undefined
    const zh = displayReason.zh
    localized = {
      en: display(displayReason.en),
      ...(typeof zh === 'string' ? { zh: display(zh) } : {}),
    }
  }
  return {
    eventId,
    sessionId,
    toolName,
    ...(callId === undefined ? {} : { callId: callId as string }),
    ...(reason === undefined ? {} : { reason: display(reason as string) }),
    ...(localized === undefined ? {} : { displayReason: localized }),
  }
}

/**
 * Validates one `$events` item the way the official client does
 * (`gateway/src/client/remote-events.ts` L265–314). A structurally valid
 * approval waterfall whose request Corn cannot read becomes `unsupported`, so
 * the caller delegates it and DSH fails closed with `unavailable`.
 */
export function parseEventsFrame(raw: unknown): EventsFrame {
  if (!isPlainRecord(raw)) throw invalid('$events frame')
  switch (raw.type) {
    case 'ready':
      if (
        !hasExactKeys(raw, ['type', 'clientId', 'host']) ||
        !isId(raw.clientId) ||
        !isPlainRecord(raw.host) ||
        !hasExactKeys(raw.host, ['home']) ||
        typeof raw.host.home !== 'string'
      )
        throw invalid('$events ready frame')
      // `host.home` is a filesystem path and is deliberately dropped.
      return { type: 'ready', clientId: raw.clientId }
    case 'cancel':
      if (!hasExactKeys(raw, ['type', 'eventId']) || !isId(raw.eventId))
        throw invalid('$events cancel frame')
      return { type: 'cancel', eventId: raw.eventId }
    case 'emit':
      if (
        !hasExactKeys(raw, ['type', 'event', 'args']) ||
        !isId(raw.event) ||
        !Array.isArray(raw.args)
      )
        throw invalid('$events emit frame')
      return { type: 'emit', event: raw.event }
    case 'waterfall': {
      if (
        !hasExactKeys(raw, [
          'type',
          'event',
          'eventId',
          'agentId',
          'request',
        ]) ||
        !isId(raw.event) ||
        !isId(raw.eventId) ||
        !isId(raw.agentId) ||
        !isPlainRecord(raw.request) ||
        Object.hasOwn(raw.request, 'agent') ||
        Object.hasOwn(raw.request, 'signal')
      )
        throw invalid('$events waterfall frame')
      const request =
        raw.event === 'approval/request'
          ? approvalRequest(raw.eventId, raw.agentId, raw.request)
          : undefined
      return request === undefined
        ? {
            type: 'unsupported',
            waterfall: {
              event: raw.event,
              eventId: raw.eventId,
              sessionId: raw.agentId,
            },
          }
        : { type: 'approval', request }
    }
    default:
      throw invalid('$events frame type')
  }
}

/** Callbacks carry the opaque generation number, never the Gateway `clientId`. */
export interface ApprovalEventHandlers {
  readonly onReady: (generation: number) => void
  readonly onApproval: (
    request: ApprovalRequestView,
    generation: number,
  ) => void
  readonly onUnsupported: (
    waterfall: UnsupportedWaterfall,
    generation: number,
  ) => void
  /** Sent for withdrawal and also after every settlement (`gateway/src/index.ts` L657–668). */
  readonly onCancel: (eventId: string, generation: number) => void
  /** Terminal: the generation is closed and every pending event is unanswerable here. */
  readonly onError: (error: Error) => void
}

let nextGeneration = 1

/**
 * One `$events` client generation. Results are bound to this generation's
 * `clientId` and only to events it delivered and has not seen cancelled; the
 * Gateway redelivers still-pending events to a newer generation under the
 * same `eventId` (`gateway/src/index.ts` L513).
 */
export class ApprovalEvents {
  readonly generation = nextGeneration++
  #transport: HostTransport
  #handlers: ApprovalEventHandlers
  #cancel: () => void = () => {}
  #clientId: string | undefined
  #pending = new Set<string>()
  #closed = false

  private constructor(
    transport: HostTransport,
    handlers: ApprovalEventHandlers,
  ) {
    this.#transport = transport
    this.#handlers = handlers
  }

  static open(
    mux: HostStreamMux,
    transport: HostTransport,
    handlers: ApprovalEventHandlers,
  ): ApprovalEvents {
    const events = new ApprovalEvents(transport, handlers)
    events.#cancel = mux.open(
      '$events',
      {},
      (raw) => events.#receive(raw),
      (error) => events.#terminate(error),
    )
    return events
  }

  get ready(): boolean {
    return this.#clientId !== undefined && !this.#closed
  }

  get closed(): boolean {
    return this.#closed
  }

  /** Answers one pending approval with a closed outcome; never free text. */
  answer(eventId: string, value: ApprovalAnswer): Promise<void> {
    if (value !== 'allowed-once' && value !== 'rejected')
      return Promise.reject(
        new RemoteError('corn/invalid-request', 'Invalid approval answer'),
      )
    return this.#result(eventId, { kind: 'result', value })
  }

  /** Hands one pending waterfall back to the Host chain (`unavailable` for approvals). */
  delegate(eventId: string): Promise<void> {
    return this.#result(eventId, { kind: 'next' })
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#pending.clear()
    this.#cancel()
  }

  async #result(
    eventId: string,
    outcome: { kind: 'next' } | { kind: 'result'; value: ApprovalAnswer },
  ): Promise<void> {
    const clientId = this.#clientId
    if (this.#closed || clientId === undefined)
      throw new RemoteError('corn/events-unavailable', '$events is not ready')
    if (!this.#pending.has(eventId))
      throw new RemoteError(
        'corn/event-stale',
        'Event is not pending in this generation',
      )
    await this.#transport.rpc('$events/result', { clientId, eventId, outcome })
    this.#pending.delete(eventId)
  }

  #receive(raw: unknown): void {
    if (this.#closed) return
    try {
      const frame = parseEventsFrame(raw)
      if (frame.type === 'ready') {
        if (this.#clientId !== undefined)
          throw invalid('repeated $events ready frame')
        this.#clientId = frame.clientId
        this.#handlers.onReady(this.generation)
        return
      }
      if (this.#clientId === undefined)
        throw invalid('$events frame before ready')
      switch (frame.type) {
        case 'approval':
          this.#pending.add(frame.request.eventId)
          this.#handlers.onApproval(frame.request, this.generation)
          return
        case 'unsupported':
          this.#pending.add(frame.waterfall.eventId)
          this.#handlers.onUnsupported(frame.waterfall, this.generation)
          return
        case 'cancel':
          this.#pending.delete(frame.eventId)
          this.#handlers.onCancel(frame.eventId, this.generation)
          return
        case 'emit':
          return
        default:
          assertNever(frame)
      }
    } catch (error) {
      this.#terminate(
        error instanceof Error ? error : new Error('Invalid $events frame'),
      )
    }
  }

  #terminate(error: Error): void {
    if (this.#closed) return
    this.close()
    try {
      this.#handlers.onError(error)
    } catch {
      // A failing terminal callback must not reach the shared mux.
    }
  }
}

function assertNever(value: never): never {
  throw new RemoteError(
    'corn/invalid-response',
    `Unhandled $events frame ${String((value as { type?: unknown }).type)}`,
  )
}
