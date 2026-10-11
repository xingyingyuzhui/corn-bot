import {
  type ConfigSubpage,
  DEFAULT_LOCATION,
  type DetailsEntry,
  type DetailsFocusTarget,
  type DetailsLocation,
  locationForEntry,
  normalizeLocation,
  openSubpage,
} from '../features/details/details-navigation.ts'
import {
  type ComposerDraft,
  draftAfterSend,
  EMPTY_DRAFT,
  type SendAttempt,
} from '../model/draft.ts'

/**
 * Renderer-only shell state. It never holds DSH runtime state: selection,
 * drafts, scroll positions, panel preferences and the open overlay only.
 */

/**
 * `user-screenshots` profile, measured at 1024×764 CSS px, DPR 2 (ADR-0004).
 * The sidebar range, rail, main-content reserve and drag thresholds follow the
 * kit (E01–E05); only the 276 default comes from the screenshot calibration.
 */
export const LAYOUT = {
  sidebarWidth: 276,
  sidebarMinWidth: 240,
  sidebarMaxWidth: 400,
  sidebarRailWidth: 88,
  mainReserve: 424,
  dragCollapseBelow: 210,
  dragExpandFrom: 220,
  /** Corn's own keyboard enhancement on the resize separator. */
  sidebarKeyStep: 8,
  detailsRatio: 0.367,
  chatMinWidth: 340,
} as const

export type SettingsSection = 'general' | 'models'

/** At most one modal surface is open; each kind names its owner feature. */
export type Overlay =
  | { readonly kind: 'create-bot' }
  | { readonly kind: 'connect-apps' }
  | { readonly kind: 'settings'; readonly section: SettingsSection }
  | { readonly kind: 'bot-profile'; readonly botId: string }
  | { readonly kind: 'bot-tags'; readonly botId: string }
  | { readonly kind: 'share-export'; readonly botId: string }
  /** Leaving a configuration subpage with unsaved changes; `then` runs
   * once the draft is saved or discarded. */
  | {
      readonly kind: 'unsaved-config'
      readonly botId: string
      readonly page: ConfigSubpage
      readonly then: LayoutAction
    }

export type UnsavedConfigOverlay = Extract<Overlay, { kind: 'unsaved-config' }>

export interface ChatScroll {
  readonly top: number
  readonly pinnedToBottom: boolean
}

/**
 * Roster search is closed when `null`. Opening it asks for focus once; the
 * field reports back, so a remount never steals focus again.
 */
export interface RosterSearch {
  readonly query: string
  readonly focusPending: boolean
}

/** A one-shot focus request; the pane reports back once it has moved focus. */
export interface DetailsFocusRequest {
  readonly botId: string
  readonly target: DetailsFocusTarget
}

/** The configuration subpage whose editor holds unsaved changes. */
export interface UnsavedConfig {
  readonly botId: string
  readonly page: ConfigSubpage
}

export interface LayoutState {
  readonly selectedBotId: string
  readonly detailsOpen: boolean
  readonly detailsLocations: Readonly<Record<string, DetailsLocation>>
  /** Pane scroll per Bot, keyed by `viewKey`. */
  readonly detailsScroll: Readonly<
    Record<string, Readonly<Record<string, number>>>
  >
  readonly detailsFocus: DetailsFocusRequest | null
  readonly unsavedConfig: UnsavedConfig | null
  readonly drafts: Readonly<Record<string, ComposerDraft>>
  readonly scroll: Readonly<Record<string, ChatScroll>>
  readonly viewportWidth: number
  /** Expanded width the user chose; kept while collapsed or auto-compact. */
  readonly sidebarPreferredWidth: number
  readonly sidebarManualCollapsed: boolean
  readonly sidebarAutoCompact: boolean
  readonly rosterSearch: RosterSearch | null
  readonly foldedGroupIds: readonly string[]
  readonly overlay: Overlay | null
}

export type SidebarSnapshot = Pick<
  LayoutState,
  'sidebarPreferredWidth' | 'sidebarManualCollapsed' | 'sidebarAutoCompact'
>

