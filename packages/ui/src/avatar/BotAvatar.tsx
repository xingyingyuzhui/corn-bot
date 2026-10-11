import { AvatarBox } from './AvatarBox.tsx'
import { InitialAvatar } from './InitialAvatar.tsx'
import { StaticAvatar } from './StaticAvatar.tsx'
import { findAvatarVariant } from './variants.ts'

/** The persisted avatar fields a Bot view model carries. */
export interface BotAvatarSource {
  readonly initial: string
  readonly hue: number
  readonly variantId?: string
}

export interface BotAvatarProps {
  readonly avatar: BotAvatarSource
  readonly size: number
  readonly label?: string | undefined
}

/**
 * The one Bot avatar entry point for every list, header, details and editor
 * slot. Unknown or missing variants keep the initial placeholder.
 */
export function BotAvatar({ avatar, size, label }: BotAvatarProps) {
  const variant = findAvatarVariant(avatar.variantId)
  if (!variant)
    return (
      <InitialAvatar
        initial={avatar.initial}
        hue={avatar.hue}
        size={size}
        label={label}
      />
    )
  return (
    <AvatarBox
      size={size}
      label={label}
      data-kind="corn"
      data-variant={variant.id}
    >
      <StaticAvatar variant={variant} size={size} />
    </AvatarBox>
  )
}
