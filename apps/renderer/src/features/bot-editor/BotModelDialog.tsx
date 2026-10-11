import { Dialog } from '../../shared/Dialog.tsx'

export interface BotModelDialogProps {
  readonly botId: string
  readonly onClose: () => void
  readonly onOpenSettings: () => void
}

/** Placeholder until the owning PR-02B slice lands. */
export function BotModelDialog(props: BotModelDialogProps) {
  return (
    <Dialog title="模型" onClose={props.onClose}>
      <p>正在开发。</p>
    </Dialog>
  )
}