export type LayoutAction =
  | { readonly type: 'select-bot'; readonly botId: string }
  | { readonly type: 'open-details' }
  | { readonly type: 'close-details' }
  /** Ignored unless `botId` is still selected, so a late callback for one
   * Bot never moves another Bot's pane. */
  | {
      readonly type: 'navigate-details'
      readonly botId: string
      readonly location: DetailsLocation
      readonly open?: boolean
      readonly focus?: DetailsFocusTarget
    }
  /** Menus, shortcuts and approval cards: opens the pane at `entry`. */
  | {
      readonly type: 'open-details-entry'
      readonly botId: string
      readonly entry: DetailsEntry
    }
  | {
      readonly type: 'record-details-scroll'
      readonly botId: string
      readonly view: string
      readonly top: number
    }
  | { readonly type: 'details-focused' }
  /** A configuration editor reports whether it holds unsaved changes. */
  | {
      readonly type: 'config-draft'
      readonly botId: string
      readonly page: ConfigSubpage
      readonly dirty: boolean
    }
  /** The unsaved-changes prompt settled: `leave` after save or discard. */
  | {
      readonly type: 'resolve-unsaved-config'
      readonly overlay: UnsavedConfigOverlay
      readonly leave: boolean
    }
  | {
      readonly type: 'edit-draft'
      readonly botId: string
      readonly draft: ComposerDraft
    }
  /** Clears `botId`'s draft if it still holds exactly what was sent; a send
   * may settle after the user has switched to another Bot. */
  | {
      readonly type: 'settle-sent-draft'
      readonly botId: string
      readonly sent: SendAttempt
    }
  | { readonly type: 'record-scroll'; readonly scroll: ChatScroll }
  | { readonly type: 'toggle-sidebar' }
  | { readonly type: 'viewport'; readonly width: number }
  /** Proposed rendered width from a drag or keyboard step on the separator. */
  | { readonly type: 'resize-sidebar'; readonly width: number }
  | { readonly type: 'restore-sidebar'; readonly snapshot: SidebarSnapshot }
  | { readonly type: 'open-roster-search' }
  | { readonly type: 'edit-roster-search'; readonly query: string }
  | { readonly type: 'roster-search-focused' }
  | { readonly type: 'close-roster-search' }
  | { readonly type: 'toggle-group'; readonly groupId: string }
  | { readonly type: 'open-overlay'; readonly overlay: Overlay }
  /** Closes `overlay` only if it is still the open one, so a late async
   * callback from a replaced dialog cannot dismiss its successor. */
  | { readonly type: 'close-overlay'; readonly overlay: Overlay }
  /** A create dialog finished; selects the new Bot only if that dialog is
   * still open, so a late result never steals the user's selection. */
  | {
      readonly type: 'bot-created'
      readonly overlay: Overlay
      readonly botId: string
    }

export function initialLayout(
  selectedBotId: string,
  viewportWidth: number = Number.POSITIVE_INFINITY,
): LayoutState {
  return {
    selectedBotId,
    detailsOpen: false,
    detailsLocations: {},
    detailsScroll: {},
    detailsFocus: null,
    unsavedConfig: null,
    drafts: {},
    scroll: {},
    viewportWidth,
    sidebarPreferredWidth: LAYOUT.sidebarWidth,
    sidebarManualCollapsed: false,
    sidebarAutoCompact: autoCompactFor(viewportWidth, LAYOUT.sidebarWidth),
    rosterSearch: null,
    foldedGroupIds: [],
    overlay: null,
  }
}

export function clampSidebarWidth(width: number): number {
  return Math.round(
    Math.min(LAYOUT.sidebarMaxWidth, Math.max(LAYOUT.sidebarMinWidth, width)),
  )
}

/** Kit E02: compact when the window cannot fit the sidebar plus main reserve. */
export function autoCompactFor(
  viewportWidth: number,
  preferredWidth: number,
): boolean {
  return viewportWidth < preferredWidth + LAYOUT.mainReserve
}

export type SidebarDrag =
  | { readonly kind: 'collapse' }
  | { readonly kind: 'expand'; readonly width: number }

/**
 * Kit E03/E04: an expanded sidebar collapses below 210; a collapsed or
 * auto-compact one only expands from 220 and when the main reserve still
 * fits, so a drag never forces the sidebar open over the chat.
 */
export function resolveSidebarDrag(
  from: 'expanded' | 'collapsed',
  proposedWidth: number,
  viewportWidth: number,
): SidebarDrag {
  const room = viewportWidth - LAYOUT.mainReserve
  if (from === 'expanded') {
    if (proposedWidth < LAYOUT.dragCollapseBelow) return { kind: 'collapse' }
    return {
      kind: 'expand',
      width: clampSidebarWidth(Math.min(proposedWidth, room)),
    }
  }
  const width = clampSidebarWidth(proposedWidth)
  return proposedWidth < LAYOUT.dragExpandFrom || width > room
    ? { kind: 'collapse' }
    : { kind: 'expand', width }
}

export function sidebarSnapshot(state: LayoutState): SidebarSnapshot {
  return {
    sidebarPreferredWidth: state.sidebarPreferredWidth,
    sidebarManualCollapsed: state.sidebarManualCollapsed,
    sidebarAutoCompact: state.sidebarAutoCompact,
  }
}

