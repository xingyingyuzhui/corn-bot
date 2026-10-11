import { ArrowUp, AudioLines, Mic, Plus } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import { ActionButton } from '../../shared/ActionButton.tsx'
import { UNAVAILABLE } from '../../shared/unavailable.ts'

const MAX_ROWS_HEIGHT = 160

interface MessageComposerProps {
  readonly botName: string
  readonly draft: string
  readonly onDraft: (text: string) => void
}

/**
 * Structure only in PR-02A: the draft is kept per Bot. Send, IME and
 * attachment behaviour arrive with the composer rewrite in PR-02B.
 */
export function MessageComposer({
  botName,
  draft,
  onDraft,
}: MessageComposerProps) {
  const field = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.style.blockSize = 'auto'
    element.style.blockSize = `${Math.min(element.scrollHeight, MAX_ROWS_HEIGHT)}px`
  })

  const hasText = draft.trim().length > 0
  return (
    <div className="corn-composer">
      <ActionButton
        className="corn-composer__action"
        label="添加附件"
        unavailable={UNAVAILABLE.attach}
      >
        <Plus size={18} strokeWidth={2} aria-hidden />
      </ActionButton>
      <textarea
        ref={field}
        className="corn-composer__field"
        rows={1}
        value={draft}
        placeholder={`给 ${botName} 发消息`}
        aria-label={`给 ${botName} 发消息`}
        onChange={(event) => onDraft(event.target.value)}
      />
      <ActionButton
        className="corn-composer__action"
        label="语音听写"
        unavailable={UNAVAILABLE.dictation}
      >
        <Mic size={16} strokeWidth={2} aria-hidden />
      </ActionButton>
      {hasText ? (
        <ActionButton
          className="corn-composer__action corn-composer__action--strong"
          label="发送"
          unavailable={UNAVAILABLE.send}
        >
          <ArrowUp size={16} strokeWidth={2.4} aria-hidden />
        </ActionButton>
      ) : (
        <ActionButton
          className="corn-composer__action corn-composer__action--strong"
          label="实时语音"
          unavailable={UNAVAILABLE.voiceMode}
        >
          <AudioLines size={16} strokeWidth={2.2} aria-hidden />
        </ActionButton>
      )}
    </div>
  )
}
