import { AlertCircle, LoaderCircle } from 'lucide-react'
import type {
  RuntimeNoticeView,
  RuntimeTone,
} from '../../app/runtime-notice.ts'

interface RuntimeNoticeProps {
  /** The sample-data marker, or `null` for a live source. */
  readonly sample: string | null
  readonly runtime: RuntimeNoticeView
}

/**
 * Fixed strip between the feed and the composer, in normal flow, so neither
 * fact can scroll away or cover a message. Silent: `RuntimeAnnouncer` owns the
 * announcements.
 */
export function RuntimeNotice({ sample, runtime }: RuntimeNoticeProps) {
  return (
    <div className="corn-runtime-notice">
      {sample ? <p className="corn-runtime-notice__item">{sample}</p> : null}
      <p
        className="corn-runtime-notice__item"
        data-tone={runtime.tone}
        data-runtime-status={runtime.status}
      >
        <ToneIcon tone={runtime.tone} />
        {runtime.text}
      </p>
    </div>
  )
}

function ToneIcon({ tone }: { readonly tone: RuntimeTone }) {
  switch (tone) {
    case 'busy':
      return (
        <LoaderCircle
          className="corn-runtime-notice__spin"
          size={12}
          strokeWidth={2}
          aria-hidden
        />
      )
    case 'error':
      return <AlertCircle size={12} strokeWidth={2} aria-hidden />
    case 'ok':
    case 'muted':
      return <span className="corn-runtime-notice__dot" aria-hidden />
    default: {
      const unreachable: never = tone
      throw new Error(`Unknown runtime tone ${String(unreachable)}`)
    }
  }
}
