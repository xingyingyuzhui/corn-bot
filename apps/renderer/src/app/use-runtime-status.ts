import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  parseRuntimeFixture,
  runtimeFixtureReading,
} from '../fixtures/runtime-states.ts'
import {
  PENDING_READING,
  type RuntimeReading,
  UNAVAILABLE_READING,
} from './runtime-notice.ts'

const POLL_MS = 1_000

/** Safe runtime facts from Main, polled; `unavailable` when no bridge is present. */
export function useRuntimeStatus(): RuntimeReading {
  const [reading, setReading] = useState<RuntimeReading>(() =>
    window.corn ? PENDING_READING : UNAVAILABLE_READING,
  )
  useEffect(() => {
    const bridge = window.corn
    if (!bridge) return
    let live = true
    const refresh = () => {
      bridge.runtimeStatus().then(
        (view) => {
          if (live) setReading({ kind: 'host', view })
        },
        () => {
          if (live) setReading(UNAVAILABLE_READING)
        },
      )
    }
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])
  return reading
}

const subscribeHash = (notify: () => void) => {
  window.addEventListener('hashchange', notify)
  return () => window.removeEventListener('hashchange', notify)
}
const currentHash = () => window.location.hash

/** Dev server only: the reading named by `runtime=` in the hash. */
export function useRuntimeFixture(): RuntimeReading {
  const hash = useSyncExternalStore(subscribeHash, currentHash)
  const fixture = parseRuntimeFixture(hash, import.meta.env.DEV)
  return fixture ? runtimeFixtureReading(fixture) : UNAVAILABLE_READING
}
