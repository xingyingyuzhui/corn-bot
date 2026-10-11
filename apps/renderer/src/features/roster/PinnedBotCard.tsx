import { Star } from 'lucide-react'
import type { BotView } from '../../model/workspace.ts'
import { Avatar } from '../../shared/Avatar.tsx'

interface PinnedBotCardProps {
  readonly bot: BotView
  readonly selected: boolean
  readonly onSelect: (botId: string) => void
}

export function PinnedBotCard({ bot, selected, onSelect }: PinnedBotCardProps) {
  return (
    <button
      type="button"
      className="corn-pinned"
      aria-current={selected ? 'page' : undefined}
      aria-label={`${bot.name}（置顶）`}
      onClick={() => onSelect(bot.id)}
    >
      <span className="corn-pinned__avatar">
        <Avatar spec={bot.avatar} size={52} />
        <span className="corn-pinned__badge" aria-hidden>
          <Star size={8} strokeWidth={0} fill="currentColor" />
        </span>
      </span>
      <span className="corn-pinned__name">{bot.name}</span>
    </button>
  )
}
