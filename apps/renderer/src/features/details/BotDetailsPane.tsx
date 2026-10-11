import { Ellipsis, Share, X } from 'lucide-react'
import {
  type Dispatch,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
} from 'react'
import {
  detailsLocationFor,
  type LayoutAction,
  type LayoutState,
} from '../../app/layout-state.ts'
import { useWorkspace } from '../../app/workspace-context.tsx'
import { fixtureSections } from '../../fixtures/management-sections.ts'
import { parseFixtureRoute } from '../../fixtures/routes.ts'
import { modelSummary } from '../../model/models.ts'
import type { BotView } from '../../model/workspace.ts'
import { ActionButton } from '../../shared/ActionButton.tsx'
import { Avatar } from '../../shared/Avatar.tsx'
import { BotOriginBadge } from '../../shared/BotOriginBadge.tsx'
import { Menu, type MenuItem } from '../../shared/Menu.tsx'
import { useCopy } from '../../shared/use-copy.ts'
import { botBrief } from '../bot-editor/share-export.ts'
import { BotTagChips } from './BotTagChips.tsx'
import {
  BotConfigurationHome,
  configEntryId,
} from './configuration/BotConfigurationHome.tsx'
import {
  ConfigSubpageFrame,
  PAGE_HEADING_SELECTOR,
} from './configuration/ConfigSubpageFrame.tsx'
import { CoreSettingsSection } from './configuration/CoreSettingsSection.tsx'
import type { ConfigDraftRegistry } from './configuration/config-drafts.ts'
import { configSummaries } from './configuration/config-summaries.ts'
import { ModelSettingsSection } from './configuration/ModelSettingsSection.tsx'
import { PermissionsSection } from './configuration/PermissionsSection.tsx'
import { SkillsSection } from './configuration/SkillsSection.tsx'
import {
  type ConfigSubpage,
  type DetailsEntry,
  type DetailsFocusTarget,
  type DetailsLocation,
  MAIN_TAB_LABELS,
  MAIN_TABS,
  tabForKey,
  viewKey,
} from './details-navigation.ts'
import { BotLibrary } from './library/BotLibrary.tsx'
import { BotOverview } from './overview/BotOverview.tsx'
import './details.css'

const SECTIONS = fixtureSections(
  parseFixtureRoute(window.location.hash, import.meta.env.DEV),
)

interface BotDetailsPaneProps {
  readonly bot: BotView
  readonly layout: LayoutState
  readonly dispatch: Dispatch<LayoutAction>
  readonly drafts: ConfigDraftRegistry
}

