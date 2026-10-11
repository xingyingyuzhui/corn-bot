import type { CSSProperties } from 'react'
import type { AvatarSpec } from '../model/workspace.ts'
import './avatar.css'

interface AvatarProps {
  readonly spec: AvatarSpec
  readonly size: number
  readonly label?: string
}

/** Static placeholder until the Corn-original avatar engine (PR-02D, ADR-0003). */
export function Avatar({ spec, size, label }: AvatarProps) {
  const style = {
    '--corn-avatar-size': `${size}px`,
    '--corn-avatar-hue': String(spec.hue),
  } as CSSProperties
  if (label)
    return (
      <span className="corn-avatar" style={style} role="img" aria-label={label}>
        {spec.initial}
      </span>
    )
  return (
    <span className="corn-avatar" style={style} aria-hidden="true">
      {spec.initial}
    </span>
  )
}
