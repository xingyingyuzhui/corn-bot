import { Ellipsis, Star } from 'lucide-react'
import { useRef } from 'react'
import type { Overlay } from '../../app/layout-state.ts'
import type { BotView } from '../../model/workspace.ts'
import { Avatar } from '../../shared/Avatar.tsx'
import { Menu, type MenuHandle } from '../../shared/Menu.tsx'
import { BotOriginBadge } from './BotOriginBadge.tsx'
import { contextMenuHandlers } from './context-menu.ts'
import { useBotMenu } from './use-bot-menu.ts'

interface PinnedBotCardProps {
  readonly bot: BotView
  readonly selected: boolean
  readonly onSelect: (botId: string) => void
  readonly onOpenOverlay: (overlay: Overlay) => void
}

export function PinnedBotCard({
  bot,
  selected,
  onSelect,
  onOpenOverlay,
}: PinnedBotCardProps) {
  const menu = useRef<MenuHandle>(null)
  const items = useBotMenu(bot, onOpenOverlay)
  return (
    <div className="corn-pinned-slot">
      <button
        type="button"
        className="corn-pinned"
        aria-current={selected ? 'page' : undefined}
        onClick={() => onSelect(bot.id)}
        {...contextMenuHandlers(menu)}
      >
        <span className="corn-pinned__avatar">
          <Avatar spec={bot.avatar} size={52} />
          <span className="corn-pinned__badge" aria-hidden>
            <Star size={8} strokeWidth={0} fill="currentColor" />
          </span>
          {bot.unread ? <span className="corn-pinned__unread" /> : null}
        </span>
        <span className="corn-pinned__name">{bot.name}</span>
        <span className="corn-visually-hidden">
          （置顶{bot.unread ? '，有未读消息' : ''}）
        </span>
        <BotOriginBadge origin={bot.origin} />
      </button>
      <Menu
        ref={menu}
        label={`${bot.name}的更多操作`}
        items={items}
        triggerClassName="corn-row-menu-trigger corn-pinned-slot__menu"
        trigger={<Ellipsis size={14} strokeWidth={2} aria-hidden />}
      />
    </div>
  )
}
