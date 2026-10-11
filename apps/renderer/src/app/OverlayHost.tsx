import type { Dispatch } from 'react'
import { BotModelDialog } from '../features/bot-editor/BotModelDialog.tsx'
import { BotProfileDialog } from '../features/bot-editor/BotProfileDialog.tsx'
import { CreateBotDialog } from '../features/bot-editor/CreateBotDialog.tsx'
import { PermissionsDialog } from '../features/bot-editor/PermissionsDialog.tsx'
import { ShareExportDialog } from '../features/bot-editor/ShareExportDialog.tsx'
import { TagEditorDialog } from '../features/bot-editor/TagEditorDialog.tsx'
import { ConnectAppsDialog } from '../features/connect-apps/ConnectAppsDialog.tsx'
import { SettingsDialog } from '../features/settings/SettingsDialog.tsx'
import type { LayoutAction, Overlay } from './layout-state.ts'

interface OverlayHostProps {
  readonly overlay: Overlay | null
  readonly dispatch: Dispatch<LayoutAction>
}

/** Renders the single open overlay; features never mount modals themselves. */
export function OverlayHost({ overlay, dispatch }: OverlayHostProps) {
  if (!overlay) return null
  const close = () => dispatch({ type: 'close-overlay', overlay })
  switch (overlay.kind) {
    case 'create-bot':
      return (
        <CreateBotDialog
          onClose={close}
          onCreated={(botId) => {
            close()
            dispatch({ type: 'select-bot', botId })
          }}
        />
      )
    case 'connect-apps':
      return <ConnectAppsDialog onClose={close} />
    case 'settings':
      return (
        <SettingsDialog
          section={overlay.section}
          onSection={(section) =>
            dispatch({
              type: 'open-overlay',
              overlay: { kind: 'settings', section },
            })
          }
          onClose={close}
        />
      )
    case 'bot-profile':
      return <BotProfileDialog botId={overlay.botId} onClose={close} />
    case 'bot-tags':
      return <TagEditorDialog botId={overlay.botId} onClose={close} />
    case 'bot-permissions':
      return <PermissionsDialog botId={overlay.botId} onClose={close} />
    case 'bot-model':
      return (
        <BotModelDialog
          botId={overlay.botId}
          onClose={close}
          onOpenSettings={() =>
            dispatch({
              type: 'open-overlay',
              overlay: { kind: 'settings', section: 'models' },
            })
          }
        />
      )
    case 'share-export':
      return <ShareExportDialog botId={overlay.botId} onClose={close} />
    default: {
      const unreachable: never = overlay
      throw new Error(`Unknown overlay ${JSON.stringify(unreachable)}`)
    }
  }
}
