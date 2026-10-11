import { Blocks, ChevronRight, Plus, Search } from 'lucide-react'
import { type Dispatch, useCallback, useRef } from 'react'
import {
  type LayoutAction,
  type LayoutState,
  type Overlay,
  sidebarSnapshot,
} from '../../app/layout-state.ts'
import type { RosterView } from '../../model/workspace.ts'
import { ActionButton } from '../../shared/ActionButton.tsx'
import { AccountAvatar } from '../../shared/Avatar.tsx'
import { BotListItem } from './BotListItem.tsx'
import { HiddenBotsSection } from './HiddenBotsSection.tsx'
import { PinnedBotCard } from './PinnedBotCard.tsx'
import { RosterRail } from './RosterRail.tsx'
import {
  ROSTER_RESULTS_ID,
  ROSTER_SEARCH_ID,
  RosterSearchField,
} from './RosterSearchField.tsx'
import { type RosterFilter, rosterSections } from './roster-order.ts'
import { SidebarResizeHandle } from './SidebarResizeHandle.tsx'
import './roster.css'

interface BotRosterProps {
  readonly roster: RosterView
  readonly selectedBotId: string
  readonly layout: LayoutState
  readonly filter: RosterFilter
  readonly collapsed: boolean
  /** Rendered column width from `resolveLayout`. */
  readonly width: number
  readonly dispatch: Dispatch<LayoutAction>
}

