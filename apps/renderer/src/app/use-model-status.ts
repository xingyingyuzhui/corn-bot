import type {
  ModelSettingsBridge,
  ModelStatusView,
} from '@corn-bot/contracts/model-settings'
import { useEffect, useState } from 'react'
import { HOST_ERROR_STATUS } from '../model/model-settings-port.ts'

const POLL_MS = 1_000

export const CHECKING_MODEL: ModelStatusView = {
  status: 'checking',
  reason: 'runtime_not_ready',
  devOverride: false,
}

/** Model readiness from Main, polled like the runtime; `null` without a source. */
export function useModelStatus(
  source: Pick<ModelSettingsBridge, 'status'> | null,
): ModelStatusView | null {
  const [view, setView] = useState<ModelStatusView | null>(() =>
    source ? CHECKING_MODEL : null,
  )
  useEffect(() => {
    if (!source) return
    let live = true
    const refresh = () => {
      source.status().then(
        (next) => {
          if (live) setView(next)
        },
        () => {
          if (live) setView(HOST_ERROR_STATUS)
        },
      )
    }
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [source])
  return view
}
