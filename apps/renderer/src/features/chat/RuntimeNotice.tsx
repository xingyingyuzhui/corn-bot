import type {
  ModelNoticeView,
  RuntimeNoticeView,
} from '../../app/runtime-notice.ts'
import { ModelSetupNotice } from '../settings/ModelSetupNotice.tsx'
import { ToneIcon } from './ToneIcon.tsx'

interface RuntimeNoticeProps {
  /** The sample-data marker, or `null` for a live source. */
  readonly sample: string | null
  readonly runtime: RuntimeNoticeView
  readonly model: ModelNoticeView | null
  readonly onConfigureModel: () => void
}

/**
 * Fixed strip between the feed and the composer, in normal flow, so neither
 * fact can scroll away or cover a message. Silent: `RuntimeAnnouncer` owns the
 * announcements.
 */
export function RuntimeNotice({
  sample,
  runtime,
  model,
  onConfigureModel,
}: RuntimeNoticeProps) {
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
      <ModelSetupNotice notice={model} onConfigure={onConfigureModel} />
    </div>
  )
}
