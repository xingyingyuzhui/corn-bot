import { Dialog } from '../../shared/Dialog.tsx'

export interface BotProfileDialogProps {
  readonly botId: string
  readonly onClose: () => void
}

/** Placeholder until the owning PR-02B slice lands. */
export function BotProfileDialog(props: BotProfileDialogProps) {
  return (
    <Dialog title="编辑资料" onClose={props.onClose}>
      <p>正在开发。</p>
    </Dialog>
  )
}
