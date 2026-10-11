/**
 * Renderer-only shell state. It never holds DSH runtime state: selection,
 * drafts, scroll positions and panel preferences only.
 */

export const DETAILS_TABS = ['details', 'library', 'computer'] as const
export type DetailsTab = (typeof DETAILS_TABS)[number]

/** `user-screenshots` profile, measured at 1024×764 CSS px, DPR 2 (ADR-0004). */
export const LAYOUT = {
  sidebarWidth: 276,
  detailsRatio: 0.367,
  chatMinWidth: 340,
  autoCompactBelow: 820,
} as const

export interface ChatScroll {
  readonly top: number
  readonly pinnedToBottom: boolean
}

export interface LayoutState {
  readonly selectedBotId: string
  readonly detailsOpen: boolean
  readonly detailsTabs: Readonly<Record<string, DetailsTab>>
  readonly drafts: Readonly<Record<string, string>>
  readonly scroll: Readonly<Record<string, ChatScroll>>
  readonly sidebarManualCollapsed: boolean
  readonly sidebarAutoCompact: boolean
}

export type LayoutAction =
  | { readonly type: 'select-bot'; readonly botId: string }
  | { readonly type: 'open-details' }
  | { readonly type: 'close-details' }
  | { readonly type: 'select-tab'; readonly tab: DetailsTab }
  | { readonly type: 'edit-draft'; readonly text: string }
  | { readonly type: 'record-scroll'; readonly scroll: ChatScroll }
  | { readonly type: 'toggle-sidebar' }
  | { readonly type: 'viewport'; readonly width: number }

export function initialLayout(selectedBotId: string): LayoutState {
  return {
    selectedBotId,
    detailsOpen: false,
    detailsTabs: {},
    drafts: {},
    scroll: {},
    sidebarManualCollapsed: false,
    sidebarAutoCompact: false,
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
        drafts: { ...state.drafts, [state.selectedBotId]: action.text },
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
    case 'viewport': {
      const compact = action.width < LAYOUT.autoCompactBelow
      return compact === state.sidebarAutoCompact
        ? state
        : { ...state, sidebarAutoCompact: compact }
    }
    default: {
      const unreachable: never = action
      throw new Error(`Unknown layout action ${JSON.stringify(unreachable)}`)
    }
  }
}

export function sidebarCollapsed(state: LayoutState): boolean {
  return state.sidebarManualCollapsed || state.sidebarAutoCompact
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
 */
export function resolveLayout(
  state: LayoutState,
  viewportWidth: number,
): ResolvedLayout {
  const collapsed = sidebarCollapsed(state)
  const sidebarWidth = collapsed ? 0 : LAYOUT.sidebarWidth
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
