import type { BotEditorSpec } from './bot-editor-controller.ts'
import { canSaveChoice, modelChoices } from './model-choice.ts'
import {
  draftFromBot,
  isProfileField,
  type ProfileDraft,
  profilePatch,
} from './profile-form.ts'

/** Name, role, work style and role avatar; the one write path for dialog and subpage. */
export const PROFILE_EDITOR: BotEditorSpec<ProfileDraft> = {
  fromBot: draftFromBot,
  changed: (bot, draft) => Object.keys(profilePatch(bot, draft)).length > 0,
  precheck: () => null,
  write: (repository, bot, draft) =>
    repository.updateBotProfile(bot.id, profilePatch(bot, draft), bot.revision),
  fieldOf: (error) => {
    switch (error.code) {
      case 'validation':
      case 'duplicate':
        return isProfileField(error.field) ? error.field : null
      case 'conflict':
      case 'not-found':
      case 'stale':
      case 'read-only':
      case 'unavailable':
        return null
      default: {
        const unreachable: never = error.code
        throw new Error(`Unknown error code ${JSON.stringify(unreachable)}`)
      }
    }
  },
}

export const MODEL_UNAVAILABLE_ERROR = '这个模型当前不可用，请选择其他模型'

/** `null` follows the global default; the global default itself lives in Settings. */
export const MODEL_EDITOR: BotEditorSpec<string | null> = {
  fromBot: (bot) => bot.modelOverride,
  changed: (bot, choice) => choice !== bot.modelOverride,
  precheck: (repository, bot, choice) =>
    canSaveChoice(
      modelChoices(repository.getSnapshot().models),
      bot.modelOverride,
      choice,
    )
      ? null
      : MODEL_UNAVAILABLE_ERROR,
  write: (repository, bot, choice) =>
    repository.setBotModel(bot.id, choice, bot.revision),
  fieldOf: () => null,
}
