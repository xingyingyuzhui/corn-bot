import type { BotView, RosterView } from '../../model/workspace.ts'

export interface RosterFilter {
  readonly foldedGroupIds: readonly string[]
  /** Raw query; blank means no search. */
  readonly search: string
}

export interface RosterGroupSection {
  readonly id: string
  readonly label: string
  readonly bots: readonly BotView[]
  readonly folded: boolean
}

export interface RosterSections {
  readonly pinned: readonly BotView[]
  readonly groups: readonly RosterGroupSection[]
  readonly hidden: readonly BotView[]
  readonly searching: boolean
}

export const NO_FILTER: RosterFilter = { foldedGroupIds: [], search: '' }

/** The rail has no group headers or search field, so it shows everything. */
export function rosterFilterFor(
  collapsed: boolean,
  foldedGroupIds: readonly string[],
  search: string | undefined,
): RosterFilter {
  return collapsed ? NO_FILTER : { foldedGroupIds, search: search ?? '' }
}

/** Bots that are in no group and not pinned still need a home in the roster. */
export const UNLISTED_GROUP = { id: 'corn-unlisted', label: '其他' } as const

const normalise = (text: string) => text.trim().toLocaleLowerCase()

export function botMatches(
  bot: BotView,
  roster: RosterView,
  search: string,
): boolean {
  const query = normalise(search)
  if (!query) return true
  const tagLabels = bot.tagIds.map((id) => roster.tags[id]?.label ?? '')
  return [bot.name, bot.role, ...tagLabels].some((text) =>
    normalise(text).includes(query),
  )
}

/**
 * Pinned Bots render once, in the pinned strip, and leave their group list.
 * Hidden Bots render only in the hidden section. While searching, folds are
 * ignored so every match is reachable; empty groups are dropped.
 */
export function rosterSections(
  roster: RosterView,
  filter: RosterFilter,
): RosterSections {
  const searching = normalise(filter.search) !== ''
  const hidden = new Set(roster.hiddenBotIds)
  const pinnedIds = new Set(roster.pinnedBotIds)
  const matches = (bot: BotView) => botMatches(bot, roster, filter.search)
  const resolve = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const bot = roster.bots[id]
      return bot && !hidden.has(id) && matches(bot) ? [bot] : []
    })

  const grouped = new Set(roster.groups.flatMap((group) => group.botIds))
  const unlisted = Object.keys(roster.bots).filter(
    (id) => !grouped.has(id) && !pinnedIds.has(id),
  )
  const sourceGroups = unlisted.length
    ? [...roster.groups, { ...UNLISTED_GROUP, botIds: unlisted }]
    : roster.groups

  const groups = sourceGroups.flatMap((group) => {
    const bots = resolve(group.botIds.filter((id) => !pinnedIds.has(id)))
    if (searching && bots.length === 0) return []
    return [
      {
        id: group.id,
        label: group.label,
        bots,
        folded: !searching && filter.foldedGroupIds.includes(group.id),
      },
    ]
  })

  return {
    pinned: resolve(roster.pinnedBotIds),
    groups,
    hidden: roster.hiddenBotIds.flatMap((id) => {
      const bot = roster.bots[id]
      return bot && matches(bot) ? [bot] : []
    }),
    searching,
  }
}

/**
 * The order a person sees in the roster: pinned first, then each unfolded
 * group top to bottom. Hidden Bots and Bots inside folded groups are skipped
 * because they are not on screen. Alt+↑/↓ and Mod+1…9 walk this order.
 */
export function visibleBotOrder(
  roster: RosterView,
  filter: RosterFilter,
): readonly string[] {
  const sections = rosterSections(roster, filter)
  return [
    ...sections.pinned,
    ...sections.groups.flatMap((group) => (group.folded ? [] : group.bots)),
  ].map((bot) => bot.id)
}

export function adjacentBotId(
  order: readonly string[],
  currentId: string,
  step: 1 | -1,
): string | null {
  if (order.length === 0) return null
  const index = order.indexOf(currentId)
  if (index === -1) return (step === 1 ? order[0] : order.at(-1)) ?? null
  const next = order[index + step]
  return next ?? null
}
