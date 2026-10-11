import { ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'
import { useRepository } from '../../app/workspace-context.tsx'
import type { BotView } from '../../model/workspace.ts'
import { Avatar } from '../../shared/Avatar.tsx'
import { BotOriginBadge } from '../../shared/BotOriginBadge.tsx'
import { useNotice } from '../../shared/notice.tsx'

interface HiddenBotsSectionProps {
  readonly bots: readonly BotView[]
  /** Searching opens the section so hidden matches are visible. */
  readonly forceOpen: boolean
}

/** Hidden Bots still exist; this is the only place to bring them back. */
export function HiddenBotsSection({ bots, forceOpen }: HiddenBotsSectionProps) {
  const repository = useRepository()
  const notify = useNotice()
  const [open, setOpen] = useState(false)
  const listId = useId()
  if (bots.length === 0) return null
  const expanded = open || forceOpen

  const restore = async (bot: BotView) => {
    const result = await repository.setHidden(bot.id, false)
    notify(result.ok ? `已恢复“${bot.name}”` : result.error.message)
  }

  return (
    <section className="corn-roster__group corn-roster__hidden">
      <h2 className="corn-roster__group-heading">
        <button
          type="button"
          className="corn-roster__group-toggle"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setOpen(!expanded)}
        >
          <ChevronRight
            className="corn-roster__chevron"
            size={12}
            strokeWidth={2.4}
            aria-hidden
          />
          已隐藏 ({bots.length})
        </button>
      </h2>
      <ul id={listId} className="corn-roster__list" hidden={!expanded}>
        {bots.map((bot) => (
          <li key={bot.id} className="corn-hidden-row">
            <Avatar spec={bot.avatar} size={24} />
            <span className="corn-hidden-row__name">{bot.name}</span>
            <BotOriginBadge origin={bot.origin} />
            <button
              type="button"
              className="corn-hidden-row__restore"
              aria-label={`恢复“${bot.name}”到名册`}
              onClick={() => void restore(bot)}
            >
              恢复
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
