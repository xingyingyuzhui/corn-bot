import { Share, X } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { DETAILS_TABS, type DetailsTab } from '../../app/layout-state.ts'
import type { BotView } from '../../model/workspace.ts'
import { ActionButton } from '../../shared/ActionButton.tsx'
import { Avatar } from '../../shared/Avatar.tsx'
import { UNAVAILABLE } from '../../shared/unavailable.ts'
import './details.css'

const TAB_LABELS: Readonly<Record<DetailsTab, string>> = {
  details: '详情',
  library: '资料库',
  computer: '电脑',
}

const EMPTY_STATES: Readonly<Record<DetailsTab, string>> = {
  details: '例行任务是此 Bot 按计划重复运行的任务。请在聊天中让它设置一个。',
  library: '还没有资料。Bot 产出的文件和你分享给它的资料会显示在这里。',
  computer: '电脑控制尚未接通。接通后，这里会显示 Bot 使用电脑的权限和画面。',
}

interface BotDetailsPaneProps {
  readonly bot: BotView
  readonly tab: DetailsTab
  readonly onSelectTab: (tab: DetailsTab) => void
  readonly onClose: () => void
}

export function BotDetailsPane({
  bot,
  tab,
  onSelectTab,
  onClose,
}: BotDetailsPaneProps) {
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const index = DETAILS_TABS.indexOf(tab)
    const next =
      DETAILS_TABS[(index + step + DETAILS_TABS.length) % DETAILS_TABS.length]
    if (!next) return
    onSelectTab(next)
    event.currentTarget
      .querySelector<HTMLButtonElement>(`#details-tab-${next}`)
      ?.focus()
  }

  return (
    <aside
      id="corn-bot-details"
      className="corn-details"
      aria-label={`${bot.name} 的详情`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <header className="corn-details__titlebar corn-drag">
        <ActionButton
          className="corn-round-button"
          label="分享"
          unavailable={UNAVAILABLE.share}
        >
          <Share size={16} strokeWidth={2} aria-hidden />
        </ActionButton>
        <ActionButton
          className="corn-round-button"
          label="关闭详情"
          onPress={onClose}
        >
          <X size={17} strokeWidth={2} aria-hidden />
        </ActionButton>
      </header>

      <div className="corn-details__profile">
        <Avatar spec={bot.avatar} size={60} />
        <h2 className="corn-details__name">{bot.name}</h2>
        <ActionButton
          className="corn-details__tags"
          label="添加标签"
          unavailable={UNAVAILABLE.tags}
        >
          添加标签
        </ActionButton>
      </div>

      <div
        className="corn-details__tabs"
        role="tablist"
        aria-label="详情分区"
        onKeyDown={moveFocus}
      >
        {DETAILS_TABS.map((id) => (
          <button
            key={id}
            id={`details-tab-${id}`}
            type="button"
            role="tab"
            className="corn-details__tab"
            aria-selected={id === tab}
            aria-controls="details-panel"
            tabIndex={id === tab ? 0 : -1}
            onClick={() => onSelectTab(id)}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>

      <section
        id="details-panel"
        className="corn-details__panel"
        role="tabpanel"
        aria-labelledby={`details-tab-${tab}`}
      >
        <p className="corn-details__empty">{EMPTY_STATES[tab]}</p>
      </section>
    </aside>
  )
}
