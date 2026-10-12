export type RuntimeStatus =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'recovering'
  | 'failed'

/**
 * Closed set of safe startup failure reasons. Each names a category only; the
 * Renderer never receives keys, cookies, launch URLs, stacks or raw config.
 */
export const RUNTIME_ERROR_CODES = [
  'model_config_invalid',
  'model_config_permissions',
  'model_config_unreadable',
  'runtime_home_rejected',
  'runtime_home_locked',
  'runtime_version_mismatch',
  'runtime_patch_mismatch',
  'claw_missing',
  'claw_version_mismatch',
  'claw_disabled',
  'claw_check_failed',
  'host_unavailable',
] as const
export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number]

/** Public runtime facts. Authentication never crosses this boundary. */
export interface RuntimeView {
  readonly status: RuntimeStatus
  readonly dshVersion: string
  readonly message: string
  /** Present only while `failed`, naming why startup stopped. */
  readonly errorCode?: RuntimeErrorCode
}

export const DSH_VERSION = '0.2.0-rc.2'
export const CLAW_VERSION = '0.3.0-rc.2'
