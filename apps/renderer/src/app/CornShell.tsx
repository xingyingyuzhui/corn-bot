import type { ModelStatusView } from '@corn-bot/contracts/model-settings'
import {
  type CSSProperties,
  useEffect,
  useReducer,
  useState,
  useSyncExternalStore,
} from 'react'
import { ChatPane } from '../features/chat/ChatPane.tsx'
import { BotDetailsPane } from '../features/details/BotDetailsPane.tsx'
import { ConfigDraftRegistry } from '../features/details/configuration/config-drafts.ts'
import { BotRoster } from '../features/roster/BotRoster.tsx'
import {
  rosterFilterFor,
  visibleBotOrder,
} from '../features/roster/roster-order.ts'
import { parseFixtureRoute } from '../fixtures/routes.ts'
import {
  draftFor,
  initialLayout,
  layoutReducer,
  resolveLayout,
} from './layout-state.ts'
import { OverlayHost } from './OverlayHost.tsx'
import {
  modelNotice,
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
  readonly model: ModelStatusView | null
}

export function CornShell({ runtime, model }: CornShellProps) {
  const repository = useRepository()
  const workspace = useWorkspace()
  const [state, dispatch] = useReducer(
    layoutReducer,
    repository.initialBotId,
    (botId) => initialLayout(botId, window.innerWidth),
  )
  const [configDrafts] = useState(() => new ConfigDraftRegistry())
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
        model={modelNotice(runtime, model)}
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
        onOpenPermissions={() =>
          dispatch({
            type: 'open-details-entry',
            botId: bot.id,
            entry: 'permissions',
          })
        }
        onConfigureModel={() =>
          dispatch({
            type: 'open-overlay',
            overlay: { kind: 'settings', section: 'models' },
          })
        }
      />
      {layout.details === 'closed' ? null : (
        <BotDetailsPane
          bot={bot}
          layout={state}
          dispatch={dispatch}
          drafts={configDrafts}
        />
      )}
      <OverlayHost
        overlay={state.overlay}
        dispatch={dispatch}
        drafts={configDrafts}
      />
    </div>
  )
}
