import { Dialog } from '../../shared/Dialog.tsx'

export interface ConnectAppsDialogProps {
  readonly onClose: () => void
}

/** Placeholder until the owning PR-02B slice lands. */
export function ConnectAppsDialog(props: ConnectAppsDialogProps) {
  return (
    <Dialog title="连接应用" onClose={props.onClose}>
      <p>正在开发。</p>
    </Dialog>
  )
}
