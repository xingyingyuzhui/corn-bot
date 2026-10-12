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
  stopForegroundTree,
  verifyForegroundTree,
} from './foreground-stop.ts'

export interface ChatStopperOptions {
  readonly approvals: Pick<ApprovalBroker, 'stopTurn'>
  readonly runtime: () => ChatRuntime | undefined
  /** The followed projection's last seq for this Session, if it is followed. */
  readonly cursor: (sessionId: string) => number | undefined
  readonly onAudit: (audit: ChatAudit) => void
  /** Keeps a background task (the +2 s verification, a stale cancel) for `idle`. */
  readonly track: (task: Promise<unknown>) => void
  readonly log: (line: string) => void
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly timing: Pick<ChatTiming, 'verifyDelayMs' | 'stop'>
}

/**
 * Decision 8B: one foreground stop per Session at a time (leaf first, parent
 * Turn last, verified at +2 s), and the stale-Turn fence it leaves behind
 * until the next user prompt.
 */
export class ChatStopper {
  readonly #options: ChatStopperOptions
  readonly #fences = new Map<string, StaleTurnFence>()
  readonly #stopping = new Map<string, Promise<WorkspaceResult<null>>>()

  constructor(options: ChatStopperOptions) {
    this.#options = options
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

  /** A new user prompt (or a retired binding) ends the previous stop. */
  lift(sessionId: string): void {
    this.#fences.delete(sessionId)
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
    approvals.stopTurn(sessionId)
    this.#fences.set(
      sessionId,
      new StaleTurnFence(this.#options.cursor(sessionId), now()),
    )
    const ports = { sessions: runtime.sessions, jobs: runtime.jobs }
    const report = await stopForegroundTree(ports, sessionId, {
      now,
      sleep,
      ...timing.stop,
    })
    this.#audit({ kind: 'stop', botId, ...report })
    this.#options.track(
      sleep(timing.verifyDelayMs)
        .then(() => verifyForegroundTree(ports, sessionId))
        .then((verification) =>
          this.#audit({ kind: 'stop-verify', botId, verification }),
        ),
    )
    return report.parentCancel === 'failed' ? fail('host_error') : OK
  }

  #audit(entry: ChatAudit): void {
    try {
      this.#options.onAudit(entry)
    } catch {
      // Auditing must not break the stop path.
    }
  }
}
