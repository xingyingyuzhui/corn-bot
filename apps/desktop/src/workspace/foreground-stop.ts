import type { JobRow } from '../../../../packages/dsh-adapter/src/job-client.ts'
import { RemoteError } from '../../../../packages/dsh-adapter/src/remote-error.ts'
import type {
  SessionClient,
  SessionRow,
} from '../../../../packages/dsh-adapter/src/session-client.ts'
import {
  isPlainRecord,
  type WireEvent,
} from '../../../../packages/dsh-adapter/src/session-wire.ts'

/**
 * Decision 8B: stop one foreground conversation's Session tree, leaf first
 * (ADR-0007 addendum 2026-10-12, mandated order). Only the Bot's own Session
 * and its `subagent` descendants are touched; jobs are killed only when one
 * of those Sessions owns them. P3 has no C1 fence, so the caller applies the
 * stale-Turn fallback while and after this runs.
 */

/** `job.list` / `job.kill` for one Session's visible roster. */
export interface ChatJobs {
  list(sessionId: string): Promise<readonly JobRow[]>
  kill(
    sessionId: string,
    jobId: string,
  ): Promise<'requested' | 'already-finished'>
}

export interface StopPorts {
  readonly sessions: Pick<
    SessionClient,
    'sessionRows' | 'interruptChild' | 'cancel'
  >
  readonly jobs: ChatJobs
}

/** ADR-0007 starting bounds: B6 cleared in about 250 ms. */
export const STOP_MAX_PASSES = 5
export const STOP_DEADLINE_MS = 5_000
export const STOP_PASS_DELAY_MS = 100
/** Step 5: the tree must be empty this long after the stop. */
export const STOP_VERIFY_DELAY_MS = 2_000

export interface StopOptions {
  readonly maxPasses?: number
  readonly deadlineMs?: number
  readonly passDelayMs?: number
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
}

/** `not_found`: the parent was not attached; the verify list decides. */
export type ParentCancel = 'cancelled' | 'not_found' | 'failed'

/** Counts and closed outcomes only; no Session, job or Host text. */
export interface StopReport {
  /** `stop_partial`: the bound ran out before one pass found nothing running. */
  readonly outcome: 'stopped' | 'stop_partial'
  readonly passes: number
  readonly childrenInterrupted: number
  readonly jobsKilled: number
  /** Live jobs visible from the tree but not owned by it; never touched. */
  readonly foreignJobs: number
  readonly parentCancel: ParentCancel
}

export type StopVerification =
  | {
      readonly status: 'clean' | 'residual'
      readonly runningSessions: number
      readonly runningJobs: number
    }
  | { readonly status: 'unreadable' }

interface TreeMember {
  readonly sessionId: string
  readonly parentSessionId: string
  readonly depth: number
  readonly running: boolean
}

/** The root's `subagent` descendants by `parentSessionId` lineage, deepest first. */
export function sessionTree(
  rows: readonly SessionRow[],
  rootId: string,
): readonly TreeMember[] {
  const members: TreeMember[] = []
  const seen = new Set([rootId])
  let frontier = [rootId]
  for (let depth = 1; frontier.length > 0; depth += 1) {
    const parents = new Set(frontier)
    frontier = []
    for (const row of rows) {
      const parent = row.parentSessionId
      if (
        parent === undefined ||
        row.origin !== 'subagent' ||
        !parents.has(parent) ||
        seen.has(row.sessionId)
      )
        continue
      seen.add(row.sessionId)
      frontier.push(row.sessionId)
      members.push({
        sessionId: row.sessionId,
        parentSessionId: parent,
        depth,
        running: row.running,
      })
    }
  }
  return members.sort((a, b) => b.depth - a.depth)
}

const isLive = (job: JobRow): boolean =>
  job.status === 'running' || job.status === 'stopping'

const remoteCode = (error: unknown): string | null =>
  error instanceof RemoteError ? error.code : null

interface PassResult {
  readonly clean: boolean
  readonly interrupted: number
  readonly killed: number
  readonly foreign: number
}

/** Steps 1–2 once: interrupt running children deepest first, then kill owned jobs. */
async function stopPass(ports: StopPorts, rootId: string): Promise<PassResult> {
  let rows: readonly SessionRow[]
  try {
    rows = await ports.sessions.sessionRows()
  } catch {
    return { clean: false, interrupted: 0, killed: 0, foreign: 0 }
  }
  const tree = sessionTree(rows, rootId)
  let clean = true
  let interrupted = 0
  for (const child of tree) {
    if (!child.running) continue
    clean = false
    try {
      await ports.sessions.interruptChild({
        parentSessionId: child.parentSessionId,
        childSessionId: child.sessionId,
      })
      interrupted += 1
    } catch {
      // `subagent/unauthorized` or a gateway error: the next pass re-reads.
    }
  }
  const owners = [...tree.map((member) => member.sessionId), rootId]
  const owned = new Set(owners)
  const seen = new Set<string>()
  let killed = 0
  let foreign = 0
  for (const sessionId of owners) {
    let jobs: readonly JobRow[]
    try {
      jobs = await ports.jobs.list(sessionId)
    } catch {
      clean = false
      continue
    }
    for (const job of jobs) {
      if (seen.has(job.id) || !isLive(job)) continue
      seen.add(job.id)
      if (job.owner === null || !owned.has(job.owner)) {
        foreign += 1
        continue
      }
      clean = false
      try {
        if ((await ports.jobs.kill(job.owner, job.id)) === 'requested')
          killed += 1
      } catch {
        // `job/not-found`: already gone; anything else is re-listed.
      }
    }
  }
  return { clean, interrupted, killed, foreign }
}

