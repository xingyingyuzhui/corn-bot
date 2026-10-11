import { Star } from 'lucide-react'
import type { BotView } from '../../model/workspace.ts'
import { Avatar } from '../../shared/Avatar.tsx'

interface RosterRailProps {
  readonly bots: readonly BotView[]
  readonly pinnedIds: ReadonlySet<string>
  readonly selectedBotId: string
  readonly onSelect: (botId: string) => void
}

/** Kit 88px compact sidebar: avatars only, pinned first, names as tooltips. */
export function RosterRail({
  bots,
  pinnedIds,
  selectedBotId,
  onSelect,
}: RosterRailProps) {
  return (
    <ul className="corn-rail" aria-label="Bot 列表">
      {bots.map((bot) => {
        const pinned = pinnedIds.has(bot.id)
        const notes = [
          pinned ? '置顶' : null,
          bot.origin === 'mock-created' ? '示例' : null,
          bot.unread ? '有未读消息' : null,
        ].filter(Boolean)
        return (
          <li key={bot.id}>
            <button
              type="button"
              className="corn-rail__bot"
              aria-current={bot.id === selectedBotId ? 'page' : undefined}
              aria-label={
                notes.length ? `${bot.name}（${notes.join('，')}）` : bot.name
              }
              title={bot.name}
              onClick={() => onSelect(bot.id)}
            >
              <Avatar spec={bot.avatar} size={36} />
              {pinned ? (
                <span className="corn-rail__pin" aria-hidden>
                  <Star size={7} strokeWidth={0} fill="currentColor" />
                </span>
              ) : null}
              {bot.unread ? <span className="corn-rail__unread" /> : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
