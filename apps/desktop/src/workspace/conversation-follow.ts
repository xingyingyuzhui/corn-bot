import type { ConversationView } from '../../../../packages/contracts/src/workspace.ts'
import type { SessionPage } from '../../../../packages/dsh-adapter/src/session-client.ts'
import type { FollowHandlers } from '../../../../packages/dsh-adapter/src/session-follower.ts'
import type {
  ConversationProjector,
  EarlierPageRequest,
  ProjectionUpdate,
  RebaselineReason,
} from './conversation-projector.ts'

/**
 * Keeps one `ConversationProjector` fed from a `session/follow` and reopens
 * the follow whenever the projection loses continuity. The reopen policy
 * (when the Host is ready, backoff) belongs to the caller through
 * `scheduleReopen`; this class only guarantees that frames from a closed
 * stream never reach the projector and that every reopen starts from a fresh
 * snapshot.
 */

/** The open stream; `SessionFollower` satisfies it. */
export interface FollowStream {
  close(): void
}

export interface ConversationFollowOptions {
  readonly projector: ConversationProjector
  /** Opens `session/follow` with `assistantStream: true`; e.g. `SessionFollower.open`. */
  readonly openFollow: (handlers: FollowHandlers) => FollowStream
  /** `SessionClient.page` bound to the Session. */
  readonly page: (request: EarlierPageRequest) => Promise<SessionPage>
  /** Receives each changed view, ready for the per-frame push. */
  readonly onView: (view: ConversationView) => void
  /**
   * Arranges `reopen` to run when a new follow may start and returns a
   * cancel. Called once per lost stream, never while one is pending.
   */
  readonly scheduleReopen: (
    reason: RebaselineReason,
    reopen: () => void,
  ) => () => void
}

export type LoadEarlierResult = 'loaded' | 'none' | 'stale'

export class ConversationFollow {
  readonly #options: ConversationFollowOptions
  #stream: FollowStream | undefined
  #generation = 0
  #cancelReopen: (() => void) | undefined
  #earlier: Promise<LoadEarlierResult> | undefined
  #stopped = false

  constructor(options: ConversationFollowOptions) {
    this.#options = options
  }

  start(): void {
    if (
      this.#stopped ||
      this.#stream !== undefined ||
      this.#cancelReopen !== undefined
    )
      return
    this.#open()
  }

  stop(): void {
    this.#stopped = true
    this.#generation += 1
    this.#cancelReopen?.()
    this.#cancelReopen = undefined
    this.#stream?.close()
    this.#stream = undefined
  }

  /** Loads one older page; concurrent calls share one request. */
  loadEarlier(): Promise<LoadEarlierResult> {
    this.#earlier ??= this.#loadEarlier().finally(() => {
      this.#earlier = undefined
    })
    return this.#earlier
  }

  async #loadEarlier(): Promise<LoadEarlierResult> {
    const { projector } = this.#options
    const request = projector.earlierPage()
    if (request === null) return 'none'
    const page = await this.#options.page(request)
    if (this.#stopped) return 'stale'
    // Dropped when a rebuild moved the anchor meanwhile or the page does not join.
    const update = projector.applyEarlier(request, page)
    this.#publish(update)
    return update.view === undefined ? 'stale' : 'loaded'
  }

  #open(): void {
    const generation = ++this.#generation
    const live = (): boolean =>
      generation === this.#generation && !this.#stopped
    const { projector } = this.#options
    const stream = this.#options.openFollow({
      onSnapshot: (snapshot) => {
        if (live()) this.#apply(projector.snapshot(snapshot))
      },
      onEvent: (event) => {
        if (live()) this.#apply(projector.event(event))
      },
      onAssistantStream: (frame) => {
        if (live()) this.#apply(projector.assistantStream(frame))
      },
      onGap: () => {
        if (live()) this.#lost(projector.rebaseline('seq-gap'))
      },
      onError: () => {
        if (live()) this.#lost(projector.rebaseline('disconnected'))
      },
    })
    // A stream lost while opening was already replaced or scheduled.
    if (live()) this.#stream = stream
    else stream.close()
  }

  #apply(update: ProjectionUpdate): void {
    if (update.rebaseline === undefined) {
      this.#publish(update)
      return
    }
    this.#lost(update)
  }

  /** The projection is `reconnecting`: close this stream and schedule a fresh one. */
  #lost(update: ProjectionUpdate): void {
    this.#publish(update)
    this.#generation += 1
    this.#stream?.close()
    this.#stream = undefined
    if (this.#stopped || this.#cancelReopen !== undefined) return
    this.#cancelReopen = this.#options.scheduleReopen(
      update.rebaseline ?? 'disconnected',
      () => {
        this.#cancelReopen = undefined
        if (!this.#stopped && this.#stream === undefined) this.#open()
      },
    )
  }

  #publish(update: ProjectionUpdate): void {
    if (update.view !== undefined) this.#options.onView(update.view)
  }
}
