import type { RuntimeView } from '@corn-bot/contracts'
import { useEffect, useReducer, useSyncExternalStore } from 'react'
import { ChatPane } from '../features/chat/ChatPane.tsx'
import { BotDetailsPane } from '../features/details/BotDetailsPane.tsx'
import { BotRoster } from '../features/roster/BotRoster.tsx'
import type { WorkspaceSource } from '../model/workspace.ts'
import {
  detailsTabFor,
  initialLayout,
  layoutReducer,
  resolveLayout,
} from './layout-state.ts'

const subscribeViewport = (notify: () => void) => {
  window.addEventListener('resize', notify)
  return () => window.removeEventListener('resize', notify)
}
const viewportWidth = () => window.innerWidth

interface CornShellProps {
  readonly source: WorkspaceSource
  readonly runtime: RuntimeView | null
}

export function CornShell({ source, runtime }: CornShellProps) {
  const [state, dispatch] = useReducer(
    layoutReducer,
    source.initialBotId,
    initialLayout,
  )
  const width = useSyncExternalStore(subscribeViewport, viewportWidth)
  useEffect(() => dispatch({ type: 'viewport', width }), [width])

  const { bots } = source.roster
  const bot = bots[state.selectedBotId] ?? bots[source.initialBotId]
  if (!bot) throw new Error('Workspace has no selectable Bot')
  const layout = resolveLayout(state, width)
  const notice = [
    source.label === 'fixture' ? '示例数据，未连接真实 Bot' : null,
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
        roster={source.roster}
        selectedBotId={bot.id}
        onSelect={(botId) => dispatch({ type: 'select-bot', botId })}
      />
      <ChatPane
        bot={bot}
        bots={bots}
        items={source.conversation(bot.id)}
        notice={notice}
        draft={state.drafts[bot.id] ?? ''}
        scroll={state.scroll[bot.id]}
        detailsOpen={state.detailsOpen}
        sidebarCollapsed={layout.sidebar === 'collapsed'}
        onDraft={(text) => dispatch({ type: 'edit-draft', text })}
        onScroll={(scroll) => dispatch({ type: 'record-scroll', scroll })}
        onToggleDetails={() =>
          dispatch({
            type: state.detailsOpen ? 'close-details' : 'open-details',
          })
        }
        onToggleSidebar={() => dispatch({ type: 'toggle-sidebar' })}
      />
      {layout.details === 'closed' ? null : (
        <BotDetailsPane
          bot={bot}
          tab={detailsTabFor(state, bot.id)}
          onSelectTab={(tab) => dispatch({ type: 'select-tab', tab })}
          onClose={() => dispatch({ type: 'close-details' })}
        />
      )}
    </div>
  )
}
