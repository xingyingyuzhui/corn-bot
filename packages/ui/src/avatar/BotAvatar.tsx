import {
  type AvatarVisualState,
  stableAvatarHash,
} from '@corn-bot/contracts/avatar'
import { AvatarRenderer, type AvatarRenderSource } from './AvatarRenderer.tsx'
import { findAvatarVariant } from './variants.ts'

/** The persisted avatar fields a Bot view model carries. */
export interface BotAvatarSource {
  readonly initial: string
  readonly hue: number
  readonly variantId?: string
}

/** Opt-in animation; without it every slot stays on the static artwork. */
export interface BotAvatarMotion {
  readonly botId: string
  readonly state: AvatarVisualState
  readonly enabled: boolean
}

export interface BotAvatarProps {
  readonly avatar: BotAvatarSource
  readonly size: number
  readonly label?: string | undefined
  readonly motion?: BotAvatarMotion | undefined
}

/**
 * The one Bot avatar entry point for every list, header, details and editor
 * slot. Unknown or missing variants keep the initial placeholder.
 */
export function BotAvatar({ avatar, size, label, motion }: BotAvatarProps) {
  const variant = findAvatarVariant(avatar.variantId)
  const source: AvatarRenderSource = variant
    ? { kind: 'corn', variant }
    : { kind: 'initial', initial: avatar.initial, hue: avatar.hue }
  return (
    <AvatarRenderer
      source={source}
      size={size}
      label={label}
      motion={
        motion && {
          state: motion.state,
          seed: stableAvatarHash(motion.botId),
          enabled: motion.enabled,
        }
      }
    />
  )
}
