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

/** Bound passed into one control RPC. Abort means Corn stopped waiting. */
export interface StopCallOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

/** `job.list` / `job.kill` for one Session's visible roster. */
export interface ChatJobs {
  list(sessionId: string, options?: StopCallOptions): Promise<readonly JobRow[]>
  kill(
    sessionId: string,
    jobId: string,
    options?: StopCallOptions,
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
/** Kept inside the stop deadline for the parent cancel. */
export const STOP_PARENT_RESERVE_MS = 1_000
/** Step 5: the tree must be empty this long after the stop. */
export const STOP_VERIFY_DELAY_MS = 2_000
/** The +2s check itself cannot wait forever. */
export const STOP_VERIFY_BUDGET_MS = 5_000

export class StopBudgetError extends Error {
  constructor() {
    super('Stop budget exhausted')
    this.name = 'StopBudgetError'
  }
}

/**
 * Reserve for the parent cancel. A full 5s budget keeps 1s. A shorter test
 * budget keeps a slice so a child RPC can still start and then be abandoned.
 */
export function parentReserveMs(deadlineMs: number): number {
  if (deadlineMs >= STOP_PARENT_RESERVE_MS) return STOP_PARENT_RESERVE_MS
  return Math.max(1, Math.floor(deadlineMs / 5))
}

export interface StopOptions {
  readonly maxPasses?: number
  readonly deadlineMs?: number
  readonly passDelayMs?: number
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  /** A control RPC Corn stopped waiting for. It must not be dropped. */
  readonly onUnsettled?: (work: Promise<unknown>) => void
}

/**
 * `not_found`: the parent was not attached; the verify list decides.
 * `unknown`: Corn stopped waiting. The RPC may still run; it is not a confirmation.
 */
export type ParentCancel = 'cancelled' | 'not_found' | 'failed' | 'unknown'

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
  /** Control RPCs still running after Corn stopped waiting for them. */
  readonly unsettled: number
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

interface Budget {
  readonly deadlineAt: number
  readonly reserveMs: number
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly onUnsettled?: (work: Promise<unknown>) => void
  unsettled: number
  truncated: boolean
}

function totalLeft(budget: Budget): number {
  return Math.max(0, budget.deadlineAt - budget.now())
}

function childLeft(budget: Budget): number {
  return Math.max(0, totalLeft(budget) - budget.reserveMs)
}

/**
 * Waits at most `ms` of budget time. A sleep that does not move `now`
 * (the test harness yields without time passing) is not a timeout: the RPC
 * is still awaited. When the wait ends first, `work` is retained as unsettled.
 */
async function withinBudget<T>(
  work: Promise<T>,
  ms: number,
  budget: Budget,
): Promise<T> {
  if (ms <= 0) {
    budget.unsettled += 1
    budget.truncated = true
    budget.onUnsettled?.(work)
    throw new StopBudgetError()
  }
  let ignoreLate = false
  const timeout = (async (): Promise<'pending'> => {
    const start = budget.now()
    await budget.sleep(ms)
    if (ignoreLate) return 'pending'
    if (budget.now() - start >= ms) throw new StopBudgetError()
    return 'pending'
  })()
  try {
    const result = await Promise.race([work, timeout])
    if (result === 'pending') return await work
    return result
  } catch (error) {
    if (error instanceof StopBudgetError) {
      budget.unsettled += 1
      budget.truncated = true
      budget.onUnsettled?.(work)
    }
    throw error
  } finally {
    ignoreLate = true
  }
}

/** Steps 1–2 once: interrupt running children deepest first, then kill owned jobs. */
async function stopPass(
  ports: StopPorts,
  rootId: string,
  budget: Budget,
): Promise<PassResult> {
  let rows: readonly SessionRow[]
  try {
    const call = ports.sessions.sessionRows({ timeoutMs: childLeft(budget) })
    rows = await withinBudget(call, childLeft(budget), budget)
  } catch {
    return { clean: false, interrupted: 0, killed: 0, foreign: 0 }
  }
  const tree = sessionTree(rows, rootId)
  let clean = true
  let interrupted = 0
  for (const child of tree) {
    if (!child.running) continue
    clean = false
    if (childLeft(budget) <= 0) {
      budget.truncated = true
      return { clean: false, interrupted, killed: 0, foreign: 0 }
    }
    const slice = childLeft(budget)
    try {
      await withinBudget(
        ports.sessions.interruptChild(
          {
            parentSessionId: child.parentSessionId,
            childSessionId: child.sessionId,
          },
          { timeoutMs: slice },
        ),
        slice,
        budget,
      )
      interrupted += 1
    } catch (error) {
      if (error instanceof StopBudgetError) {
        return { clean: false, interrupted, killed: 0, foreign: 0 }
      }
      // `subagent/unauthorized` or a gateway error: the next pass re-reads.
    }
  }
  const owners = [...tree.map((member) => member.sessionId), rootId]
  const owned = new Set(owners)
  const seen = new Set<string>()
  let killed = 0
  let foreign = 0
  for (const sessionId of owners) {
    if (childLeft(budget) <= 0) {
      budget.truncated = true
      clean = false
      break
    }
    let jobs: readonly JobRow[]
    const slice = childLeft(budget)
    try {
      jobs = await withinBudget(
        ports.jobs.list(sessionId, { timeoutMs: slice }),
        slice,
        budget,
      )
    } catch (error) {
      clean = false
      if (error instanceof StopBudgetError) break
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
      if (childLeft(budget) <= 0) {
        budget.truncated = true
        return { clean: false, interrupted, killed, foreign }
      }
      const killSlice = childLeft(budget)
      try {
        if (
          (await withinBudget(
            ports.jobs.kill(job.owner, job.id, { timeoutMs: killSlice }),
            killSlice,
            budget,
          )) === 'requested'
        )
          killed += 1
      } catch (error) {
        if (error instanceof StopBudgetError) {
          return { clean: false, interrupted, killed, foreign }
        }
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
  const budget: Budget = {
    deadlineAt: started + deadlineMs,
    reserveMs: parentReserveMs(deadlineMs),
    now,
    sleep,
    unsettled: 0,
    truncated: false,
    ...(options.onUnsettled === undefined
      ? {}
      : { onUnsettled: options.onUnsettled }),
  }
  let passes = 0
  let childrenInterrupted = 0
  let jobsKilled = 0
  let foreignJobs = 0
  let clean = false
  while (passes < maxPasses && !budget.truncated && childLeft(budget) > 0) {
    passes += 1
    const pass = await stopPass(ports, rootId, budget)
    childrenInterrupted += pass.interrupted
    jobsKilled += pass.killed
    foreignJobs = Math.max(foreignJobs, pass.foreign)
    if (pass.clean) {
      clean = true
      break
    }
    if (budget.truncated || passes >= maxPasses || childLeft(budget) <= 0) break
    const delay = Math.min(passDelayMs, childLeft(budget))
    if (delay > 0) await sleep(delay)
  }
  if (passes === 0) passes = 1
  let parentCancel: ParentCancel = 'cancelled'
  const parentSlice = totalLeft(budget)
  const cancel = ports.sessions.cancel(rootId, { timeoutMs: parentSlice })
  try {
    await withinBudget(cancel, parentSlice, budget)
  } catch (error) {
    parentCancel =
      error instanceof StopBudgetError
        ? 'unknown'
        : remoteCode(error) === 'session/not-found'
          ? 'not_found'
          : 'failed'
  }
  return {
    outcome: clean && !budget.truncated ? 'stopped' : 'stop_partial',
    passes,
    childrenInterrupted,
    jobsKilled,
    foreignJobs,
    parentCancel,
    unsettled: budget.unsettled,
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
  options: {
    readonly timeoutMs?: number
    readonly sleep?: StopOptions['sleep']
  } = {},
): Promise<StopVerification> {
  const timeoutMs = options.timeoutMs ?? STOP_VERIFY_BUDGET_MS
  const budget: Budget = {
    deadlineAt:
      (options.sleep === undefined ? Date.now() : Date.now()) + timeoutMs,
    reserveMs: 0,
    now: Date.now,
    sleep:
      options.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    unsettled: 0,
    truncated: false,
  }
  try {
    const rows = await withinBudget(
      ports.sessions.sessionRows({ timeoutMs }),
      timeoutMs,
      budget,
    )
    const tree = sessionTree(rows, rootId)
    const root = rows.find((row) => row.sessionId === rootId)
    const runningSessions =
      tree.filter((member) => member.running).length +
      (root?.running === true ? 1 : 0)
    const owners = [...tree.map((member) => member.sessionId), rootId]
    const owned = new Set(owners)
    const live = new Set<string>()
    for (const sessionId of owners) {
      const left = totalLeft(budget)
      if (left <= 0) return { status: 'unreadable' }
      for (const job of await withinBudget(
        ports.jobs.list(sessionId, { timeoutMs: left }),
        left,
        budget,
      ))
        if (isLive(job) && job.owner !== null && owned.has(job.owner))
          live.add(job.id)
    }
    return {
      status: runningSessions === 0 && live.size === 0 ? 'clean' : 'residual',
      runningSessions,
      runningJobs: live.size,
    }
  } catch {
    return { status: 'unreadable' }
  }
}