/**
 * Steps 1–4: re-list until one full pass finds nothing running (bounded by
 * passes and a deadline), then cancel the parent Turn last. A parent cancel
 * runs even after `stop_partial`.
 */
export async function stopForegroundTree(
  ports: StopPorts,
  rootId: string,
  options: StopOptions = {},
): Promise<StopReport> {
  const maxPasses = options.maxPasses ?? STOP_MAX_PASSES
  const deadlineMs = options.deadlineMs ?? STOP_DEADLINE_MS
  const passDelayMs = options.passDelayMs ?? STOP_PASS_DELAY_MS
  const now = options.now ?? Date.now
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const started = now()
  let passes = 0
  let childrenInterrupted = 0
  let jobsKilled = 0
  let foreignJobs = 0
  let clean = false
  while (passes < maxPasses) {
    passes += 1
    const pass = await stopPass(ports, rootId)
    childrenInterrupted += pass.interrupted
    jobsKilled += pass.killed
    foreignJobs = Math.max(foreignJobs, pass.foreign)
    if (pass.clean) {
      clean = true
      break
    }
    if (passes >= maxPasses || now() - started >= deadlineMs) break
    await sleep(passDelayMs)
  }
  let parentCancel: ParentCancel = 'cancelled'
  try {
    await ports.sessions.cancel(rootId)
  } catch (error) {
    parentCancel =
      remoteCode(error) === 'session/not-found' ? 'not_found' : 'failed'
  }
  return {
    outcome: clean ? 'stopped' : 'stop_partial',
    passes,
    childrenInterrupted,
    jobsKilled,
    foreignJobs,
    parentCancel,
  }
}

export type StaleTurnSignal =
  /** A Turn began after the stop: cancel it at once. */
  | { readonly kind: 'stale-turn'; readonly turn: number | null }
  /** A step of a stale Turn: counted as one leaked model request (upper bound). */
  | { readonly kind: 'leaked-request'; readonly turn: number | null }

const turnOf = (event: WireEvent): number | null =>
  isPlainRecord(event.data) && Number.isSafeInteger(event.data.turn)
    ? (event.data.turn as number)
    : null

/**
 * The P3 stale-Turn fallback (ADR-0007 addendum; no C1 pre-step fence yet):
 * any `turn/start` after the stop began is stale, and each `step/start`
 * inside a stale Turn is one leaked request. Fed the follow's durable events
 * in seq order; rebuilt windows repeat events, which are skipped.
 */
export class StaleTurnFence {
  /** Last durable seq before the stop; `undefined` when unfollowed then. */
  readonly #fromSeq: number | undefined
  /** Fallback cut by event time when no seq was known. */
  readonly #startedAt: number
  #lastSeq: number | undefined
  #staleTurn: { readonly turn: number | null } | undefined
  staleTurns = 0
  leakedRequests = 0

  constructor(fromSeq: number | undefined, startedAt: number) {
    this.#fromSeq = fromSeq
    this.#startedAt = startedAt
  }

  observe(events: readonly WireEvent[]): readonly StaleTurnSignal[] {
    const signals: StaleTurnSignal[] = []
    for (const event of events) {
      if (this.#lastSeq !== undefined && event.seq <= this.#lastSeq) continue
      this.#lastSeq = event.seq
      const after =
        this.#fromSeq === undefined
          ? event.time >= this.#startedAt
          : event.seq > this.#fromSeq
      if (!after) continue
      switch (event.type) {
        case 'turn/start': {
          const turn = turnOf(event)
          this.#staleTurn = { turn }
          this.staleTurns += 1
          signals.push({ kind: 'stale-turn', turn })
          break
        }
        case 'step/start':
          if (this.#staleTurn === undefined) break
          this.leakedRequests += 1
          signals.push({ kind: 'leaked-request', turn: this.#staleTurn.turn })
          break
        case 'turn/end':
          this.#staleTurn = undefined
          break
        default:
          break
      }
    }
    return signals
  }
}

/** Step 5: no running Session and no owned live job left in the tree. */
export async function verifyForegroundTree(
  ports: StopPorts,
  rootId: string,
): Promise<StopVerification> {
  try {
    const rows = await ports.sessions.sessionRows()
    const tree = sessionTree(rows, rootId)
    const root = rows.find((row) => row.sessionId === rootId)
    const runningSessions =
      tree.filter((member) => member.running).length +
      (root?.running === true ? 1 : 0)
    const owners = [...tree.map((member) => member.sessionId), rootId]
    const owned = new Set(owners)
    const live = new Set<string>()
    for (const sessionId of owners)
      for (const job of await ports.jobs.list(sessionId))
        if (isLive(job) && job.owner !== null && owned.has(job.owner))
          live.add(job.id)
    return {
      status: runningSessions === 0 && live.size === 0 ? 'clean' : 'residual',
      runningSessions,
      runningJobs: live.size,
    }
  } catch {
    return { status: 'unreadable' }
  }
}
