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