export function BotRoster({
  roster,
  selectedBotId,
  layout,
  filter,
  collapsed,
  width,
  dispatch,
}: BotRosterProps) {
  const searchButton = useRef<HTMLButtonElement>(null)
  const sections = rosterSections(roster, filter)
  const search = layout.rosterSearch
  const onSelect = (botId: string) => dispatch({ type: 'select-bot', botId })
  const onSearchFocused = useCallback(
    () => dispatch({ type: 'roster-search-focused' }),
    [dispatch],
  )
  const onOpenOverlay = (overlay: Overlay) =>
    dispatch({ type: 'open-overlay', overlay })
  const openSearch = () => {
    if (collapsed) dispatch({ type: 'toggle-sidebar' })
    dispatch({ type: 'open-roster-search' })
  }
  const closeSearch = () => {
    dispatch({ type: 'close-roster-search' })
    searchButton.current?.focus()
  }
  const resultCount =
    sections.pinned.length +
    sections.groups.reduce((sum, group) => sum + group.bots.length, 0)

  return (
    <nav
      id="corn-roster"
      className="corn-roster"
      data-mode={collapsed ? 'rail' : 'expanded'}
      aria-label="Bot 名册"
    >
      <header className="corn-roster__titlebar corn-drag">
        {collapsed ? null : (
          <>
            <button
              ref={searchButton}
              type="button"
              className="corn-round-button"
              aria-label="搜索 Bot"
              aria-expanded={search !== null}
              aria-controls={ROSTER_SEARCH_ID}
              title="搜索 Bot"
              onClick={openSearch}
            >
              <Search size={16} strokeWidth={2} aria-hidden />
            </button>
            <ActionButton
              className="corn-round-button"
              label="新建 Bot"
              onPress={() => onOpenOverlay({ kind: 'create-bot' })}
            >
              <Plus size={18} strokeWidth={2} aria-hidden />
            </ActionButton>
          </>
        )}
      </header>

      {collapsed ? (
        <>
          <div className="corn-rail__actions">
            <ActionButton
              className="corn-round-button"
              label="搜索 Bot"
              onPress={openSearch}
            >
              <Search size={16} strokeWidth={2} aria-hidden />
            </ActionButton>
            <ActionButton
              className="corn-round-button"
              label="新建 Bot"
              onPress={() => onOpenOverlay({ kind: 'create-bot' })}
            >
              <Plus size={18} strokeWidth={2} aria-hidden />
            </ActionButton>
          </div>
          <div className="corn-roster__scroll">
            <RosterRail
              bots={[
                ...sections.pinned,
                ...sections.groups.flatMap((group) => group.bots),
              ]}
              pinnedIds={new Set(roster.pinnedBotIds)}
              selectedBotId={selectedBotId}
              onSelect={onSelect}
            />
          </div>
        </>
      ) : (
        <>
          {search ? (
            <RosterSearchField
              query={search.query}
              focusPending={search.focusPending}
              onFocused={onSearchFocused}
              onQuery={(query) =>
                dispatch({ type: 'edit-roster-search', query })
              }
              onClose={closeSearch}
            />
          ) : null}
          <div id={ROSTER_RESULTS_ID} className="corn-roster__scroll">
            {sections.searching ? (
              <p
                className="corn-roster__status"
                data-empty={
                  resultCount + sections.hidden.length === 0 || undefined
                }
                role="status"
              >
                {resultCount + sections.hidden.length === 0
                  ? `没有找到与“${search?.query.trim()}”相关的 Bot`
                  : `找到 ${resultCount} 个 Bot`}
              </p>
            ) : null}
            {sections.pinned.length ? (
              <div className="corn-roster__pinned">
                {sections.pinned.map((bot) => (
                  <PinnedBotCard
                    key={bot.id}
                    bot={bot}
                    selected={bot.id === selectedBotId}
                    onSelect={onSelect}
                    onOpenOverlay={onOpenOverlay}
                  />
                ))}
              </div>
            ) : null}
            {sections.groups.map((group) => {
              const listId = `corn-group-list-${group.id}`
              return (
                <section
                  key={group.id}
                  className="corn-roster__group"
                  aria-labelledby={`corn-group-${group.id}`}
                >
                  <h2 className="corn-roster__group-heading">
                    {sections.searching ? (
                      <span
                        id={`corn-group-${group.id}`}
                        className="corn-roster__group-label"
                      >
                        {group.label}
                      </span>
                    ) : (
                      <button
                        id={`corn-group-${group.id}`}
                        type="button"
                        className="corn-roster__group-label corn-roster__group-toggle"
                        aria-expanded={!group.folded}
                        aria-controls={listId}
                        onClick={() =>
                          dispatch({ type: 'toggle-group', groupId: group.id })
                        }
                      >
                        {group.label}
                        <ChevronRight
                          className="corn-roster__chevron"
                          size={12}
                          strokeWidth={2.4}
                          aria-hidden
                        />
                      </button>
                    )}
                  </h2>
                  <ul
                    id={listId}
                    className="corn-roster__list"
                    hidden={group.folded}
                  >
                    {group.bots.map((bot) => (
                      <li key={bot.id}>
                        <BotListItem
                          bot={bot}
                          selected={bot.id === selectedBotId}
                          onSelect={onSelect}
                          onOpenOverlay={onOpenOverlay}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
            <HiddenBotsSection
              bots={sections.hidden}
              forceOpen={sections.searching}
            />
          </div>
        </>
      )}

      <footer className="corn-roster__footer">
        <ActionButton
          className="corn-roster__account"
          label="设置"
          onPress={() =>
            onOpenOverlay({ kind: 'settings', section: 'general' })
          }
        >
          <AccountAvatar spec={roster.account} size={30} />
        </ActionButton>
        {collapsed ? (
          <ActionButton
            className="corn-round-button"
            label="连接应用"
            onPress={() => onOpenOverlay({ kind: 'connect-apps' })}
          >
            <Blocks size={16} strokeWidth={2} aria-hidden />
          </ActionButton>
        ) : (
          <ActionButton
            className="corn-roster__connect"
            label="连接应用"
            onPress={() => onOpenOverlay({ kind: 'connect-apps' })}
          >
            连接应用
          </ActionButton>
        )}
      </footer>

      <SidebarResizeHandle
        width={width}
        preferredWidth={layout.sidebarPreferredWidth}
        collapsed={collapsed}
        snapshot={sidebarSnapshot(layout)}
        onResize={(next) => dispatch({ type: 'resize-sidebar', width: next })}
        onRestore={(snapshot) =>
          dispatch({ type: 'restore-sidebar', snapshot })
        }
      />
    </nav>
  )
}
