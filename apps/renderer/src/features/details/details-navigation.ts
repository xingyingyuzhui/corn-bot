/**
 * The one catalog of the Bot management pane: main tabs, configuration
 * subpages and library sections. Labels, keyboard movement, entry points
 * and restore validation all read from here.
 */

export const MAIN_TABS = ['overview', 'configuration', 'library'] as const
export type MainTab = (typeof MAIN_TABS)[number]

export const CONFIG_PAGES = [
  'home',
  'core',
  'model',
  'permissions',
  'skills',
] as const
export type ConfigPage = (typeof CONFIG_PAGES)[number]
export type ConfigSubpage = Exclude<ConfigPage, 'home'>

export const LIBRARY_SECTIONS = ['artifacts', 'memory'] as const
export type LibrarySection = (typeof LIBRARY_SECTIONS)[number]

export const MAIN_TAB_LABELS: Readonly<Record<MainTab, string>> = {
  overview: '概览',
  configuration: '配置',
  library: '资料库',
}

export interface ConfigPageEntry {
  readonly label: string
  /** What the page covers; shown under the heading. */
  readonly description: string
}

/** Configuration home lists these in this order. */
export const CONFIG_SUBPAGES: readonly ConfigSubpage[] = [
  'core',
  'model',
  'permissions',
  'skills',
]

export const CONFIG_PAGE_CATALOG: Readonly<
  Record<ConfigSubpage, ConfigPageEntry>
> = {
  core: {
    label: '核心设定',
    description: '名称、职责、工作风格，以及行为与身份设定',
  },
  model: {
    label: '模型',
    description: '跟随全局默认，或为这个 Bot 单独选择模型',
  },
  permissions: {
    label: '权限',
    description: '当前生效的权限与硬上限，以及本机操作能力',
  },
  skills: {
    label: '技能',
    description: '这个 Bot 可以使用的技能与不可用原因',
  },
}

export const LIBRARY_SECTION_LABELS: Readonly<Record<LibrarySection, string>> =
  {
    artifacts: '资料',
    memory: '记忆',
  }

/** Each part is remembered separately, so returning to a tab restores it. */
export interface DetailsLocation {
  readonly tab: MainTab
  readonly page: ConfigPage
  readonly section: LibrarySection
}

export const DEFAULT_LOCATION: DetailsLocation = {
  tab: 'overview',
  page: 'home',
  section: 'artifacts',
}

const LEGACY_TABS: Readonly<Record<string, DetailsLocation>> = {
  details: DEFAULT_LOCATION,
  library: { ...DEFAULT_LOCATION, tab: 'library', section: 'artifacts' },
  computer: { ...DEFAULT_LOCATION, tab: 'configuration', page: 'permissions' },
}

const member = <T extends string>(
  values: readonly T[],
  value: unknown,
): value is T => values.some((entry) => entry === value)

/**
 * Restores a stored location. Old `details | library | computer` tab ids
 * map to the new hierarchy, unknown tabs fall back to the overview and an
 * invalid subpage or section to that tab's home. M2 persistence reuses this.
 */
export function normalizeLocation(stored: unknown): DetailsLocation {
  if (typeof stored === 'string') {
    if (member(MAIN_TABS, stored)) return { ...DEFAULT_LOCATION, tab: stored }
    return LEGACY_TABS[stored] ?? DEFAULT_LOCATION
  }
  if (typeof stored !== 'object' || stored === null) return DEFAULT_LOCATION
  const { tab, page, section } = stored as Record<string, unknown>
  if (!member(MAIN_TABS, tab)) return DEFAULT_LOCATION
  return {
    tab,
    page: member(CONFIG_PAGES, page) ? page : 'home',
    section: member(LIBRARY_SECTIONS, section) ? section : 'artifacts',
  }
}

/** Arrow keys wrap, Home/End jump; any other key is not tab navigation. */
export function tabForKey(current: MainTab, key: string): MainTab | null {
  const index = MAIN_TABS.indexOf(current)
  const last = MAIN_TABS.length - 1
  switch (key) {
    case 'ArrowRight':
      return MAIN_TABS[index === last ? 0 : index + 1] ?? null
    case 'ArrowLeft':
      return MAIN_TABS[index === 0 ? last : index - 1] ?? null
    case 'Home':
      return MAIN_TABS[0]
    case 'End':
      return MAIN_TABS[last] ?? null
    default:
      return null
  }
}

/** Entry points outside the pane: menus, shortcuts and approval cards. */
export type DetailsEntry = 'overview' | ConfigSubpage | LibrarySection

export function locationForEntry(
  current: DetailsLocation,
  entry: DetailsEntry,
): DetailsLocation {
  switch (entry) {
    case 'overview':
      return { ...current, tab: 'overview' }
    case 'core':
    case 'model':
    case 'permissions':
    case 'skills':
      return { ...current, tab: 'configuration', page: entry }
    case 'artifacts':
    case 'memory':
      return { ...current, tab: 'library', section: entry }
    default: {
      const unreachable: never = entry
      throw new Error(`Unknown details entry ${String(unreachable)}`)
    }
  }
}

/** The view a location shows; per-view scroll positions are keyed by it. */
export function viewKey(location: DetailsLocation): string {
  switch (location.tab) {
    case 'overview':
      return 'overview'
    case 'configuration':
      return `configuration/${location.page}`
    case 'library':
      return `library/${location.section}`
    default: {
      const unreachable: never = location.tab
      throw new Error(`Unknown details tab ${String(unreachable)}`)
    }
  }
}

/** The configuration subpage on screen, if any; only these hold drafts. */
export function openSubpage(location: DetailsLocation): ConfigSubpage | null {
  return location.tab === 'configuration' && location.page !== 'home'
    ? location.page
    : null
}

/** Where focus lands after a navigation inside the pane. */
export type DetailsFocusTarget =
  | { readonly kind: 'page-heading' }
  | { readonly kind: 'config-entry'; readonly page: ConfigSubpage }
