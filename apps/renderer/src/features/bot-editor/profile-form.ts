import type { BotProfilePatch } from '../../model/repository.ts'
import type { BotView } from '../../model/workspace.ts'

export interface ProfileDraft {
  readonly name: string
  readonly role: string
  readonly workStyle: string
}

export type ProfileField = keyof ProfileDraft

export const PROFILE_FIELDS: readonly ProfileField[] = [
  'name',
  'role',
  'workStyle',
]

export const draftFromBot = (bot: BotView): ProfileDraft => ({
  name: bot.name,
  role: bot.role,
  workStyle: bot.workStyle,
})

/** Only fields whose trimmed value changed, so a save never rewrites the rest. */
export function profilePatch(
  bot: BotView,
  draft: ProfileDraft,
): BotProfilePatch {
  const patch: { -readonly [K in ProfileField]?: string } = {}
  for (const field of PROFILE_FIELDS) {
    const next = draft[field].trim()
    if (next !== bot[field].trim()) patch[field] = next
  }
  return patch
}

export const isProfileField = (
  field: string | undefined,
): field is ProfileField => PROFILE_FIELDS.some((entry) => entry === field)
