import { DSH_VERSION } from '@corn-bot/contracts'
import {
  PENDING_READING,
  type RuntimeReading,
  UNAVAILABLE_READING,
} from '../app/runtime-notice.ts'

/**
 * Development-only runtime readings, selected with `runtime=<state>` in the
 * Vite dev server hash (for example `#fixture=ui-states&runtime=failed`) and
 * switchable live by editing the hash. Production builds never read it, so a
 * Host state can only come from Main there.
 */
export const RUNTIME_FIXTURES = [
  'pending',
  'unavailable',
  'stopped',
  'starting',
  'ready',
  'recovering',
  'failed',
] as const
export type RuntimeFixture = (typeof RUNTIME_FIXTURES)[number]

export function parseRuntimeFixture(
  hash: string,
  dev: boolean,
): RuntimeFixture | null {
  if (!dev) return null
  const name = new URLSearchParams(hash.replace(/^#/u, '')).get('runtime')
  return RUNTIME_FIXTURES.find((fixture) => fixture === name) ?? null
}

export function runtimeFixtureReading(fixture: RuntimeFixture): RuntimeReading {
  switch (fixture) {
    case 'pending':
      return PENDING_READING
    case 'unavailable':
      return UNAVAILABLE_READING
    case 'stopped':
    case 'starting':
    case 'ready':
    case 'recovering':
    case 'failed':
      return {
        kind: 'host',
        view: { status: fixture, dshVersion: DSH_VERSION, message: '' },
      }
    default: {
      const unreachable: never = fixture
      throw new Error(`Unknown runtime fixture ${String(unreachable)}`)
    }
  }
}
