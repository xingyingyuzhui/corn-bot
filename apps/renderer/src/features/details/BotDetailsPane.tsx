import { Ellipsis, Share, X } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import {
  DETAILS_TABS,
  type DetailsTab,
  type Overlay,
} from '../../app/layout-state.ts'
import { useWorkspace } from '../../app/workspace-context.tsx'
import type { BotView } from '../../model/workspace.ts'
import { ActionButton } from '../../shared/ActionButton.tsx'
import { Avatar } from '../../shared/Avatar.tsx'
import { Menu, type MenuItem } from '../../shared/Menu.tsx'
import { useNotice } from '../../shared/notice.tsx'
import { modelSummary } from '../bot-editor/model-choice.ts'
import { botBrief } from '../bot-editor/share-export.ts'
import { BotTagChips } from './BotTagChips.tsx'
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

type BotOverlayKind = Extract<Overlay, { readonly botId: string }>['kind']

interface BotDetailsPaneProps {
  readonly bot: BotView
  readonly tab: DetailsTab
  readonly onSelectTab: (tab: DetailsTab) => void
  readonly onClose: () => void
  readonly onOpenOverlay: (overlay: Overlay) => void
}

export function BotDetailsPane({
  bot,
  tab,
  onSelectTab,
  onClose,
  onOpenOverlay,
}: BotDetailsPaneProps) {
  const workspace = useWorkspace()
  const notify = useNotice()
  const open = (kind: BotOverlayKind) => onOpenOverlay({ kind, botId: bot.id })

  const moreItems: readonly MenuItem[] = [
    { id: 'profile', label: '编辑资料…', onSelect: () => open('bot-profile') },
    { id: 'tags', label: '编辑标签…', onSelect: () => open('bot-tags') },
    {
      id: 'model',
      label: `模型：${modelSummary(bot, workspace.models)}`,
      onSelect: () => open('bot-model'),
    },
    {
      id: 'permissions',
      label: '权限…',
      onSelect: () => open('bot-permissions'),
    },
  ]

  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(botBrief(bot, workspace.roster.tags))
      notify('已复制')
    } catch {
      notify('复制失败：系统剪贴板不可用')
    }
  }

  const shareItems: readonly MenuItem[] = [
    {
      id: 'brief',
      label: '复制 Bot 简介',
      onSelect: () => {
        void copyBrief()
      },
    },
    {
      id: 'export',
      label: '导出受限配置…',
      onSelect: () => open('share-export'),
    },
  ]

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
        // Escape inside an open menu only dismisses the menu.
        if (
          event.key === 'Escape' &&
          !(event.target as Element).closest('[role="menu"]')
        )
          onClose()
      }}
    >
      <header className="corn-details__titlebar corn-drag">
        <Menu
          label="更多"
          items={moreItems}
          triggerClassName="corn-round-button"
          trigger={<Ellipsis size={17} strokeWidth={2} aria-hidden />}
        />
        <Menu
          label="分享"
          items={shareItems}
          triggerClassName="corn-round-button"
          trigger={<Share size={16} strokeWidth={2} aria-hidden />}
        />
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
        <BotTagChips
          bot={bot}
          tags={workspace.roster.tags}
          onEdit={() => open('bot-tags')}
        />
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
