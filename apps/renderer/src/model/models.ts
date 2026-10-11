import type { BotView, ModelOption, ModelSettings } from './workspace.ts'

export type EffectiveModel =
  | {
      readonly status: 'ok'
      readonly model: ModelOption
      readonly source: 'bot' | 'global'
    }
  | {
      readonly status: 'needs_model'
      readonly requested: string | null
      readonly source: 'bot' | 'global'
    }

/**
 * `effectiveModel = botOverride ?? globalDefault`, checked against the
 * catalog. An unknown or unavailable model is `needs_model`; Corn never
 * silently substitutes a different one.
 */
export function effectiveModel(
  bot: Pick<BotView, 'modelOverride'>,
  settings: ModelSettings,
): EffectiveModel {
  const source = bot.modelOverride === null ? 'global' : 'bot'
  const requested = bot.modelOverride ?? settings.globalDefault
  const model = settings.catalog.find((entry) => entry.id === requested)
  return model?.available
    ? { status: 'ok', model, source }
    : { status: 'needs_model', requested, source }
}

/** Catalog label for a model id; unknown ids show as themselves. */
export const modelLabel = (settings: ModelSettings, id: string | null) =>
  id === null
    ? null
    : (settings.catalog.find((entry) => entry.id === id)?.label ?? id)

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
      const name = modelLabel(settings, model.requested)
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
