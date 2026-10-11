import type { CSSProperties } from 'react'
import { AvatarBox } from './AvatarBox.tsx'

export interface InitialAvatarProps {
  readonly initial: string
  /** Hue in degrees for the disc behind the initial. */
  readonly hue: number
  readonly size: number
  readonly label?: string | undefined
}

/** Initial-on-a-disc look: accounts, and Bots without a known Corn variant. */
export function InitialAvatar({
  initial,
  hue,
  size,
  label,
}: InitialAvatarProps) {
  return (
    <AvatarBox
      size={size}
      label={label}
      data-kind="initial"
      style={{ '--corn-avatar-hue': String(hue) } as CSSProperties}
    >
      {initial}
    </AvatarBox>
  )
}
