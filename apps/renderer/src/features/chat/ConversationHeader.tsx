import type { BotView } from '../../model/workspace.ts'
import { Avatar } from '../../shared/Avatar.tsx'

interface ConversationHeaderProps {
  readonly bot: BotView
  readonly detailsOpen: boolean
  readonly onToggleDetails: () => void
}

/** The Bot pill doubles as the details toggle, as in the reference shell. */
export function ConversationHeader({
  bot,
  detailsOpen,
  onToggleDetails,
}: ConversationHeaderProps) {
  return (
    <h1 className="corn-chat__heading">
      <button
        type="button"
        className="corn-chat__title"
        aria-expanded={detailsOpen}
        aria-controls="corn-bot-details"
        title={detailsOpen ? '隐藏详情' : '显示详情'}
        onClick={onToggleDetails}
      >
        <Avatar spec={bot.avatar} size={24} />
        <span>{bot.name}</span>
      </button>
    </h1>
  )
}