function resizeSidebar(state: LayoutState, width: number): LayoutState {
  const collapsed = sidebarCollapsed(state)
  const drag = resolveSidebarDrag(
    collapsed ? 'collapsed' : 'expanded',
    width,
    state.viewportWidth,
  )
  switch (drag.kind) {
    case 'collapse':
      return collapsed ? state : { ...state, sidebarManualCollapsed: true }
    case 'expand':
      return !collapsed && drag.width === state.sidebarPreferredWidth
        ? state
        : {
            ...state,
            sidebarPreferredWidth: drag.width,
            sidebarManualCollapsed: false,
            sidebarAutoCompact: false,
          }
    default: {
      const unreachable: never = drag
      throw new Error(`Unknown sidebar drag ${JSON.stringify(unreachable)}`)
    }
  }
}

/** Subpages focus their heading when opened from anywhere but a restore. */
function entryNavigation(
  state: LayoutState,
  botId: string,
  entry: DetailsEntry,
): LayoutAction {
  const location = locationForEntry(detailsLocationFor(state, botId), entry)
  return openSubpage(location) === null
    ? { type: 'navigate-details', botId, location, open: true }
    : {
        type: 'navigate-details',
        botId,
        location,
        open: true,
        focus: { kind: 'page-heading' },
      }
}

/** Whether `action` would unmount the editor that holds `unsaved`. */
function leavesConfig(
  state: LayoutState,
  unsaved: UnsavedConfig,
  action: LayoutAction,
): boolean {
  const onScreen =
    state.detailsOpen &&
    state.selectedBotId === unsaved.botId &&
    openSubpage(detailsLocationFor(state, unsaved.botId)) === unsaved.page
  if (!onScreen) return false
  switch (action.type) {
    case 'select-bot':
      return action.botId !== state.selectedBotId
    case 'bot-created':
      return state.overlay === action.overlay
    case 'close-details':
      return true
    case 'navigate-details':
      return (
        action.botId === unsaved.botId &&
        openSubpage(action.location) !== unsaved.page
      )
    case 'open-details':
    case 'open-details-entry':
    case 'record-details-scroll':
    case 'details-focused':
    case 'config-draft':
    case 'resolve-unsaved-config':
    case 'edit-draft':
    case 'settle-sent-draft':
    case 'record-scroll':
    case 'toggle-sidebar':
    case 'viewport':
    case 'resize-sidebar':
    case 'restore-sidebar':
    case 'open-roster-search':
    case 'edit-roster-search':
    case 'roster-search-focused':
    case 'close-roster-search':
    case 'toggle-group':
    case 'open-overlay':
    case 'close-overlay':
      return false
    default: {
      const unreachable: never = action
      throw new Error(`Unknown layout action ${JSON.stringify(unreachable)}`)
    }
  }
}

/**
 * Unsaved configuration never follows the user silently: switching Bot,
 * tab or subpage, or closing the pane, asks to save or discard first. A
 * finished create keeps its result but only selects the new Bot after that.
 */
function guardUnsavedConfig(
  state: LayoutState,
  action: LayoutAction,
): LayoutState | null {
  const unsaved = state.unsavedConfig
  if (!unsaved || !leavesConfig(state, unsaved, action)) return null
  const then: LayoutAction =
    action.type === 'bot-created'
      ? { type: 'select-bot', botId: action.botId }
      : action
  return {
    ...state,
    overlay: { kind: 'unsaved-config', ...unsaved, then },
  }
}

