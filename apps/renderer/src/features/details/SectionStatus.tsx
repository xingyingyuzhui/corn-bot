import { AlertCircle, LoaderCircle } from 'lucide-react'
import type { SectionState } from './section-state.ts'

/** One read state per section: not connected, loading, empty or failed. */
export function SectionStatus({ state }: { readonly state: SectionState }) {
  switch (state.kind) {
    case 'unavailable':
      return (
        <p className="corn-details__status" data-kind="unavailable">
          <span className="corn-details__status-label">尚未接通</span>
          {state.reason}
        </p>
      )
    case 'loading':
      return (
        <p className="corn-details__status" data-kind="loading" role="status">
          <LoaderCircle size={14} strokeWidth={2} aria-hidden />
          正在加载…
        </p>
      )
    case 'empty':
      return (
        <p className="corn-details__status" data-kind="empty">
          {state.text}
        </p>
      )
    case 'error':
      return (
        <p className="corn-details__status" data-kind="error" role="alert">
          <AlertCircle size={14} strokeWidth={2} aria-hidden />
          {state.reason}
        </p>
      )
    default: {
      const unreachable: never = state
      throw new Error(`Unknown section state ${JSON.stringify(unreachable)}`)
    }
  }
}
