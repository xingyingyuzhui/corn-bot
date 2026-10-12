import { RemoteError } from './remote-error.ts'
import {
  type AssistantStreamFrame,
  type FollowSnapshot,
  parseFollowFrame,
  type WireEvent,
} from './session-wire.ts'
import type { HostStreamMux } from './transport.ts'

export interface FollowRequest {
  readonly sessionId: string
  /** Opt into process-local assistant presentation frames. */
  readonly assistantStream?: boolean
  readonly maxMessages?: number
  readonly turnWindow?: {
    readonly minMessages: number
    readonly minTurns: number
  }
}

export interface SeqGap {
  /** `cursor + 1` at the time the gap was seen. */
  readonly expected: number
  readonly received: number
}

/**
 * Every callback runs after the follower has validated the frame. `onGap` and
 * `onError` are terminal: the stream is already closed and the caller must
 * reopen it to rebaseline from a fresh snapshot.
 */
export interface FollowHandlers {
  readonly onSnapshot: (snapshot: FollowSnapshot) => void
  readonly onEvent: (event: WireEvent) => void
  readonly onAssistantStream?: (frame: AssistantStreamFrame) => void
  readonly onGap: (gap: SeqGap) => void
  readonly onError: (error: Error) => void
}

/**
 * One `session/follow` stream for an ordinary Session. Exactly one opening
 * snapshot is accepted; afterwards every durable event must be `cursor + 1`.
 * Opening a follow activates the Session's Agent.
 */
export class SessionFollower {
  readonly sessionId: string
  #handlers: FollowHandlers
  #cancel: () => void = () => {}
  #cursor: number | undefined
  #closed = false

  private constructor(sessionId: string, handlers: FollowHandlers) {
    this.sessionId = sessionId
    this.#handlers = handlers
  }

  static open(
    mux: HostStreamMux,
    request: FollowRequest,
    handlers: FollowHandlers,
  ): SessionFollower {
    if (request.sessionId.length === 0)
      throw new RemoteError('corn/invalid-request', 'sessionId is required')
    const follower = new SessionFollower(request.sessionId, handlers)
    follower.#cancel = mux.open(
      'session/follow',
      {
        request: {
          address: { kind: 'session', sessionId: request.sessionId },
          ...(request.assistantStream === true
            ? { assistantStream: true }
            : {}),
          ...(request.maxMessages === undefined
            ? {}
            : { maxMessages: request.maxMessages }),
          ...(request.turnWindow === undefined
            ? {}
            : {
                turnWindow: {
                  minMessages: request.turnWindow.minMessages,
                  minTurns: request.turnWindow.minTurns,
                },
              }),
        },
      },
      (raw) => follower.#receive(raw),
      (error) => follower.#terminate(() => handlers.onError(error)),
    )
    return follower
  }

  /** Last durable seq delivered; `undefined` before the snapshot. */
  get cursor(): number | undefined {
    return this.#cursor
  }

  get closed(): boolean {
    return this.#closed
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#cancel()
  }

  #receive(raw: unknown): void {
    if (this.#closed) return
    // Nothing may escape into the shared mux: a throw there fails every stream.
    try {
      const frame = parseFollowFrame(raw)
      switch (frame.type) {
        case 'snapshot':
          if (this.#cursor !== undefined)
            throw new RemoteError(
              'corn/invalid-response',
              'Duplicate follow snapshot',
            )
          this.#cursor = frame.cursor
          this.#handlers.onSnapshot(frame)
          return
        case 'event': {
          if (this.#cursor === undefined)
            throw new RemoteError(
              'corn/invalid-response',
              'Follow event before snapshot',
            )
          const expected = this.#cursor + 1
          if (frame.event.seq !== expected) {
            const gap = { expected, received: frame.event.seq }
            this.#terminate(() => this.#handlers.onGap(gap))
            return
          }
          this.#cursor = expected
          this.#handlers.onEvent(frame.event)
          return
        }
        case 'assistant-stream':
          if (this.#cursor === undefined)
            throw new RemoteError(
              'corn/invalid-response',
              'Assistant stream before snapshot',
            )
          this.#handlers.onAssistantStream?.(frame.frame)
          return
        default:
          assertNever(frame)
      }
    } catch (error) {
      this.#terminate(() =>
        this.#handlers.onError(
          error instanceof Error ? error : new Error('Invalid follow frame'),
        ),
      )
    }
  }

  #terminate(report: () => void): void {
    if (this.#closed) return
    this.close()
    try {
      report()
    } catch {
      // A failing terminal callback must not reach the shared mux.
    }
  }
}

function assertNever(value: never): never {
  throw new RemoteError(
    'corn/invalid-response',
    `Unhandled follow frame ${String((value as { type?: unknown }).type)}`,
  )
}
