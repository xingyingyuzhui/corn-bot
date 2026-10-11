import { Plus, Search } from 'lucide-react'
import type { RosterView } from '../../model/workspace.ts'
import { ActionButton } from '../../shared/ActionButton.tsx'
import { Avatar } from '../../shared/Avatar.tsx'
import { UNAVAILABLE } from '../../shared/unavailable.ts'
import { BotListItem } from './BotListItem.tsx'
import { PinnedBotCard } from './PinnedBotCard.tsx'
import './roster.css'

interface BotRosterProps {
  readonly roster: RosterView
  readonly selectedBotId: string
  readonly onSelect: (botId: string) => void
}

export function BotRoster({ roster, selectedBotId, onSelect }: BotRosterProps) {
  return (
    <nav className="corn-roster" aria-label="Bot 名册">
      <header className="corn-roster__titlebar corn-drag">
        <ActionButton
          className="corn-round-button"
          label="搜索"
          unavailable={UNAVAILABLE.search}
        >
          <Search size={16} strokeWidth={2} aria-hidden />
        </ActionButton>
        <ActionButton
          className="corn-round-button"
          label="新建 Bot"
          unavailable={UNAVAILABLE.createBot}
        >
          <Plus size={18} strokeWidth={2} aria-hidden />
        </ActionButton>
      </header>

      <div className="corn-roster__scroll">
        <div className="corn-roster__pinned">
          {roster.pinnedBotIds.map((id) => {
            const bot = roster.bots[id]
            return bot ? (
              <PinnedBotCard
                key={id}
                bot={bot}
                selected={id === selectedBotId}
                onSelect={onSelect}
              />
            ) : null
          })}
        </div>
        {roster.groups.map((group) => (
          <section
            key={group.id}
            className="corn-roster__group"
            aria-labelledby={`group-${group.id}`}
          >
            <h2 id={`group-${group.id}`} className="corn-roster__group-label">
              {group.label}
            </h2>
            <ul className="corn-roster__list">
              {group.botIds.map((id) => {
                const bot = roster.bots[id]
                return bot ? (
                  <li key={id}>
                    <BotListItem
                      bot={bot}
                      selected={id === selectedBotId}
                      onSelect={onSelect}
                    />
                  </li>
                ) : null
              })}
            </ul>
          </section>
        ))}
      </div>

      <footer className="corn-roster__footer">
        <ActionButton
          className="corn-roster__account"
          label="账户"
          unavailable={UNAVAILABLE.account}
        >
          <Avatar spec={roster.account} size={30} />
        </ActionButton>
        <ActionButton
          className="corn-roster__connect"
          label="连接应用"
          unavailable={UNAVAILABLE.connectApps}
        >
          连接应用
        </ActionButton>
      </footer>
    </nav>
  )
}
