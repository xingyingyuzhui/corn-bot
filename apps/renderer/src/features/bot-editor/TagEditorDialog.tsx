import { Dialog } from '../../shared/Dialog.tsx'

export interface TagEditorDialogProps {
  readonly botId: string
  readonly onClose: () => void
}

/** Placeholder until the owning PR-02B slice lands. */
export function TagEditorDialog(props: TagEditorDialogProps) {
  return (
    <Dialog title="标签" onClose={props.onClose}>
      <p>正在开发。</p>
    </Dialog>
  )
}
