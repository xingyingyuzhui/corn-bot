import type { Dispatch } from 'react'
import { BotProfileDialog } from '../features/bot-editor/BotProfileDialog.tsx'
import { CreateBotDialog } from '../features/bot-editor/CreateBotDialog.tsx'
import { ShareExportDialog } from '../features/bot-editor/ShareExportDialog.tsx'
import { TagEditorDialog } from '../features/bot-editor/TagEditorDialog.tsx'
import { ConnectAppsDialog } from '../features/connect-apps/ConnectAppsDialog.tsx'
import type { ConfigDraftRegistry } from '../features/details/configuration/config-drafts.ts'
import { UnsavedConfigDialog } from '../features/details/configuration/UnsavedConfigDialog.tsx'
import { SettingsDialog } from '../features/settings/SettingsDialog.tsx'
import type { LayoutAction, Overlay } from './layout-state.ts'

interface OverlayHostProps {
  readonly overlay: Overlay | null
  readonly dispatch: Dispatch<LayoutAction>
  readonly drafts: ConfigDraftRegistry
}

/** Renders the single open overlay; features never mount modals themselves. */
export function OverlayHost({ overlay, dispatch, drafts }: OverlayHostProps) {
  if (!overlay) return null
  const close = () => dispatch({ type: 'close-overlay', overlay })
  switch (overlay.kind) {
    case 'create-bot':
      return (
        <CreateBotDialog
          onClose={close}
          onCreated={(botId) =>
            dispatch({ type: 'bot-created', overlay, botId })
          }
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
    case 'share-export':
      return <ShareExportDialog botId={overlay.botId} onClose={close} />
    case 'unsaved-config':
      return (
        <UnsavedConfigDialog
          overlay={overlay}
          drafts={drafts}
          onResolve={(leave) =>
            dispatch({ type: 'resolve-unsaved-config', overlay, leave })
          }
        />
      )
    default: {
      const unreachable: never = overlay
      throw new Error(`Unknown overlay ${JSON.stringify(unreachable)}`)
    }
  }
}
