export interface RecoveryPolicy {
  /** Restarts allowed inside one sliding window before Corn stops retrying. */
  readonly maxAttempts: number
  readonly windowMs: number
  readonly baseDelayMs: number
  readonly maxDelayMs: number
}

export const DEFAULT_RECOVERY_POLICY: RecoveryPolicy = {
  maxAttempts: 3,
  windowMs: 60_000,
  baseDelayMs: 500,
  maxDelayMs: 4_000,
}

/** Crash-loop guard for the owned Host: exponential backoff inside a bounded window. */
export class HostRecovery {
  readonly policy: RecoveryPolicy
  readonly #now: () => number
  #attempts: number[] = []

  constructor(
    policy: RecoveryPolicy = DEFAULT_RECOVERY_POLICY,
    now: () => number = Date.now,
  ) {
    this.policy = policy
    this.#now = now
  }

  /** Delay before the next restart, or `null` once the window budget is spent. */
  nextDelay(): number | null {
    const now = this.#now()
    this.#attempts = this.#attempts.filter(
      (at) => now - at < this.policy.windowMs,
    )
    if (this.#attempts.length >= this.policy.maxAttempts) return null
    const delay = Math.min(
      this.policy.maxDelayMs,
      this.policy.baseDelayMs * 2 ** this.#attempts.length,
    )
    this.#attempts.push(now)
    return delay
  }
}
