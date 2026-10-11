import {
  draftAfterSend,
  type SendAttempt,
} from '../features/chat/composer-model.ts'
import type { AttachmentView } from '../model/workspace.ts'

/**
 * Renderer-only shell state. It never holds DSH runtime state: selection,
 * drafts, scroll positions, panel preferences and the open overlay only.
 */

export const DETAILS_TABS = ['details', 'library', 'computer'] as const
export type DetailsTab = (typeof DETAILS_TABS)[number]

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

/** Per-Bot composer contents; attachments are staged locally, never uploaded. */
export interface ComposerDraft {
  readonly text: string
  readonly attachments: readonly AttachmentView[]
}

export const EMPTY_DRAFT: ComposerDraft = { text: '', attachments: [] }

export type SettingsSection = 'general' | 'models'

/** At most one modal surface is open; each kind names its owner feature. */
export type Overlay =
  | { readonly kind: 'create-bot' }
  | { readonly kind: 'connect-apps' }
  | { readonly kind: 'settings'; readonly section: SettingsSection }
  | { readonly kind: 'bot-profile'; readonly botId: string }
  | { readonly kind: 'bot-tags'; readonly botId: string }
  | { readonly kind: 'bot-permissions'; readonly botId: string }
  | { readonly kind: 'bot-model'; readonly botId: string }
  | { readonly kind: 'share-export'; readonly botId: string }

export interface ChatScroll {
  readonly top: number
  readonly pinnedToBottom: boolean
}

/** Roster search is closed when `null`; each open request re-focuses it. */
export interface RosterSearch {
  readonly query: string
  readonly focusRequest: number
}

export interface LayoutState {
  readonly selectedBotId: string
  readonly detailsOpen: boolean
  readonly detailsTabs: Readonly<Record<string, DetailsTab>>
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
  | { readonly type: 'select-tab'; readonly tab: DetailsTab }
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
    detailsTabs: {},
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

export function layoutReducer(
  state: LayoutState,
  action: LayoutAction,
): LayoutState {
  switch (action.type) {
    case 'select-bot':
      return action.botId === state.selectedBotId
        ? state
        : { ...state, selectedBotId: action.botId }
    case 'open-details':
      return state.detailsOpen ? state : { ...state, detailsOpen: true }
    case 'close-details':
      return state.detailsOpen ? { ...state, detailsOpen: false } : state
    case 'select-tab':
      return {
        ...state,
        detailsTabs: {
          ...state.detailsTabs,
          [state.selectedBotId]: action.tab,
        },
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
          focusRequest: (state.rosterSearch?.focusRequest ?? 0) + 1,
        },
      }
    case 'edit-roster-search':
      return {
        ...state,
        rosterSearch: {
          query: action.query,
          focusRequest: state.rosterSearch?.focusRequest ?? 0,
        },
      }
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

export function detailsTabFor(state: LayoutState, botId: string): DetailsTab {
  return state.detailsTabs[botId] ?? 'details'
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
