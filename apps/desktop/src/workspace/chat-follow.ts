import type {
  ConversationView,
  WorkspaceResult,
} from '../../../../packages/contracts/src/workspace.ts'
import { RemoteError } from '../../../../packages/dsh-adapter/src/remote-error.ts'
import type { FollowHandlers } from '../../../../packages/dsh-adapter/src/session-follower.ts'
import type { WireEvent } from '../../../../packages/dsh-adapter/src/session-wire.ts'
import type { ApprovalBroker } from './approval-broker.ts'
import { messageIdFor } from './chat-admissions.ts'
import type { ChatLedger } from './chat-ledger.ts'
import { type ChatRuntime, type ChatTiming, fail, OK } from './chat-runtime.ts'
import { ConversationFollow, type FollowStream } from './conversation-follow.ts'
import {
  type ApprovalOverlay,
  type ApprovalRef,
  opaqueItemIds,
} from './conversation-items.ts'
import {
  ConversationProjector,
  type ProjectionUpdate,
} from './conversation-projector.ts'

/** The one conversation being followed (decision 14A). */
export interface FollowTarget {
  readonly botId: string
  readonly sessionId: string
  readonly conversationId: string
}

export interface ChatFollowerOptions {
  readonly approvals: Pick<ApprovalBroker, 'observe' | 'cards'>
  readonly ledger: Pick<ChatLedger, 'observe' | 'views'>
  readonly runtime: () => ChatRuntime | undefined
  /** Durable events of the followed Session, after the projector took them. */
  readonly onEvents: (
    target: FollowTarget,
    events: readonly WireEvent[],
  ) => void
  readonly onView: (view: ConversationView) => void
  /** Runs `fn` after `ms`; returns a cancel. */
  readonly schedule: (fn: () => void, ms: number) => () => void
  readonly timing: Pick<
    ChatTiming,
    'reopenBaseMs' | 'reopenMaxMs' | 'reopenFailureLimit'
  >
}

interface Followed extends FollowTarget {
  readonly projector: ConversationProjector
  follow: ConversationFollow | undefined
  reopenFailures: number
  admissionsDirty: boolean
}

/**
 * Follows the selected conversation: opens and reopens the Session follow
 * with bounded backoff, tees its stream to the approval broker, the
 * projector and `onEvents`, and keeps the projector's admission bubbles and
 * approval overlay current. Only one conversation is followed at a time.
 */
export class ChatFollower {
  readonly #options: ChatFollowerOptions
  #followed: Followed | undefined
  /** A reopen waiting for the next Host generation. */
  #parked: (() => void) | undefined

  constructor(options: ChatFollowerOptions) {
    this.#options = options
  }

  get current(): FollowTarget | undefined {
    return this.#followed
  }

  /** The followed projection's last seq for `sessionId`, if it is followed. */
  cursor(sessionId: string): number | undefined {
    const entry = this.#followed
    return entry?.sessionId === sessionId ? entry.projector.cursor : undefined
  }

