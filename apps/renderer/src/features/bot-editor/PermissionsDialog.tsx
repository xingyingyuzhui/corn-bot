import { Dialog } from '../../shared/Dialog.tsx'

export interface PermissionsDialogProps {
  readonly botId: string
  readonly onClose: () => void
}

/** Placeholder until the owning PR-02B slice lands. */
export function PermissionsDialog(props: PermissionsDialogProps) {
  return (
    <Dialog title="权限" onClose={props.onClose}>
      <p>正在开发。</p>
    </Dialog>
  )
}
