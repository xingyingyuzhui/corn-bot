import type { RuntimeView } from '@corn-bot/contracts'
import { useEffect, useState } from 'react'

const POLL_MS = 1_000

/** Safe runtime facts from Main; `null` when no bridge is present. */
export function useRuntimeStatus(): RuntimeView | null {
  const [view, setView] = useState<RuntimeView | null>(null)
  useEffect(() => {
    const bridge = window.corn
    if (!bridge) return
    let live = true
    const refresh = () => {
      bridge.runtimeStatus().then(
        (next) => {
          if (live) setView(next)
        },
        () => {
          if (live) setView(null)
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
  return view
}
