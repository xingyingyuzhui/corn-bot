import { Ellipsis } from 'lucide-react'
import { useRef } from 'react'
import type { Overlay } from '../../app/layout-state.ts'
import type { BotView } from '../../model/workspace.ts'
import { Avatar } from '../../shared/Avatar.tsx'
import { Menu, type MenuHandle } from '../../shared/Menu.tsx'
import { BotOriginBadge } from './BotOriginBadge.tsx'
import { contextMenuHandlers } from './context-menu.ts'
import { useBotMenu } from './use-bot-menu.ts'

interface BotListItemProps {
  readonly bot: BotView
  readonly selected: boolean
  readonly onSelect: (botId: string) => void
  readonly onOpenOverlay: (overlay: Overlay) => void
}

function activityText(bot: BotView): string {
  switch (bot.activity) {
    case 'working':
      return '正在工作…'
    case 'offline':
      return `离线 · ${bot.summary}`
    case 'idle':
      return bot.summary
    default: {
      const unreachable: never = bot.activity
      throw new Error(`Unknown activity ${String(unreachable)}`)
    }
  }
}

export function BotListItem({
  bot,
  selected,
  onSelect,
  onOpenOverlay,
}: BotListItemProps) {
  const menu = useRef<MenuHandle>(null)
  const items = useBotMenu(bot, onOpenOverlay)
  return (
    <div className="corn-bot-row" data-selected={selected || undefined}>
      <button
        type="button"
        className="corn-bot-row__select"
        aria-current={selected ? 'page' : undefined}
        onClick={() => onSelect(bot.id)}
        {...contextMenuHandlers(menu)}
      >
        <Avatar spec={bot.avatar} size={32} />
        <span className="corn-bot-row__text">
          <span className="corn-bot-row__title">
            <span className="corn-bot-row__name">{bot.name}</span>
            <BotOriginBadge origin={bot.origin} />
          </span>
          <span className="corn-bot-row__summary" data-activity={bot.activity}>
            {activityText(bot)}
          </span>
        </span>
        {bot.unread ? (
          <span className="corn-bot-row__unread">
            <span className="corn-visually-hidden">有未读消息</span>
          </span>
        ) : null}
      </button>
      <Menu
        ref={menu}
        label={`${bot.name}的更多操作`}
        items={items}
        triggerClassName="corn-row-menu-trigger"
        trigger={<Ellipsis size={16} strokeWidth={2} aria-hidden />}
      />
    </div>
  )
}
