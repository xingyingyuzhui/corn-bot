import type { BotView } from '../../model/workspace.ts'
import { Avatar } from '../../shared/Avatar.tsx'

interface BotListItemProps {
  readonly bot: BotView
  readonly selected: boolean
  readonly onSelect: (botId: string) => void
}

export function BotListItem({ bot, selected, onSelect }: BotListItemProps) {
  return (
    <button
      type="button"
      className="corn-bot-row"
      aria-current={selected ? 'page' : undefined}
      onClick={() => onSelect(bot.id)}
    >
      <Avatar spec={bot.avatar} size={32} />
      <span className="corn-bot-row__text">
        <span className="corn-bot-row__name">{bot.name}</span>
        <span className="corn-bot-row__summary">{bot.summary}</span>
      </span>
    </button>
  )
}
