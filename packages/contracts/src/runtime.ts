export type RuntimeStatus = 'stopped' | 'starting' | 'ready' | 'failed'

/** Public runtime facts. Authentication never crosses this boundary. */
export interface RuntimeView {
  readonly status: RuntimeStatus
  readonly dshVersion: string
  readonly message: string
}

export const DSH_VERSION = '0.2.0-rc.2'
export const CLAW_VERSION = '0.3.0-rc.2'
