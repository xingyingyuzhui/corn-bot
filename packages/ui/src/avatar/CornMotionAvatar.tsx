import type { AvatarVisualState } from '@corn-bot/contracts/avatar'
import { useId, useMemo } from 'react'
import {
  AVATAR_VIEWBOX,
  avatarDetailFor,
  cornAvatarArtwork,
} from './artwork.ts'
import { svgIdPrefix, svgNodeToReact } from './svg-react.ts'
import { useAvatarMotion } from './use-avatar-motion.ts'
import type { CornAvatarVariant } from './variants.ts'

export interface CornMotionAvatarProps {
  readonly variant: CornAvatarVariant
  readonly size: number
  readonly state: AvatarVisualState
  readonly seed: number
}

/** The animated Corn artwork; only mounted while motion is allowed. */
export function CornMotionAvatar({
  variant,
  size,
  state,
  seed,
}: CornMotionAvatarProps) {
  const idPrefix = svgIdPrefix(useId())
  const frame = useAvatarMotion({ state, seed, displaySize: size })
  const detail = avatarDetailFor(size)
  const children = useMemo(
    () =>
      cornAvatarArtwork({ variant, idPrefix, detail, frame }).map(
        svgNodeToReact,
      ),
    [variant, idPrefix, detail, frame],
  )
  return (
    <svg
      className="corn-avatar__art corn-avatar__art--motion"
      width={size}
      height={size}
      viewBox={AVATAR_VIEWBOX}
      aria-hidden="true"
      focusable="false"
      data-motion-state={state}
    >
      {children}
    </svg>
  )
}
