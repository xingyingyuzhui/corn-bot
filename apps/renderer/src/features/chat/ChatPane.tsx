import { PanelLeft } from 'lucide-react'
import { useState } from 'react'
import type {
  ChatScroll,
  ComposerDraft,
  Overlay,
} from '../../app/layout-state.ts'
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
  /** Dev `ui-states` route only: shows the simulated dictation states. */
  readonly voiceFixture: boolean
  readonly onDraft: (draft: ComposerDraft) => void
  readonly onScroll: (scroll: ChatScroll) => void
  readonly onToggleDetails: () => void
  readonly onToggleSidebar: () => void
  readonly onOpenOverlay: (overlay: Overlay) => void
}

const blockedReason = (conversation: ConversationView): string | null => {
  switch (conversation.state) {
    case 'ready':
      return null
    case 'loading':
      return '对话还在加载，暂时不能发送'
    case 'error':
      return '对话加载失败，暂时不能发送'
    default: {
      const unreachable: never = conversation.state
      throw new Error(`Unknown conversation state ${String(unreachable)}`)
    }
  }
}

export function ChatPane(props: ChatPaneProps) {
  const { bot, conversation } = props
  const [followToken, setFollowToken] = useState(0)
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
        conversation={conversation}
        notice={props.notice}
        initialScroll={props.scroll}
        followToken={followToken}
        onScroll={props.onScroll}
        onOpenPermissions={() =>
          props.onOpenOverlay({ kind: 'bot-permissions', botId: bot.id })
        }
      />
      <MessageComposer
        botId={bot.id}
        botName={bot.name}
        draft={props.draft}
        readOnly={conversation.readOnly}
        blockedReason={blockedReason(conversation)}
        voiceFixture={props.voiceFixture}
        onDraft={props.onDraft}
        onSent={() => setFollowToken((token) => token + 1)}
      />
    </main>
  )
}
