import type { RuntimeView } from '@corn-bot/contracts'
import { useEffect, useReducer, useSyncExternalStore } from 'react'
import { ChatPane } from '../features/chat/ChatPane.tsx'
import { BotDetailsPane } from '../features/details/BotDetailsPane.tsx'
import { BotRoster } from '../features/roster/BotRoster.tsx'
import { parseFixtureRoute } from '../fixtures/routes.ts'
import {
  detailsTabFor,
  draftFor,
  initialLayout,
  layoutReducer,
  type Overlay,
  resolveLayout,
} from './layout-state.ts'
import { OverlayHost } from './OverlayHost.tsx'
import { useRepository, useWorkspace } from './workspace-context.tsx'

const subscribeViewport = (notify: () => void) => {
  window.addEventListener('resize', notify)
  return () => window.removeEventListener('resize', notify)
}
const viewportWidth = () => window.innerWidth
const VOICE_FIXTURE =
  parseFixtureRoute(window.location.hash, import.meta.env.DEV) === 'ui-states'

interface CornShellProps {
  readonly runtime: RuntimeView | null
}

export function CornShell({ runtime }: CornShellProps) {
  const repository = useRepository()
  const workspace = useWorkspace()
  const [state, dispatch] = useReducer(
    layoutReducer,
    repository.initialBotId,
    initialLayout,
  )
  const width = useSyncExternalStore(subscribeViewport, viewportWidth)
  useEffect(() => dispatch({ type: 'viewport', width }), [width])

  const { roster } = workspace
  const bot =
    roster.bots[state.selectedBotId] ?? roster.bots[repository.initialBotId]
  if (!bot) throw new Error('Workspace has no selectable Bot')
  const conversation = workspace.conversations[bot.id] ?? {
    botId: bot.id,
    state: 'ready' as const,
    readOnly: false,
    items: [],
  }
  const layout = resolveLayout(state, width)
  const openOverlay = (overlay: Overlay) =>
    dispatch({ type: 'open-overlay', overlay })
  const notice = [
    repository.label === 'fixture' ? '示例数据，未连接真实 Bot' : null,
    runtime ? runtime.message : '运行时不可用',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className="corn-shell"
      data-sidebar={layout.sidebar}
      data-details={layout.details}
    >
      <BotRoster
        roster={roster}
        selectedBotId={bot.id}
        onSelect={(botId) => dispatch({ type: 'select-bot', botId })}
        onOpenOverlay={openOverlay}
      />
      <ChatPane
        bot={bot}
        bots={roster.bots}
        conversation={conversation}
        notice={notice}
        draft={draftFor(state, bot.id)}
        scroll={state.scroll[bot.id]}
        detailsOpen={state.detailsOpen}
        sidebarCollapsed={layout.sidebar === 'collapsed'}
        voiceFixture={VOICE_FIXTURE}
        onDraft={(draft) => dispatch({ type: 'edit-draft', draft })}
        onScroll={(scroll) => dispatch({ type: 'record-scroll', scroll })}
        onToggleDetails={() =>
          dispatch({
            type: state.detailsOpen ? 'close-details' : 'open-details',
          })
        }
        onToggleSidebar={() => dispatch({ type: 'toggle-sidebar' })}
        onOpenOverlay={openOverlay}
      />
      {layout.details === 'closed' ? null : (
        <BotDetailsPane
          bot={bot}
          tab={detailsTabFor(state, bot.id)}
          onSelectTab={(tab) => dispatch({ type: 'select-tab', tab })}
          onClose={() => dispatch({ type: 'close-details' })}
          onOpenOverlay={openOverlay}
        />
      )}
      <OverlayHost overlay={state.overlay} dispatch={dispatch} />
    </div>
  )
}
