import { Copy } from 'lucide-react'
import type { AttachmentView, DeliveryState } from '../../model/workspace.ts'
import { useNotice } from '../../shared/notice.tsx'
import { AttachmentChips } from './AttachmentChips.tsx'
import { DeliveryStatus } from './DeliveryStatus.tsx'

interface MessageBubbleProps {
  readonly botId: string
  readonly id: string
  readonly author: 'user' | 'bot'
  readonly paragraphs: readonly string[]
  readonly attachments: readonly AttachmentView[] | undefined
  readonly delivery: DeliveryState | undefined
  readonly failure: string | undefined
}

export function MessageBubble({
  botId,
  id,
  author,
  paragraphs,
  attachments,
  delivery,
  failure,
}: MessageBubbleProps) {
  const notify = useNotice()
  const text = paragraphs.join('\n\n')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      notify('已复制')
    } catch {
      notify('复制失败，请手动选择文字')
    }
  }
  return (
    <div className="corn-message" data-author={author}>
      <div className="corn-bubble" data-author={author} data-selectable>
        {paragraphs.map((paragraph, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs are immutable and may repeat
          <p key={index}>{paragraph}</p>
        ))}
        {attachments ? <AttachmentChips attachments={attachments} /> : null}
        {text ? (
          <button
            type="button"
            className="corn-message__copy"
            aria-label="复制消息"
            title="复制"
            onClick={() => void copy()}
          >
            <Copy size={13} strokeWidth={2} aria-hidden />
          </button>
        ) : null}
      </div>
      {author === 'user' && delivery ? (
        <DeliveryStatus
          botId={botId}
          messageId={id}
          delivery={delivery}
          failure={failure}
        />
      ) : null}
    </div>
  )
}
