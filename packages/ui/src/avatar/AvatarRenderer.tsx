import type { AvatarVisualState } from '@corn-bot/contracts/avatar'
import { lazy, Suspense, useRef } from 'react'
import { AvatarBox } from './AvatarBox.tsx'
import { InitialAvatar } from './InitialAvatar.tsx'
import { StaticAvatar } from './StaticAvatar.tsx'
import { UploadedAvatar } from './UploadedAvatar.tsx'
import { useAvatarLifecycle } from './use-avatar-lifecycle.ts'
import type { CornAvatarVariant } from './variants.ts'

// Loaded on demand so static-only screens never fetch the motion runtime.
const CornMotionAvatar = lazy(() =>
  import('./CornMotionAvatar.tsx').then((module) => ({
    default: module.CornMotionAvatar,
  })),
)

export type AvatarRenderSource =
  | { readonly kind: 'corn'; readonly variant: CornAvatarVariant }
  | { readonly kind: 'initial'; readonly initial: string; readonly hue: number }
  | { readonly kind: 'uploaded'; readonly src: string }

export interface AvatarMotionRequest {
  readonly state: AvatarVisualState
  /** Stable per Bot, e.g. `stableAvatarHash(botId)`. */
  readonly seed: number
  /** The app-level animated-avatars setting. */
  readonly enabled: boolean
}

export interface AvatarRendererProps {
  readonly source: AvatarRenderSource
  readonly size: number
  readonly label?: string | undefined
  readonly motion?: AvatarMotionRequest | undefined
}

/** Picks the uploaded, initial, static or animated Corn renderer. */
export function AvatarRenderer({
  source,
  size,
  label,
  motion,
}: AvatarRendererProps) {
  switch (source.kind) {
    case 'initial':
      return (
        <InitialAvatar
          initial={source.initial}
          hue={source.hue}
          size={size}
          label={label}
        />
      )
    case 'uploaded':
      return <UploadedAvatar src={source.src} size={size} label={label} />
    case 'corn':
      return (
        <CornAvatarSlot
          variant={source.variant}
          size={size}
          label={label}
          motion={motion}
        />
      )
    default: {
      const unknown: never = source
      throw new RangeError(
        `Unknown avatar source: ${String((unknown as AvatarRenderSource).kind)}`,
      )
    }
  }
}

interface CornAvatarSlotProps {
  readonly variant: CornAvatarVariant
  readonly size: number
  readonly label: string | undefined
  readonly motion: AvatarMotionRequest | undefined
}

function CornAvatarSlot({ variant, size, label, motion }: CornAvatarSlotProps) {
  const box = useRef<HTMLSpanElement>(null)
  const animate = useAvatarLifecycle(box, motion?.enabled === true)
  const still = <StaticAvatar variant={variant} size={size} />
  return (
    <AvatarBox
      ref={box}
      size={size}
      label={label}
      data-kind="corn"
      data-variant={variant.id}
      data-motion={animate ? 'running' : undefined}
    >
      {animate && motion ? (
        <Suspense fallback={still}>
          <CornMotionAvatar
            variant={variant}
            size={size}
            state={motion.state}
            seed={motion.seed}
          />
        </Suspense>
      ) : (
        still
      )}
    </AvatarBox>
  )
}
