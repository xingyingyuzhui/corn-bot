import type {
  WorkspaceErrorCode,
  WorkspaceResult,
} from '../../../../packages/contracts/src/workspace.ts'
import type {
  SessionClient,
  SessionPage,
} from '../../../../packages/dsh-adapter/src/session-client.ts'
import type { FollowHandlers } from '../../../../packages/dsh-adapter/src/session-follower.ts'
import { parseSessionProbe, type SessionProbe } from './chat-admissions.ts'
import type { FollowStream } from './conversation-follow.ts'
import { userRequestId } from './conversation-items.ts'
import {
  type ChatJobs,
  STOP_VERIFY_DELAY_MS,
  type StopOptions,
  type StopReport,
  type StopVerification,
} from './foreground-stop.ts'

export const OK: WorkspaceResult<null> = { ok: true, value: null }
export const fail = <T>(code: WorkspaceErrorCode): WorkspaceResult<T> => ({
  ok: false,
  error: { code },
})

/** One live Host generation, as `ChatService` needs it. W1 builds it per `ready`. */
export interface ChatRuntime {
  readonly sessions: Pick<
    SessionClient,
    | 'prompt'
    | 'cancel'
    | 'interruptChild'
    | 'projections'
    | 'updateQueue'
    | 'page'
    | 'sessionRows'
  >
  readonly jobs: ChatJobs
  /** `SessionFollower.open(mux, {sessionId, assistantStream: true}, handlers)`. */
  readonly openFollow: (
    sessionId: string,
    handlers: FollowHandlers,
  ) => FollowStream
}

/** Closed audit records (decision 8B stop record); ids are Corn Bot ids only. */
export type ChatAudit =
  | ({ readonly kind: 'stop'; readonly botId: string } & StopReport)
  | {
      readonly kind: 'stop-verify'
      readonly botId: string
      readonly verification: StopVerification
    }
  | {
      readonly kind: 'stale-turn'
      readonly botId: string
      readonly turn: number | null
    }
  | {
      readonly kind: 'leaked-request'
      readonly botId: string
      readonly turn: number | null
      /** Leaked requests counted since this Session's stop began. */
      readonly total: number
    }

export interface ChatTiming {
  /** Same-generation retries of an unknown prompt (plan §3.7: at most 3). */
  readonly promptRetries: number
  /** Backoff before each retry; the last value repeats. */
  readonly retryDelaysMs: readonly number[]
  readonly reopenBaseMs: number
  readonly reopenMaxMs: number
  /** Consecutive failed follow opens before the view shows `error`. */
  readonly reopenFailureLimit: number
  /** Journal pages scanned per reconciliation, newest first. */
  readonly reconcilePages: number
  /** Host clock allowance when deciding a page is older than the send. */
  readonly clockSkewMs: number
  readonly verifyDelayMs: number
  readonly stop: StopOptions
}

export const CHAT_TIMING: ChatTiming = {
  promptRetries: 3,
  retryDelaysMs: [500, 1_000, 2_000],
  reopenBaseMs: 250,
  reopenMaxMs: 5_000,
  reopenFailureLimit: 8,
  reconcilePages: 20,
  clockSkewMs: 60_000,
  verifyDelayMs: STOP_VERIFY_DELAY_MS,
  stop: {},
}

export type Located =
  | { readonly kind: 'journal'; readonly seq: number }
  | { readonly kind: 'inbox'; readonly itemId: string }
  | { readonly kind: 'absent' }
  /** DSH does not know the Session (`session/projections` → `null`). */
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable' }

export interface LocateRequest {
  readonly sessionId: string
  readonly requestId: string
  /** When Corn Bot minted the request; older journal pages cannot hold it. */
  readonly createdAt: number
}

/**
 * Where DSH holds a request: the inbox of `session/projections`, else a
 * `user/message` in the journal at or below its `asOfSeq`, newest page first,
 * back to the send's creation time. Read-only; never activates the Agent.
 */
export async function locateRequest(
  sessions: ChatRuntime['sessions'],
  request: LocateRequest,
  timing: Pick<ChatTiming, 'reconcilePages' | 'clockSkewMs'>,
): Promise<Located> {
  const { sessionId, requestId } = request
  let probe: SessionProbe | null
  try {
    probe = parseSessionProbe(await sessions.projections(sessionId))
  } catch {
    return { kind: 'unreadable' }
  }
  if (probe === null) return { kind: 'missing' }
  const itemId = probe.inbox.get(requestId)
  if (itemId !== undefined) return { kind: 'inbox', itemId }
  const oldest = request.createdAt - timing.clockSkewMs
  let beforeSeq: number | undefined
  for (let pages = 0; pages < timing.reconcilePages; pages += 1) {
    let page: SessionPage
    try {
      page = await sessions.page({
        sessionId,
        throughSeq: probe.asOfSeq,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
      })
    } catch {
      return { kind: 'unreadable' }
    }
    for (const event of page.records)
      if (userRequestId(event) === requestId)
        return { kind: 'journal', seq: event.seq }
    const first = page.records[0]
    if (!page.hasMore || first === undefined || first.time < oldest)
      return { kind: 'absent' }
    beforeSeq = first.seq
  }
  return { kind: 'unreadable' }
}
