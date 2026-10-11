import type { RuntimeErrorCode } from '../../../../packages/contracts/src/runtime.ts'

/** Whether a failure needs the user to repair something before another start can succeed. */
export function isTerminal(code: RuntimeErrorCode): boolean {
  switch (code) {
    case 'host_unavailable':
      return false
    case 'model_config_invalid':
    case 'model_config_permissions':
    case 'model_config_unreadable':
    case 'runtime_home_rejected':
    case 'runtime_home_locked':
    case 'runtime_version_mismatch':
    case 'claw_missing':
    case 'claw_version_mismatch':
    case 'claw_disabled':
    case 'claw_check_failed':
      return true
    default: {
      const unreachable: never = code
      throw new Error(`Unknown runtime error code ${String(unreachable)}`)
    }
  }
}

/** A classified startup failure. Messages stay in Main; only `code` reaches the Renderer. */
export class RuntimeFailure extends Error {
  override readonly name = 'RuntimeFailure'
  readonly code: RuntimeErrorCode

  constructor(code: RuntimeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }

  get terminal(): boolean {
    return isTerminal(this.code)
  }
}

/** Unclassified errors are transient Host failures and feed bounded recovery. */
export function runtimeFailureOf(error: unknown): RuntimeFailure {
  if (error instanceof RuntimeFailure) return error
  return new RuntimeFailure(
    'host_unavailable',
    error instanceof Error ? error.message : String(error),
    { cause: error },
  )
}
