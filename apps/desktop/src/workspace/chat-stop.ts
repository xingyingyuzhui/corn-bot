import type { WorkspaceResult } from '../../../../packages/contracts/src/workspace.ts'
import type { WireEvent } from '../../../../packages/dsh-adapter/src/session-wire.ts'
import type { ApprovalBroker } from './approval-broker.ts'
import {
  type ChatAudit,
  type ChatRuntime,
  type ChatTiming,
  fail,
  OK,
} from './chat-runtime.ts'
import {
  StaleTurnFence,
  type StopReport,
  stopForegroundTree,
  verifyForegroundTree,
} from './foreground-stop.ts'

/** Desensitized product fact. `stopped` is only set after a clean verification. */
export const STOP_PHASES = [
  'idle',
  'stopping',
  'stopped',
  'partial',
  'unknown',
] as const
export type StopPhase = (typeof STOP_PHASES)[number]

/** Cold reconcile interval while a protected Session has no warm follow. */
export const COLD_RECONCILE_MS = 1_000
const COLD_RPC_BUDGET_MS = 1_000

export interface ChatStopperOptions {
  readonly approvals: Pick<ApprovalBroker, 'stopTurn' | 'resumeSession'>
  readonly runtime: () => ChatRuntime | undefined
  /** The followed projection's last seq for this Session, if it is followed. */
  readonly cursor: (sessionId: string) => number | undefined
  readonly onAudit: (audit: ChatAudit) => void
  /** Keeps a background task (the +2 s verification, a stale cancel) for `idle`. */
  readonly track: (task: Promise<unknown>) => void
  readonly log: (line: string) => void
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  /** One-shot delay. Returns a cancel. Used for cold reconcile, not a spin loop. */
  readonly schedule: (fn: () => void, ms: number) => () => void
  readonly timing: Pick<ChatTiming, 'verifyDelayMs' | 'stop'>
  /** Synchronously reject still-pending admissions of this Session. */
  readonly onPending: (sessionId: string) => void
  readonly onPhase: (botId: string, phase: StopPhase) => void
  /** Durable events from a cold page. Never a follow. */
  readonly onColdEvents: (
    sessionId: string,
    events: readonly WireEvent[],
  ) => void
}

/**
 * Decision 8B: one foreground stop per Session at a time (leaf first, parent
 * Turn last, verified at +2 s), and the stale-Turn fence it leaves behind
 * until the next user prompt.
 */
interface SessionControl {
  phase: StopPhase
  confirmed: boolean
  /** Host generation this stop belongs to. Mismatched completions are ignored. */
  generation: number
  unsettled: number
  botId: string
}

export class ChatStopper {
  readonly #options: ChatStopperOptions
  readonly #fences = new Map<string, StaleTurnFence>()
  readonly #stopping = new Map<string, Promise<WorkspaceResult<null>>>()
  readonly #controls = new Map<string, SessionControl>()
  readonly #cold = new Map<string, () => void>()
  #generation = 0

  constructor(options: ChatStopperOptions) {
    this.#options = options
  }

  /** Host attach/detach/dispose. In-flight stop completions from the old generation do not count. */
  invalidate(): void {
    this.#generation += 1
    for (const [sessionId, control] of this.#controls) {
      if (control.phase === 'idle') continue
      control.phase = 'unknown'
      control.confirmed = false
      control.generation = this.#generation
      this.#options.onPhase(control.botId, 'unknown')
      void sessionId
    }
  }

