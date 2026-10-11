import { BotAvatar, InitialAvatar } from '@corn-bot/ui/avatar'
import type { AvatarSpec, PlaceholderAvatarSpec } from '../model/workspace.ts'

interface AvatarProps {
  readonly spec: AvatarSpec
  readonly size: number
  readonly label?: string
}

/** Bot avatar at a fixed slot size; every Bot usage site goes through here. */
export function Avatar({ spec, size, label }: AvatarProps) {
  return <BotAvatar avatar={spec} size={size} label={label} />
}

interface AccountAvatarProps {
  readonly spec: PlaceholderAvatarSpec
  readonly size: number
}

/** The user's own avatar keeps the initial look; it is never a Corn role. */
export function AccountAvatar({ spec, size }: AccountAvatarProps) {
  return <InitialAvatar initial={spec.initial} hue={spec.hue} size={size} />
}
