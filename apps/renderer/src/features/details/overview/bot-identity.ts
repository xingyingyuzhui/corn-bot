import type {
  BotActivity,
  BotOrigin,
  BotView,
} from '../../../model/workspace.ts'
import { UNAVAILABLE } from '../../../shared/unavailable.ts'

export interface IdentityRow {
  readonly id: 'corn-bot' | 'claw-agent'
  readonly label: string
  /** Copyable value; `null` when there is no real ID to copy. */
  readonly value: string | null
  /** Why there is no value. */
  readonly note: string | null
}

const BINDING: Readonly<Record<BotOrigin, string>> = {
  fixture: '未绑定：示例 Bot 没有 Claw Agent',
  'mock-created': '未绑定：本地示例 Bot，尚未创建 Claw Agent',
  live: UNAVAILABLE.clawBinding,
}

export const ORIGIN_LABELS: Readonly<Record<BotOrigin, string>> = {
  fixture: '示例数据',
  'mock-created': '本地示例 Bot',
  live: '已连接的 Bot',
}

const ACTIVITY_LABELS: Readonly<Record<BotActivity, string>> = {
  idle: '空闲',
  working: '工作中',
  offline: '离线',
}

/**
 * Corn's own Bot ID and the bound Claw Agent ID are different things and
 * are labelled apart. M1 view models carry no Claw Agent ID, so none is
 * shown, let alone invented from the Corn ID.
 */
export function botIdentityRows(
  bot: Pick<BotView, 'id' | 'origin'>,
): readonly IdentityRow[] {
  return [
    { id: 'corn-bot', label: 'Corn Bot ID', value: bot.id, note: null },
    {
      id: 'claw-agent',
      label: 'Claw Agent ID',
      value: null,
      note: BINDING[bot.origin],
    },
  ]
}

export const bindingLabel = (origin: BotOrigin): string => BINDING[origin]

/** Fixture activity is display data, and says so. */
export function activityLabel(bot: Pick<BotView, 'activity' | 'origin'>) {
  const label = ACTIVITY_LABELS[bot.activity]
  return bot.origin === 'live' ? label : `${label}（示例数据，未运行）`
}