  phase(botId: string): StopPhase {
    for (const control of this.#controls.values())
      if (control.botId === botId && control.phase !== 'idle')
        return control.phase
    return 'idle'
  }

  /** A stop fence is still in force, whether or not the UI is following the Session. */
  protects(sessionId: string): boolean {
    return this.#fences.has(sessionId)
  }

  /**
   * New prompts are refused while a stop is running, partial, unknown, or
   * still has a control RPC Corn stopped waiting for. A confirmed stop allows
   * the explicit next send.
   */
  blocksDispatch(sessionId: string): boolean {
    const control = this.#controls.get(sessionId)
    if (control === undefined || control.phase === 'idle') return false
    if (control.unsettled > 0) return true
    return control.phase !== 'stopped' || !control.confirmed
  }

  /** Concurrent stops of one Session share a single run. */
  stop(
    runtime: ChatRuntime,
    botId: string,
    sessionId: string,
  ): Promise<WorkspaceResult<null>> {
    const running = this.#stopping.get(sessionId)
    if (running !== undefined) return running
    const stop = this.#run(runtime, botId, sessionId).finally(() => {
      this.#stopping.delete(sessionId)
    })
    this.#stopping.set(sessionId, stop)
    return stop
  }

  /**
   * The user's next prompt after a confirmed stop. Anything short of that
   * keeps the fence, including a send that was only queued.
   */
  continueIfConfirmed(sessionId: string): boolean {
    const control = this.#controls.get(sessionId)
    if (control === undefined) {
      this.#fences.delete(sessionId)
      this.#clearCold(sessionId)
      return true
    }
    if (
      !control.confirmed ||
      control.phase !== 'stopped' ||
      control.unsettled > 0
    )
      return false
    this.#fences.delete(sessionId)
    this.#clearCold(sessionId)
    control.phase = 'idle'
    control.confirmed = false
    this.#controls.delete(sessionId)
    this.#options.approvals.resumeSession(sessionId)
    this.#options.onPhase(control.botId, 'idle')
    return true
  }

  /** A retired binding drops the fence. It does not invent a confirmation. */
  lift(sessionId: string): void {
    this.#fences.delete(sessionId)
    this.#clearCold(sessionId)
    const control = this.#controls.get(sessionId)
    if (control === undefined) return
    this.#controls.delete(sessionId)
    this.#options.onPhase(control.botId, 'idle')
  }

  /** After a new Host generation, cold-watch protected Sessions that have no warm stream. */
  armUnwatched(hasWarm: (sessionId: string) => boolean): void {
    for (const [sessionId, control] of this.#controls)
      if (this.protects(sessionId) && !hasWarm(sessionId))
        this.armCold(control.botId, sessionId)
  }

  /** The warm follow died. Watch by cold page only; do not open another follow. */
  armCold(botId: string, sessionId: string): void {
    if (!this.protects(sessionId) || this.#cold.has(sessionId)) return
    const cancel = this.#options.schedule(() => {
      this.#cold.delete(sessionId)
      const pass = this.#coldPass(botId, sessionId).finally(() => {
        if (this.protects(sessionId)) this.armCold(botId, sessionId)
      })
      this.#options.track(pass)
    }, COLD_RECONCILE_MS)
    this.#cold.set(sessionId, cancel)
  }

  /** The stale-Turn fallback on the followed stream: cancel at `turn/start`, count steps. */
  watch(botId: string, sessionId: string, events: readonly WireEvent[]): void {
    const fence = this.#fences.get(sessionId)
    if (fence === undefined) return
    for (const signal of fence.observe(events)) {
      switch (signal.kind) {
        case 'stale-turn': {
          this.#audit({ kind: 'stale-turn', botId, turn: signal.turn })
          const runtime = this.#options.runtime()
          if (runtime === undefined) break
          this.#options.track(
            runtime.sessions.cancel(sessionId).catch(() => {
              this.#options.log('Corn chat: stale turn cancel failed')
            }),
          )
          break
        }
        case 'leaked-request':
          this.#audit({
            kind: 'leaked-request',
            botId,
            turn: signal.turn,
            total: fence.leakedRequests,
          })
          break
        default: {
          const unreachable: never = signal
          throw new Error(`Unhandled stale signal ${String(unreachable)}`)
        }
      }
    }
  }

  async #run(
    runtime: ChatRuntime,
    botId: string,
    sessionId: string,
  ): Promise<WorkspaceResult<null>> {
    const { approvals, now, sleep, timing } = this.#options
    const generation = this.#generation
    approvals.stopTurn(sessionId)
    this.#fences.set(
      sessionId,
      new StaleTurnFence(this.#options.cursor(sessionId), now()),
    )
    const control = this.#control(sessionId, botId, generation)
    control.phase = 'stopping'
    control.confirmed = false
    this.#options.onPhase(botId, 'stopping')
    this.#options.onPending(sessionId)
    const ports = { sessions: runtime.sessions, jobs: runtime.jobs }
    const report = await stopForegroundTree(ports, sessionId, {
      now,
      sleep,
      ...timing.stop,
      onUnsettled: (work) => this.#retain(sessionId, work),
    })
    if (!this.#current(sessionId, generation)) return OK
    this.#audit({ kind: 'stop', botId, ...report })
    this.#applyReport(sessionId, report)
    this.#options.track(
      sleep(timing.verifyDelayMs)
        .then(() =>
          verifyForegroundTree(ports, sessionId, {
            sleep,
            timeoutMs: COLD_RPC_BUDGET_MS,
          }),
        )
        .then((verification) => {
          if (!this.#current(sessionId, generation)) return
          this.#audit({ kind: 'stop-verify', botId, verification })
          this.#applyVerification(sessionId, report, verification)
        }),
    )
    return report.parentCancel === 'failed' ? fail('host_error') : OK
  }

  #control(
    sessionId: string,
    botId: string,
    generation: number,
  ): SessionControl {
    const existing = this.#controls.get(sessionId)
    if (existing !== undefined) {
      existing.botId = botId
      existing.generation = generation
      return existing
    }
    const created: SessionControl = {
      phase: 'stopping',
      confirmed: false,
      generation,
      unsettled: 0,
      botId,
    }
    this.#controls.set(sessionId, created)
    return created
  }

  #current(sessionId: string, generation: number): boolean {
    const control = this.#controls.get(sessionId)
    return (
      control !== undefined &&
      control.generation === generation &&
      generation === this.#generation
    )
  }

  #retain(sessionId: string, work: Promise<unknown>): void {
    const control = this.#controls.get(sessionId)
    if (control === undefined) return
    control.unsettled += 1
    const tracked = work.finally(() => {
      const current = this.#controls.get(sessionId)
      if (current === undefined) return
      current.unsettled = Math.max(0, current.unsettled - 1)
    })
    this.#options.track(tracked)
  }

  #applyReport(sessionId: string, report: StopReport): void {
    const control = this.#controls.get(sessionId)
    if (control === undefined) return
    control.confirmed = false
    if (
      report.parentCancel === 'unknown' ||
      report.parentCancel === 'failed' ||
      report.unsettled > 0
    ) {
      control.phase = 'unknown'
    } else if (report.outcome === 'stop_partial') {
      control.phase = 'partial'
    } else {
      control.phase = 'stopping'
    }
    this.#options.onPhase(control.botId, control.phase)
  }

  #applyVerification(
    sessionId: string,
    report: StopReport,
    verification: { readonly status: string },
  ): void {
    const control = this.#controls.get(sessionId)
    if (control === undefined || control.phase === 'idle') return
    control.confirmed = false
    if (verification.status === 'unreadable') control.phase = 'unknown'
    else if (
      verification.status === 'clean' &&
      report.outcome === 'stopped' &&
      report.parentCancel === 'cancelled' &&
      report.unsettled === 0 &&
      control.unsettled === 0
    ) {
      control.phase = 'stopped'
      control.confirmed = true
    } else control.phase = 'partial'
    this.#options.onPhase(control.botId, control.phase)
  }

  async #coldPass(botId: string, sessionId: string): Promise<void> {
    const runtime = this.#options.runtime()
    const generation = this.#generation
    if (runtime === undefined) {
      this.#mark(sessionId, 'unknown', false)
      return
    }
    let ignoreLate = false
    try {
      const page = await Promise.race([
        runtime.sessions.page(
          { sessionId, throughSeq: Number.MAX_SAFE_INTEGER },
          { timeoutMs: COLD_RPC_BUDGET_MS },
        ),
        this.#options.sleep(COLD_RPC_BUDGET_MS).then(() => {
          if (!ignoreLate) throw new Error('cold reconcile budget')
          return undefined
        }),
      ])
      if (page === undefined) throw new Error('cold reconcile budget')
      if (!this.#current(sessionId, generation)) return
      this.#options.onColdEvents(sessionId, page.records)
      this.watch(botId, sessionId, page.records)
    } catch {
      if (this.#current(sessionId, generation))
        this.#mark(sessionId, 'unknown', false)
    } finally {
      ignoreLate = true
    }
  }

  #mark(sessionId: string, phase: StopPhase, confirmed: boolean): void {
    const control = this.#controls.get(sessionId)
    if (control === undefined || control.phase === 'idle') return
    control.phase = phase
    control.confirmed = confirmed
    this.#options.onPhase(control.botId, phase)
  }

  #clearCold(sessionId: string): void {
    this.#cold.get(sessionId)?.()
    this.#cold.delete(sessionId)
  }

  #audit(entry: ChatAudit): void {
    try {
      this.#options.onAudit(entry)
    } catch {
      // Auditing must not break the stop path.
    }
  }
}
