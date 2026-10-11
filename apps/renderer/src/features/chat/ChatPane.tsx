import { PanelLeft } from 'lucide-react'
import type { ChatScroll, ComposerDraft } from '../../app/layout-state.ts'
import type { BotView, ConversationView } from '../../model/workspace.ts'
import { ActionButton } from '../../shared/ActionButton.tsx'
import { ConversationHeader } from './ConversationHeader.tsx'
import { MessageComposer } from './MessageComposer.tsx'
import { MessageFeed } from './MessageFeed.tsx'
import './chat.css'

interface ChatPaneProps {
  readonly bot: BotView
  readonly bots: Readonly<Record<string, BotView>>
  readonly conversation: ConversationView
  readonly notice: string
  readonly draft: ComposerDraft
  readonly scroll: ChatScroll | undefined
  readonly detailsOpen: boolean
  readonly sidebarCollapsed: boolean
  readonly onDraft: (draft: ComposerDraft) => void
  readonly onScroll: (scroll: ChatScroll) => void
  readonly onToggleDetails: () => void
  readonly onToggleSidebar: () => void
}

export function ChatPane(props: ChatPaneProps) {
  const { bot } = props
  return (
    <main className="corn-chat" aria-label={`与 ${bot.name} 的对话`}>
      <header className="corn-chat__titlebar corn-drag">
        {props.sidebarCollapsed ? (
          <ActionButton
            className="corn-round-button corn-chat__sidebar-toggle"
            label="显示名册"
            onPress={props.onToggleSidebar}
          >
            <PanelLeft size={16} strokeWidth={2} aria-hidden />
          </ActionButton>
        ) : null}
        <ConversationHeader
          bot={bot}
          detailsOpen={props.detailsOpen}
          onToggleDetails={props.onToggleDetails}
        />
      </header>
      <MessageFeed
        key={bot.id}
        bots={props.bots}
        items={props.conversation.items}
        notice={props.notice}
        initialScroll={props.scroll}
        onScroll={props.onScroll}
      />
      <MessageComposer
        botName={bot.name}
        draft={props.draft}
        onDraft={props.onDraft}
      />
    </main>
  )
}
