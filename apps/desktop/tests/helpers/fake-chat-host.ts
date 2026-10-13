import type { ModelSelection } from '../../../../packages/contracts/src/model-settings.ts'
import type { JobRow } from '../../../../packages/dsh-adapter/src/job-client.ts'
import { RemoteError } from '../../../../packages/dsh-adapter/src/remote-error.ts'
import type {
  PageRequest,
  SessionPage,
  SessionRow,
} from '../../../../packages/dsh-adapter/src/session-client.ts'
import type { FollowHandlers } from '../../../../packages/dsh-adapter/src/session-follower.ts'
import type {
  FollowSnapshot,
  WireEvent,
} from '../../../../packages/dsh-adapter/src/session-wire.ts'
import type { ChatRuntime } from '../../src/workspace/chat-runtime.ts'

/**
 * `accept`: admitted, reply delivered. `lost`: admitted, reply lost
 * (timeout). `dropped`: never arrived (timeout). `reject`: a closed DSH
 * refusal; nothing admitted.
 */
export type PromptFault =
  | 'accept'
  | 'lost'
  | 'dropped'
  | { readonly reject: string }

interface QueuedMessage {
  readonly id: string
  readonly rpcId: string
  readonly text: string
}

interface Follow {
  readonly sessionId: string
  readonly handlers: FollowHandlers
  closed: boolean
}

export interface HostCall {
  readonly op: string
  readonly sessionId?: string
  readonly target?: string
}

/**
 * DSH Session, job and follow behaviour as `ChatService` sees it
 * (dsh-v0.2.0-rc.2): prompts dedupe by `requestId` across inbox and journal,
 * `session/projections` never activates, the follow opens with a snapshot
 * and then streams gap-free events. Text stays in this fake only.
 */
export class FakeChatHost {
  readonly clock: { value: number }
  readonly journals = new Map<string, WireEvent[]>()
  readonly inboxes = new Map<string, QueuedMessage[]>()
  readonly selections = new Map<string, ModelSelection | null>()
  readonly calls: HostCall[] = []
  /** Request ids DSH actually admitted (a second entry is a double send). */
  readonly admitted: string[] = []
  readonly prompts: { readonly requestId: string; readonly text: string }[] = []
  readonly faults: PromptFault[] = []
  /** `busy`: prompts queue in the inbox instead of starting at once. */
  busy = false
  /** Held prompt replies: resolved by the test. */
  hold: Promise<void> | undefined
  rows: SessionRow[] = []
  jobs: JobRow[] = []
  readonly follows: Follow[] = []
  followOpenError: Error | undefined
  onInterrupt: (childSessionId: string) => void = () => {}
  onKill: (jobId: string) => void = () => {}
  #ids = 0

  constructor(clock: { value: number }, sessionIds: readonly string[]) {
    this.clock = clock
    for (const id of sessionIds) {
      this.journals.set(id, [])
      this.inboxes.set(id, [])
      this.selections.set(id, null)
    }
  }

  count(op: string): number {
    return this.calls.filter((call) => call.op === op).length
  }

  journal(sessionId: string): WireEvent[] {
    const journal = this.journals.get(sessionId)
    if (journal === undefined) throw new Error('unknown fake session')
    return journal
  }

  /** Appends a durable event and streams it to open follows. */
  append(sessionId: string, type: string, data: unknown): WireEvent {
    const journal = this.journal(sessionId)
    const event: WireEvent = {
      type,
      seq: (journal.at(-1)?.seq ?? -1) + 1,
      time: this.clock.value,
      data,
      ignorable: false,
      ...(type === 'user/message' ? { surfaceOp: 'append' as const } : {}),
    }
    journal.push(event)
    for (const follow of this.follows)
      if (!follow.closed && follow.sessionId === sessionId)
        follow.handlers.onEvent(event)
    return event
  }

  userMessage(sessionId: string, message: QueuedMessage): WireEvent {
    return this.append(sessionId, 'user/message', {
      id: message.id,
      role: 'user',
      content: [{ type: 'text', text: message.text }],
      source: { kind: 'user', rpcId: message.rpcId },
    })
  }

  /** The next Turn claims the first queued message. */
  claim(sessionId: string): void {
    const message = this.inboxes.get(sessionId)?.shift()
    if (message !== undefined) this.userMessage(sessionId, message)
  }

  /** Every open follow errors (WS drop); the follows close. */
  dropFollows(): void {
    for (const follow of this.follows) {
      if (follow.closed) continue
      follow.closed = true
      follow.handlers.onError(
        new RemoteError('corn/disconnected', 'Host event stream disconnected'),
      )
    }
  }

  openFollows(sessionId?: string): number {
    return this.follows.filter(
      (follow) =>
        !follow.closed &&
        (sessionId === undefined || follow.sessionId === sessionId),
    ).length
  }

