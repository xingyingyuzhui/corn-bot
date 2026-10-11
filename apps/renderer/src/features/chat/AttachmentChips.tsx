import { Paperclip, X } from 'lucide-react'
import type { AttachmentView } from '../../model/workspace.ts'
import { formatBytes } from './composer-model.ts'

interface AttachmentChipsProps {
  readonly attachments: readonly AttachmentView[]
  /** Staged in the composer: chips can be removed. */
  readonly onRemove?: (id: string) => void
}

/** Files exist only on this Mac; every chip says they were not uploaded. */
export function AttachmentChips({
  attachments,
  onRemove,
}: AttachmentChipsProps) {
  if (attachments.length === 0) return null
  return (
    <ul
      className="corn-attachments"
      data-staged={onRemove ? true : undefined}
      aria-label={`附件 ${attachments.length} 个（未上传）`}
    >
      {attachments.map((file) => (
        <li key={file.id} className="corn-attachment">
          <Paperclip size={12} strokeWidth={2} aria-hidden />
          <span className="corn-attachment__name" title={file.name}>
            {file.name}
          </span>
          <span className="corn-attachment__meta">
            {formatBytes(file.size)} · 未上传
          </span>
          {onRemove ? (
            <button
              type="button"
              className="corn-attachment__remove"
              aria-label={`移除附件 ${file.name}`}
              onClick={() => onRemove(file.id)}
            >
              <X size={12} strokeWidth={2.2} aria-hidden />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
