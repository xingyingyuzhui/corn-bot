import { useId, useMemo } from 'react'
import {
  AVATAR_VIEWBOX,
  avatarDetailFor,
  cornAvatarArtwork,
} from './artwork.ts'
import { svgIdPrefix, svgNodeToReact } from './svg-react.ts'
import type { CornAvatarVariant } from './variants.ts'

export interface StaticAvatarProps {
  readonly variant: CornAvatarVariant
  readonly size: number
}

/** One still frame of the Corn artwork; no animation runtime is loaded. */
export function StaticAvatar({ variant, size }: StaticAvatarProps) {
  const idPrefix = svgIdPrefix(useId())
  const detail = avatarDetailFor(size)
  const children = useMemo(
    () => cornAvatarArtwork({ variant, idPrefix, detail }).map(svgNodeToReact),
    [variant, idPrefix, detail],
  )
  return (
    <svg
      className="corn-avatar__art"
      width={size}
      height={size}
      viewBox={AVATAR_VIEWBOX}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}