export function BotDetailsPane({
  bot,
  layout,
  dispatch,
  drafts,
}: BotDetailsPaneProps) {
  const workspace = useWorkspace()
  const copy = useCopy()
  const paneRef = useRef<HTMLElement>(null)
  const tablistRef = useRef<HTMLDivElement>(null)
  const location = detailsLocationFor(layout, bot.id)
  const view = viewKey(location)
  const permissions = workspace.permissions[bot.id]

  const navigate = (next: DetailsLocation, focus?: DetailsFocusTarget) =>
    dispatch(
      focus
        ? { type: 'navigate-details', botId: bot.id, location: next, focus }
        : { type: 'navigate-details', botId: bot.id, location: next },
    )
  const openEntry = (entry: DetailsEntry) =>
    dispatch({ type: 'open-details-entry', botId: bot.id, entry })
  const openOverlay = (kind: 'bot-tags' | 'share-export') =>
    dispatch({ type: 'open-overlay', overlay: { kind, botId: bot.id } })

  const restoreScroll = useEffectEvent((botId: string, key: string) => {
    const pane = paneRef.current
    if (pane) pane.scrollTop = layout.detailsScroll[botId]?.[key] ?? 0
  })
  useLayoutEffect(() => restoreScroll(bot.id, view), [bot.id, view])

  const focusRequest = layout.detailsFocus
  useEffect(() => {
    if (!focusRequest || focusRequest.botId !== bot.id) return
    const { target } = focusRequest
    const selector =
      target.kind === 'page-heading'
        ? PAGE_HEADING_SELECTOR
        : `#${configEntryId(target.page)}`
    paneRef.current?.querySelector<HTMLElement>(selector)?.focus()
    dispatch({ type: 'details-focused' })
  }, [focusRequest, bot.id, dispatch])

  useEffect(() => {
    const list = tablistRef.current
    if (list?.contains(document.activeElement))
      list.querySelector<HTMLElement>(`#details-tab-${location.tab}`)?.focus()
  }, [location.tab])

  const moreItems: readonly MenuItem[] = [
    { id: 'profile', label: '编辑资料…', onSelect: () => openEntry('core') },
    { id: 'tags', label: '编辑标签…', onSelect: () => openOverlay('bot-tags') },
    {
      id: 'model',
      label: `模型：${modelSummary(bot, workspace.models)}`,
      onSelect: () => openEntry('model'),
    },
    {
      id: 'permissions',
      label: '权限…',
      onSelect: () => openEntry('permissions'),
    },
  ]

  const shareItems: readonly MenuItem[] = [
    {
      id: 'brief',
      label: '复制 Bot 简介',
      onSelect: () =>
        void copy(
          botBrief(bot, workspace.roster.tags),
          '复制失败：系统剪贴板不可用',
        ),
    },
    {
      id: 'export',
      label: '导出受限配置…',
      onSelect: () => openOverlay('share-export'),
    },
  ]

  const reportDirty = (page: ConfigSubpage) => (dirty: boolean) =>
    dispatch({ type: 'config-draft', botId: bot.id, page, dirty })

  const subpage = (page: ConfigSubpage): ReactNode => {
    switch (page) {
      case 'core':
        return (
          <CoreSettingsSection
            bot={bot}
            identity={SECTIONS(bot.id, 'identity')}
            drafts={drafts}
            onDirtyChange={reportDirty('core')}
            onOpenMemory={() => openEntry('memory')}
          />
        )
      case 'model':
        return (
          <ModelSettingsSection
            bot={bot}
            settings={workspace.models}
            drafts={drafts}
            onDirtyChange={reportDirty('model')}
            onOpenSettings={() =>
              dispatch({
                type: 'open-overlay',
                overlay: { kind: 'settings', section: 'models' },
              })
            }
          />
        )
      case 'permissions':
        return <PermissionsSection rows={permissions} />
      case 'skills':
        return <SkillsSection state={SECTIONS(bot.id, 'skills')} />
      default: {
        const unreachable: never = page
        throw new Error(`Unknown configuration page ${String(unreachable)}`)
      }
    }
  }

  const panel = (): ReactNode => {
    switch (location.tab) {
      case 'overview':
        return (
          <BotOverview
            bot={bot}
            models={workspace.models}
            permissions={permissions}
            sections={SECTIONS}
          />
        )
      case 'configuration': {
        const { page } = location
        return page === 'home' ? (
          <BotConfigurationHome
            summaries={configSummaries(
              bot,
              workspace.models,
              permissions,
              SECTIONS(bot.id, 'skills'),
            )}
            onOpen={(next) =>
              navigate({ ...location, page: next }, { kind: 'page-heading' })
            }
          />
        ) : (
          <ConfigSubpageFrame
            page={page}
            onBack={() =>
              navigate(
                { ...location, page: 'home' },
                { kind: 'config-entry', page },
              )
            }
          >
            {subpage(page)}
          </ConfigSubpageFrame>
        )
      }
      case 'library':
        return (
          <BotLibrary
            botId={bot.id}
            section={location.section}
            sections={SECTIONS}
            onSection={(section) => navigate({ ...location, section })}
          />
        )
      default: {
        const unreachable: never = location.tab
        throw new Error(`Unknown details tab ${String(unreachable)}`)
      }
    }
  }

  return (
    <aside
      ref={paneRef}
      id="corn-bot-details"
      className="corn-details"
      aria-label={`${bot.name} 的详情`}
      onScroll={(event) =>
        dispatch({
          type: 'record-details-scroll',
          botId: bot.id,
          view,
          top: event.currentTarget.scrollTop,
        })
      }
      onKeyDown={(event) => {
        // Escape inside an open menu only dismisses the menu.
        if (
          event.key === 'Escape' &&
          !(event.target as Element).closest('[role="menu"]')
        )
          dispatch({ type: 'close-details' })
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
          onPress={() => dispatch({ type: 'close-details' })}
        >
          <X size={17} strokeWidth={2} aria-hidden />
        </ActionButton>
      </header>

      <div className="corn-details__profile">
        <Avatar spec={bot.avatar} size={60} />
        <h2 className="corn-details__name">
          {bot.name}
          <BotOriginBadge origin={bot.origin} />
        </h2>
        <BotTagChips
          bot={bot}
          tags={workspace.roster.tags}
          onEdit={() => openOverlay('bot-tags')}
        />
      </div>

      <div
        ref={tablistRef}
        className="corn-details__tabs"
        role="tablist"
        aria-label="详情分区"
        onKeyDown={(event) => {
          const next = tabForKey(location.tab, event.key)
          if (next === null) return
          event.preventDefault()
          navigate({ ...location, tab: next })
        }}
      >
        {MAIN_TABS.map((id) => (
          <button
            key={id}
            id={`details-tab-${id}`}
            type="button"
            role="tab"
            className="corn-details__tab"
            aria-selected={id === location.tab}
            aria-controls="details-panel"
            tabIndex={id === location.tab ? 0 : -1}
            onClick={() => navigate({ ...location, tab: id })}
          >
            {MAIN_TAB_LABELS[id]}
          </button>
        ))}
      </div>

      <section
        key={bot.id}
        id="details-panel"
        className="corn-details__panel"
        role="tabpanel"
        aria-labelledby={`details-tab-${location.tab}`}
      >
        {panel()}
      </section>
    </aside>
  )
}