export function layoutReducer(
  state: LayoutState,
  action: LayoutAction,
): LayoutState {
  if (action.type === 'open-details-entry')
    return layoutReducer(
      state,
      entryNavigation(state, action.botId, action.entry),
    )
  const guarded = guardUnsavedConfig(state, action)
  if (guarded) return guarded
  switch (action.type) {
    case 'select-bot':
      return action.botId === state.selectedBotId
        ? state
        : { ...state, selectedBotId: action.botId, detailsFocus: null }
    case 'open-details':
      return state.detailsOpen ? state : { ...state, detailsOpen: true }
    case 'close-details':
      return state.detailsOpen
        ? { ...state, detailsOpen: false, detailsFocus: null }
        : state
    case 'navigate-details':
      return action.botId !== state.selectedBotId
        ? state
        : {
            ...state,
            detailsOpen: state.detailsOpen || action.open === true,
            detailsLocations: {
              ...state.detailsLocations,
              [action.botId]: normalizeLocation(action.location),
            },
            detailsFocus: action.focus
              ? { botId: action.botId, target: action.focus }
              : null,
          }
    case 'record-details-scroll': {
      const views = state.detailsScroll[action.botId] ?? {}
      return views[action.view] === action.top
        ? state
        : {
            ...state,
            detailsScroll: {
              ...state.detailsScroll,
              [action.botId]: { ...views, [action.view]: action.top },
            },
          }
    }
    case 'details-focused':
      return state.detailsFocus ? { ...state, detailsFocus: null } : state
    case 'config-draft': {
      const current = state.unsavedConfig
      const same =
        current?.botId === action.botId && current.page === action.page
      if (action.dirty)
        return same
          ? state
          : {
              ...state,
              unsavedConfig: { botId: action.botId, page: action.page },
            }
      return same ? { ...state, unsavedConfig: null } : state
    }
    case 'resolve-unsaved-config': {
      if (state.overlay !== action.overlay) return state
      const closed: LayoutState = { ...state, overlay: null }
      return action.leave
        ? layoutReducer({ ...closed, unsavedConfig: null }, action.overlay.then)
        : closed
    }
    case 'edit-draft':
      return {
        ...state,
        drafts: { ...state.drafts, [action.botId]: action.draft },
      }
    case 'settle-sent-draft': {
      const current = draftFor(state, action.botId)
      const next = draftAfterSend(current, action.sent)
      return next === current
        ? state
        : { ...state, drafts: { ...state.drafts, [action.botId]: next } }
    }
    case 'record-scroll':
      return {
        ...state,
        scroll: { ...state.scroll, [state.selectedBotId]: action.scroll },
      }
    case 'toggle-sidebar':
      return {
        ...state,
        sidebarManualCollapsed: !sidebarCollapsed(state),
        sidebarAutoCompact: false,
      }
    case 'viewport':
      return action.width === state.viewportWidth
        ? state
        : {
            ...state,
            viewportWidth: action.width,
            sidebarAutoCompact: autoCompactFor(
              action.width,
              state.sidebarPreferredWidth,
            ),
          }
    case 'resize-sidebar':
      return resizeSidebar(state, action.width)
    case 'restore-sidebar':
      return { ...state, ...action.snapshot }
    case 'open-roster-search':
      return {
        ...state,
        rosterSearch: {
          query: state.rosterSearch?.query ?? '',
          focusPending: true,
        },
      }
    case 'edit-roster-search':
      return {
        ...state,
        rosterSearch: {
          query: action.query,
          focusPending: state.rosterSearch?.focusPending ?? false,
        },
      }
    case 'roster-search-focused':
      return state.rosterSearch?.focusPending
        ? {
            ...state,
            rosterSearch: { ...state.rosterSearch, focusPending: false },
          }
        : state
    case 'close-roster-search':
      return state.rosterSearch === null
        ? state
        : { ...state, rosterSearch: null }
    case 'toggle-group':
      return {
        ...state,
        foldedGroupIds: state.foldedGroupIds.includes(action.groupId)
          ? state.foldedGroupIds.filter((id) => id !== action.groupId)
          : [...state.foldedGroupIds, action.groupId],
      }
    case 'open-overlay':
      return { ...state, overlay: action.overlay }
    case 'close-overlay':
      return state.overlay === action.overlay
        ? { ...state, overlay: null }
        : state
    case 'bot-created':
      return state.overlay === action.overlay
        ? { ...state, overlay: null, selectedBotId: action.botId }
        : state
    default: {
      const unreachable: never = action
      throw new Error(`Unknown layout action ${JSON.stringify(unreachable)}`)
    }
  }
}

export function sidebarCollapsed(state: LayoutState): boolean {
  return state.sidebarManualCollapsed || state.sidebarAutoCompact
}

export function draftFor(state: LayoutState, botId: string): ComposerDraft {
  return state.drafts[botId] ?? EMPTY_DRAFT
}

export function detailsLocationFor(
  state: LayoutState,
  botId: string,
): DetailsLocation {
  return state.detailsLocations[botId] ?? DEFAULT_LOCATION
}

export type DetailsMode = 'closed' | 'column' | 'overlay'

export interface ResolvedLayout {
  readonly sidebar: 'expanded' | 'collapsed'
  readonly details: DetailsMode
  readonly sidebarWidth: number
  readonly detailsWidth: number
}

/**
 * Details take ~37% of the **total** window width as a third column. When the
 * chat column would fall below its minimum, details overlay the chat instead.
 * A collapsed sidebar stays on screen as the 88px rail.
 */
export function resolveLayout(
  state: LayoutState,
  viewportWidth: number,
): ResolvedLayout {
  const collapsed = sidebarCollapsed(state)
  const sidebarWidth = collapsed
    ? LAYOUT.sidebarRailWidth
    : state.sidebarPreferredWidth
  const detailsWidth = Math.round(viewportWidth * LAYOUT.detailsRatio)
  const chatWidth = viewportWidth - sidebarWidth - detailsWidth
  const details: DetailsMode = !state.detailsOpen
    ? 'closed'
    : chatWidth >= LAYOUT.chatMinWidth
      ? 'column'
      : 'overlay'
  return {
    sidebar: collapsed ? 'collapsed' : 'expanded',
    details,
    sidebarWidth,
    detailsWidth,
  }
}
