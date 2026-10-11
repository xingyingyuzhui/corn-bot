import { TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../../shared/Button.tsx'
import { Dialog } from '../../shared/Dialog.tsx'
import './editor-dialogs.css'

export function MissingBotDialog({
  title,
  onClose,
}: {
  readonly title: string
  readonly onClose: () => void
}) {
  return (
    <Dialog
      title={title}
      description="找不到这个 Bot，它可能已被移除。"
      size="sm"
      onClose={onClose}
      actions={
        <Button variant="primary" onClick={onClose}>
          关闭
        </Button>
      }
    >
      {null}
    </Dialog>
  )
}

/** Inline warning box; `alert` is for results the user just caused. */
export function EditorWarning({
  children,
  live = false,
}: {
  readonly children: ReactNode
  readonly live?: boolean
}) {
  return (
    <div className="corn-editor__warning" role={live ? 'alert' : undefined}>
      <TriangleAlert size={15} strokeWidth={2} aria-hidden />
      <div className="corn-editor__warning-body">{children}</div>
    </div>
  )
}

/** Revision conflict: the stored values changed since this editor opened. */
export function ConflictNotice({
  onReload,
}: {
  readonly onReload: () => void
}) {
  return (
    <EditorWarning live>
      <p className="corn-editor__warning-text">
        资料已在别处更新。载入最新内容后再修改，你在这里的改动会被替换。
      </p>
      <Button onClick={onReload}>载入最新内容</Button>
    </EditorWarning>
  )
}

export function FormError({ message }: { readonly message: string | null }) {
  return message ? (
    <p className="corn-editor__error" role="alert">
      {message}
    </p>
  ) : null
}