  #holds(sessionId: string, requestId: string): boolean {
    const matches = (event: WireEvent) =>
      event.type === 'user/message' &&
      (event.data as { source?: { rpcId?: string } }).source?.rpcId ===
        requestId
    return (
      (this.inboxes.get(sessionId) ?? []).some(
        (message) => message.rpcId === requestId,
      ) || this.journal(sessionId).some(matches)
    )
  }

  #admit(sessionId: string, requestId: string, text: string): void {
    this.admitted.push(requestId)
    const message = { id: `item-${++this.#ids}`, rpcId: requestId, text }
    if (this.busy) this.inboxes.get(sessionId)?.push(message)
    else this.userMessage(sessionId, message)
  }

  runtime(): ChatRuntime {
    return {
      sessions: {
        prompt: async (request) => {
          this.calls.push({ op: 'prompt', sessionId: request.sessionId })
          const text = request.content.map((part) => part.text).join('')
          this.prompts.push({ requestId: request.requestId, text })
          if (this.hold !== undefined) await this.hold
          const fault = this.faults.shift() ?? 'accept'
          if (fault === 'dropped')
            throw new RemoteError('corn/timeout', 'timed out')
          if (typeof fault === 'object')
            throw new RemoteError(fault.reject, 'refused')
          if (!this.#holds(request.sessionId, request.requestId))
            this.#admit(request.sessionId, request.requestId, text)
          if (fault === 'lost') throw new RemoteError('corn/timeout', 'lost')
          return { accepted: true }
        },
        cancel: async (sessionId) => {
          this.calls.push({ op: 'cancel', sessionId })
          return {}
        },
        interruptChild: async (request) => {
          this.calls.push({
            op: 'interrupt',
            sessionId: request.parentSessionId,
            target: request.childSessionId,
          })
          this.onInterrupt(request.childSessionId)
        },
        projections: async (sessionId) => {
          this.calls.push({ op: 'projections', sessionId })
          const journal = this.journals.get(sessionId)
          if (journal === undefined) return null
          const queued = (this.inboxes.get(sessionId) ?? []).map((item) => ({
            id: item.id,
            role: 'user',
            content: [{ type: 'text', text: item.text }],
            source: { kind: 'user', rpcId: item.rpcId },
          }))
          const selection = this.selections.get(sessionId) ?? null
          return {
            asOfSeq: journal.at(-1)?.seq ?? -1,
            values: {
              inbox: { 'next-turn': queued, 'next-step': [] },
              modelSelection: { lastUsed: selection, next: selection },
            },
          }
        },
        updateQueue: async (request) => {
          this.calls.push({
            op: 'updateQueue',
            sessionId: request.sessionId,
            target: request.itemId,
          })
          const inbox = this.inboxes.get(request.sessionId) ?? []
          const index = inbox.findIndex((item) => item.id === request.itemId)
          if (index < 0)
            throw new RemoteError(
              'session/queue-item-not-found',
              'queued item is no longer pending',
            )
          inbox.splice(index, 1)
          return {}
        },
        page: async (request: PageRequest): Promise<SessionPage> => {
          this.calls.push({
            op: 'page',
            sessionId: request.sessionId,
            target: String(request.throughSeq),
          })
          const journal = this.journal(request.sessionId)
          const cursor = journal.at(-1)?.seq ?? -1
          if (request.throughSeq > cursor)
            throw new RemoteError(
              'gateway/bad-request',
              'page cut is past cursor',
            )
          const end = Math.min(
            request.throughSeq,
            (request.beforeSeq ?? Number.POSITIVE_INFINITY) - 1,
          )
          const visible = this.journal(request.sessionId).filter(
            (event) => event.seq <= end,
          )
          const records = visible.slice(-2)
          return { records, hasMore: visible.length > records.length }
        },
        sessionRows: async () => {
          this.calls.push({ op: 'sessionRows' })
          return this.rows.map((row) => ({ ...row }))
        },
      },
      jobs: {
        list: async (sessionId) => {
          this.calls.push({ op: 'jobList', sessionId })
          return this.jobs
            .filter((job) => job.owner === sessionId || job.owner === null)
            .map((job) => ({ ...job }))
        },
        kill: async (sessionId, jobId) => {
          this.calls.push({ op: 'jobKill', sessionId, target: jobId })
          const job = this.jobs.find((row) => row.id === jobId)
          if (job === undefined || job.owner !== sessionId)
            throw new RemoteError('job/not-found', 'unknown job')
          if (job.status !== 'running' && job.status !== 'stopping')
            return 'already-finished'
          this.jobs = this.jobs.map((row) =>
            row.id === jobId ? { ...row, status: 'killed' } : row,
          )
          this.onKill(jobId)
          return 'requested'
        },
      },
      openFollow: (sessionId, handlers) => {
        this.calls.push({ op: 'follow', sessionId })
        if (this.followOpenError !== undefined) throw this.followOpenError
        const follow: Follow = { sessionId, handlers, closed: false }
        this.follows.push(follow)
        queueMicrotask(() => {
          if (follow.closed) return
          const records = [...this.journal(sessionId)]
          const cursor = records.at(-1)?.seq ?? -1
          const snapshot: FollowSnapshot = {
            type: 'snapshot',
            header: { sessionId, createdAt: 1, isSeeded: false },
            cursor,
            records,
            hasMore: false,
            projections: { asOfSeq: cursor, values: {} },
          }
          handlers.onSnapshot(snapshot)
        })
        return {
          close: () => {
            follow.closed = true
          },
        }
      },
    }
  }
}

export const job = (
  id: string,
  owner: string | null,
  status: JobRow['status'] = 'running',
): JobRow => ({
  id,
  kind: 'bash',
  label: id,
  owner,
  status,
  detail: null,
  startedAt: 1,
  finishedAt: null,
})

export const sessionRow = (
  sessionId: string,
  options: { parent?: string; running?: boolean } = {},
): SessionRow => ({
  sessionId,
  updatedAt: 1,
  running: options.running ?? false,
  agentAvailable: true,
  blank: false,
  ...(options.parent === undefined
    ? {}
    : { parentSessionId: options.parent, origin: 'subagent' as const }),
})