  /** Replaces the followed conversation; the stream opens now only if `start`. */
  follow(target: FollowTarget, start: boolean): void {
    this.unfollow()
    const entry: Followed = {
      ...target,
      projector: new ConversationProjector({
        botId: target.botId,
        mintId: opaqueItemIds(target.conversationId),
        messageIdFor,
        onAdmissionObserved: (observation) => {
          if (this.#options.ledger.observe(target.conversationId, observation))
            entry.admissionsDirty = true
        },
        approvalOverlay: (ref) => this.#overlay(target.sessionId, ref),
      }),
      follow: undefined,
      reopenFailures: 0,
      admissionsDirty: false,
    }
    this.#followed = entry
    this.#refreshAdmissions(entry)
    if (start) this.#start(entry)
  }

  unfollow(): void {
    const entry = this.#followed
    this.#followed = undefined
    this.#parked = undefined
    entry?.follow?.stop()
  }

  /** A retired binding: stop following it. */
  forget(sessionId: string): void {
    if (this.#followed?.sessionId === sessionId) this.unfollow()
  }

  /** After a generation's recovery: start the follow or run its parked reopen. */
  resume(): void {
    const entry = this.#followed
    if (entry === undefined || this.#options.runtime() === undefined) return
    entry.reopenFailures = 0
    if (entry.follow === undefined) {
      this.#start(entry)
      return
    }
    const parked = this.#parked
    this.#parked = undefined
    parked?.()
  }

  /** The Host generation ended: close the stream and show `disconnected`. */
  detach(): void {
    this.#parked = undefined
    const entry = this.#followed
    if (entry === undefined) return
    entry.follow?.stop()
    entry.follow = undefined
    this.#publish(entry.projector.rebaseline('disconnected'))
    this.#refreshAdmissions(entry)
  }

  dispose(): void {
    this.#parked = undefined
    this.#followed?.follow?.stop()
    this.#followed = undefined
  }

  view(botId: string): ConversationView | undefined {
    const entry = this.#followed
    return entry?.botId === botId ? entry.projector.view() : undefined
  }

  approvalsChanged(sessionId: string): void {
    const entry = this.#followed
    if (entry?.sessionId === sessionId) this.#publish(entry.projector.refresh())
  }

  admissionsChanged(conversationId: string): void {
    const entry = this.#followed
    if (entry?.conversationId === conversationId) this.#refreshAdmissions(entry)
  }

  async loadEarlier(botId: string): Promise<WorkspaceResult<null>> {
    const entry = this.#followed
    if (entry?.botId !== botId || entry.follow === undefined)
      return fail('stale')
    try {
      const result = await entry.follow.loadEarlier()
      return result === 'stale' ? fail('stale') : OK
    } catch {
      return fail('host_error')
    }
  }

  #start(entry: Followed): void {
    const follow = new ConversationFollow({
      projector: entry.projector,
      openFollow: (handlers) => this.#open(entry, handlers),
      page: (request) => {
        const runtime = this.#options.runtime()
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
   * projection's approval overlay is current), then the projector, then
   * `onEvents`. An open that throws is reported asynchronously as a lost
   * stream so the follow schedules its next try.
   */
  #open(entry: Followed, handlers: FollowHandlers): FollowStream {
    const { approvals, onEvents } = this.#options
    const tee: FollowHandlers = {
      onSnapshot: (snapshot) => {
        entry.reopenFailures = 0
        approvals.observe(entry.sessionId, snapshot.records)
        handlers.onSnapshot(snapshot)
        onEvents(entry, snapshot.records)
        this.#flushAdmissions(entry)
      },
      onEvent: (event) => {
        approvals.observe(entry.sessionId, [event])
        handlers.onEvent(event)
        onEvents(entry, [event])
        this.#flushAdmissions(entry)
      },
      onAssistantStream: (frame) => handlers.onAssistantStream?.(frame),
      onGap: (gap) => handlers.onGap(gap),
      onError: (error) => handlers.onError(error),
    }
    try {
      const runtime = this.#options.runtime()
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
    const { reopenBaseMs, reopenMaxMs, reopenFailureLimit } =
      this.#options.timing
    if (
      this.#options.runtime() === undefined ||
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
    return this.#options.schedule(reopen, delay)
  }

  /** Observed sends were recorded inside the projector; refresh after it returns. */
  #flushAdmissions(entry: Followed): void {
    if (!entry.admissionsDirty || this.#followed !== entry) return
    entry.admissionsDirty = false
    this.#refreshAdmissions(entry)
  }

  #refreshAdmissions(entry: Followed): void {
    this.#publish(
      entry.projector.setAdmissions(
        this.#options.ledger.views(entry.conversationId),
      ),
    )
  }

  #overlay(sessionId: string, ref: ApprovalRef): ApprovalOverlay | undefined {
    const card = this.#options.approvals
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
      this.#options.onView(view)
    } catch {
      // A failing listener must not break follow callbacks.
    }
  }
}
