import { modelSummary } from '../../../model/models.ts'
import type {
  BotView,
  ModelSettings,
  PermissionRow,
} from '../../../model/workspace.ts'
import type { ConfigSubpage } from '../details-navigation.ts'
import type { SectionState } from '../section-state.ts'

/** An unknown permission list is not "no permissions". */
export function permissionSummary(
  rows: readonly PermissionRow[] | undefined,
): string {
  if (rows === undefined) return '尚未接通'
  return rows.length === 0
    ? '没有权限记录 · 只读'
    : `${rows.length} 项能力 · 只读`
}

const stateSummary = (state: SectionState): string => {
  switch (state.kind) {
    case 'unavailable':
      return '尚未接通'
    case 'loading':
      return '正在加载…'
    case 'empty':
      return state.text
    case 'error':
      return '读取失败'
    default: {
      const unreachable: never = state
      throw new Error(`Unknown section state ${JSON.stringify(unreachable)}`)
    }
  }
}

/** One line under each configuration entry. */
export function configSummaries(
  bot: BotView,
  models: ModelSettings,
  permissions: readonly PermissionRow[] | undefined,
  skills: SectionState,
): Readonly<Record<ConfigSubpage, string>> {
  return {
    core: bot.role || '未填写职责',
    model: modelSummary(bot, models),
    permissions: permissionSummary(permissions),
    skills: stateSummary(skills),
  }
}
