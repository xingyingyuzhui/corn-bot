import type { SettingsSection } from '../../app/layout-state.ts'
import { Dialog } from '../../shared/Dialog.tsx'

export interface SettingsDialogProps {
  readonly section: SettingsSection
  readonly onSection: (section: SettingsSection) => void
  readonly onClose: () => void
}

/** Placeholder until the owning PR-02B slice lands. */
export function SettingsDialog(props: SettingsDialogProps) {
  return (
    <Dialog title="设置" onClose={props.onClose}>
      <p>正在开发。</p>
    </Dialog>
  )
}
