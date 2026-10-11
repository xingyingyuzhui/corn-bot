import { effectiveModel, modelLabel } from '../../model/models.ts'
import type { ModelSettings } from '../../model/workspace.ts'

export const MODEL_UNAVAILABLE_REASON = '这个模型当前不可用'

export interface ModelChoice {
  /** `null` follows the global default. */
  readonly value: string | null
  readonly label: string
  readonly detail: string
  /** Why the choice cannot be saved now; absent when it can. */
  readonly unavailable?: string
}

/** "跟随全局默认" first, then every catalog entry in catalog order. */
export function modelChoices(settings: ModelSettings): readonly ModelChoice[] {
  const global = effectiveModel({ modelOverride: null }, settings)
  const globalLabel = modelLabel(settings, settings.globalDefault) ?? '未设置'
  const follow: ModelChoice =
    global.status === 'ok'
      ? {
          value: null,
          label: `跟随全局默认（${globalLabel}）`,
          detail: '全局默认变更时，这个 Bot 跟着变',
        }
      : {
          value: null,
          label: `跟随全局默认（${globalLabel}）`,
          detail: '全局默认模型当前不可用',
          unavailable: '请先在设置中选择可用的全局默认模型',
        }
  return [
    follow,
    ...settings.catalog.map(
      (entry): ModelChoice =>
        entry.available
          ? { value: entry.id, label: entry.label, detail: entry.provider }
          : {
              value: entry.id,
              label: entry.label,
              detail: entry.provider,
              unavailable: MODEL_UNAVAILABLE_REASON,
            },
    ),
  ]
}

/** Saving is allowed only for a changed choice that can actually run. */
export function canSaveChoice(
  choices: readonly ModelChoice[],
  current: string | null,
  next: string | null,
): boolean {
  if (next === current) return false
  const choice = choices.find((entry) => entry.value === next)
  return choice !== undefined && choice.unavailable === undefined
}
