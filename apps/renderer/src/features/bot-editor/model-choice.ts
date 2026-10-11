import { type EffectiveModel, effectiveModel } from '../../model/models.ts'
import type { BotView, ModelSettings } from '../../model/workspace.ts'

export const MODEL_UNAVAILABLE_REASON = '这个模型当前不可用'

export interface ModelChoice {
  /** `null` follows the global default. */
  readonly value: string | null
  readonly label: string
  readonly detail: string
  /** Why the choice cannot be saved now; absent when it can. */
  readonly unavailable?: string
}

const labelOf = (settings: ModelSettings, id: string | null) =>
  id === null
    ? null
    : (settings.catalog.find((entry) => entry.id === id)?.label ?? id)

/** "跟随全局默认" first, then every catalog entry in catalog order. */
export function modelChoices(settings: ModelSettings): readonly ModelChoice[] {
  const global = effectiveModel({ modelOverride: null }, settings)
  const globalLabel = labelOf(settings, settings.globalDefault) ?? '未设置'
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

/** Short summary for menus: model label and whether it is the Bot's own. */
export function modelSummary(
  bot: Pick<BotView, 'modelOverride'>,
  settings: ModelSettings,
): string {
  const model = effectiveModel(bot, settings)
  const origin = model.source === 'global' ? '跟随全局' : '单独设置'
  switch (model.status) {
    case 'ok':
      return `${model.model.label}（${origin}）`
    case 'needs_model':
      return `需要选择模型（${origin}）`
    default: {
      const unreachable: never = model
      throw new Error(`Unknown model status ${JSON.stringify(unreachable)}`)
    }
  }
}

/**
 * The warning shown when the effective model cannot run. Corn never swaps in
 * a different model, so the user has to pick one.
 */
export function needsModelWarning(
  model: EffectiveModel,
  settings: ModelSettings,
): string | null {
  switch (model.status) {
    case 'ok':
      return null
    case 'needs_model': {
      const what =
        model.source === 'bot' ? '这个 Bot 单独设置的模型' : '全局默认模型'
      const name = labelOf(settings, model.requested)
      return name
        ? `${what}（${name}）当前不可用。Corn 不会自动换成其他模型，请选择一个可用的模型。`
        : `${what}尚未设置。Corn 不会自动选择模型，请选择一个可用的模型。`
    }
    default: {
      const unreachable: never = model
      throw new Error(`Unknown model status ${JSON.stringify(unreachable)}`)
    }
  }
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
