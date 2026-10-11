import { Dialog } from '../../shared/Dialog.tsx'

export interface ShareExportDialogProps {
  readonly botId: string
  readonly onClose: () => void
}

/** Placeholder until the owning PR-02B slice lands. */
export function ShareExportDialog(props: ShareExportDialogProps) {
  return (
    <Dialog title="导出受限配置" onClose={props.onClose}>
      <p>正在开发。</p>
    </Dialog>
  )
}
