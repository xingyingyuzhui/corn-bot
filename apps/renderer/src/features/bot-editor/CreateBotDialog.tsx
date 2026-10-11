import { Dialog } from '../../shared/Dialog.tsx'

export interface CreateBotDialogProps {
  readonly onClose: () => void
  readonly onCreated: (botId: string) => void
}

/** Placeholder until the owning PR-02B slice lands. */
export function CreateBotDialog(props: CreateBotDialogProps) {
  return (
    <Dialog title="新建 Bot" onClose={props.onClose}>
      <p>正在开发。</p>
    </Dialog>
  )
}
