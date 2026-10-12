import type { ModelNoticeView } from '../../app/runtime-notice.ts'
import { ToneIcon } from '../chat/ToneIcon.tsx'

interface ModelSetupNoticeProps {
  /** `null` until the runtime is ready. */
  readonly notice: ModelNoticeView | null
  readonly onConfigure: () => void
}

/**
 * The model line of the chat strip, beside the runtime line: hidden once a
 * model is configured, quiet while checking, otherwise a way into Settings.
 */
export function ModelSetupNotice({
  notice,
  onConfigure,
}: ModelSetupNoticeProps) {
  if (!notice || notice.status === 'available') return null
  return (
    <p
      className="corn-runtime-notice__item"
      data-tone={notice.tone}
      data-model-status={notice.status}
    >
      <ToneIcon tone={notice.tone} />
      {notice.text}
      {notice.status === 'checking' ? null : (
        <button
          type="button"
          className="corn-runtime-notice__action"
          onClick={onConfigure}
        >
          配置模型
        </button>
      )}
    </p>
  )
}
