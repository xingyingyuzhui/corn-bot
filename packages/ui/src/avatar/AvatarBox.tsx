import type { CSSProperties, ReactNode } from 'react'
import './avatar.css'

export interface AvatarBoxProps {
  readonly size: number
  /** Without a label the avatar is decorative; the name stays real text nearby. */
  readonly label?: string | undefined
  readonly style?: CSSProperties
  readonly children: ReactNode
  readonly [data: `data-${string}`]: string | undefined
}

/** Fixed-size slot shared by every avatar kind so layouts never shift. */
export function AvatarBox({
  size,
  label,
  style,
  children,
  ...data
}: AvatarBoxProps) {
  const sized = { ...style, '--corn-avatar-size': `${size}px` } as CSSProperties
  return label ? (
    <span
      {...data}
      className="corn-avatar"
      style={sized}
      role="img"
      aria-label={label}
    >
      {children}
    </span>
  ) : (
    <span {...data} className="corn-avatar" style={sized} aria-hidden="true">
      {children}
    </span>
  )
}
