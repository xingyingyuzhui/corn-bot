import {
  type CSSProperties,
  useEffect,
  useReducer,
  useSyncExternalStore,
} from 'react'
import { ChatPane } from '../features/chat/ChatPane.tsx'
import { BotDetailsPane } from '../features/details/BotDetailsPane.tsx'
import { BotRoster } from '../features/roster/BotRoster.tsx'
import {
  rosterFilterFor,
  visibleBotOrder,
} from '../features/roster/roster-order.ts'
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
import {
  type RuntimeReading,
  runtimeNotice,
  sampleNotice,
} from './runtime-notice.ts'
import { useShellShortcuts } from './use-shell-shortcuts.ts'
import { useRepository, useWorkspace } from './workspace-context.tsx'

const subscribeViewport = (notify: () => void) => {
  window.addEventListener('resize', notify)
  return () => window.removeEventListener('resize', notify)
}
const viewportWidth = () => window.innerWidth
const VOICE_FIXTURE =
  parseFixtureRoute(window.location.hash, import.meta.env.DEV) === 'ui-states'

interface CornShellProps {
  readonly runtime: RuntimeReading
}

export function CornShell({ runtime }: CornShellProps) {
  const repository = useRepository()
  const workspace = useWorkspace()
  const [state, dispatch] = useReducer(
    layoutReducer,
    repository.initialBotId,
    (botId) => initialLayout(botId, window.innerWidth),
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
  const collapsed = layout.sidebar === 'collapsed'
  const rosterFilter = rosterFilterFor(
    collapsed,
    state.foldedGroupIds,
    state.rosterSearch?.query,
  )
  useShellShortcuts({
    state,
    dispatch,
    botId: bot.id,
    sidebarCollapsed: collapsed,
    visibleOrder: visibleBotOrder(roster, rosterFilter),
  })
  const openOverlay = (overlay: Overlay) =>
    dispatch({ type: 'open-overlay', overlay })
  return (
    <div
      className="corn-shell"
      data-sidebar={layout.sidebar}
      data-details={layout.details}
      style={
        { '--corn-roster-width': `${layout.sidebarWidth}px` } as CSSProperties
      }
    >
      <BotRoster
        roster={roster}
        selectedBotId={bot.id}
        layout={state}
        filter={rosterFilter}
        collapsed={collapsed}
        width={layout.sidebarWidth}
        dispatch={dispatch}
      />
      <ChatPane
        bot={bot}
        bots={roster.bots}
        conversation={conversation}
        sample={sampleNotice(repository.label)}
        runtime={runtimeNotice(runtime)}
        draft={draftFor(state, bot.id)}
        scroll={state.scroll[bot.id]}
        detailsOpen={state.detailsOpen}
        sidebarCollapsed={collapsed}
        voiceFixture={VOICE_FIXTURE}
        onDraft={(draft) =>
          dispatch({ type: 'edit-draft', botId: bot.id, draft })
        }
        onSendSettled={(botId, sent) =>
          dispatch({ type: 'settle-sent-draft', botId, sent })
        }
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
