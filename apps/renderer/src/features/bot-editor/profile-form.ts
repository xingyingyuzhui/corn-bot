import { isCornAvatarVariantId } from '@corn-bot/contracts/avatar'
import type { BotProfilePatch } from '../../model/repository.ts'
import type { BotView } from '../../model/workspace.ts'

export interface ProfileDraft {
  readonly name: string
  readonly role: string
  readonly workStyle: string
  /** `null` while the Bot shows the placeholder and no role is chosen. */
  readonly variantId: string | null
}

const TEXT_FIELDS = ['name', 'role', 'workStyle'] as const

export type ProfileField = (typeof TEXT_FIELDS)[number] | 'variantId'

export const PROFILE_FIELDS: readonly ProfileField[] = [
  ...TEXT_FIELDS,
  'variantId',
]

export const draftFromBot = (bot: BotView): ProfileDraft => ({
  name: bot.name,
  role: bot.role,
  workStyle: bot.workStyle,
  variantId: isCornAvatarVariantId(bot.avatar.variantId)
    ? bot.avatar.variantId
    : null,
})

/** Only fields whose trimmed value changed, so a save never rewrites the rest. */
export function profilePatch(
  bot: BotView,
  draft: ProfileDraft,
): BotProfilePatch {
  const patch: { -readonly [K in keyof BotProfilePatch]: string } = {}
  for (const field of TEXT_FIELDS) {
    const next = draft[field].trim()
    if (next !== bot[field].trim()) patch[field] = next
  }
  if (draft.variantId !== null && draft.variantId !== bot.avatar.variantId)
    patch.variantId = draft.variantId
  return patch
}

export const isProfileField = (
  field: string | undefined,
): field is ProfileField => PROFILE_FIELDS.some((entry) => entry === field)
