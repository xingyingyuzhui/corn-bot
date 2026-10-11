import { AlertCircle, LoaderCircle } from 'lucide-react'
import type { RuntimeTone } from '../../app/runtime-notice.ts'

/** Leading mark for a runtime-strip line. */
export function ToneIcon({ tone }: { readonly tone: RuntimeTone }) {
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
