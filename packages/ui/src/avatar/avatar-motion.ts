import type { AvatarVisualState } from '@corn-bot/contracts/avatar'
import type { AvatarFrame } from './artwork.ts'
import {
  blendMotionFrames,
  sampleMotionFrame,
  TRANSITION_MS,
  transitionAmount,
} from './motion-presets.ts'
import type { MotionScheduler } from './motion-scheduler.ts'

export interface AvatarMotionOptions {
  readonly scheduler: MotionScheduler
  readonly state: AvatarVisualState
  readonly seed: number
  readonly displaySize: number
  readonly onFrame: (frame: AvatarFrame) => void
}

export interface AvatarMotion {
  /** Blends from the current frame; the caller owns which state is shown. */
  setState(state: AvatarVisualState): void
  setDisplaySize(size: number): void
  frame(): AvatarFrame
  destroy(): void
}

/**
 * One animated avatar on the shared scheduler. It only renders the state it
 * is given and never moves to another state on its own.
 */
export function createAvatarMotion({
  scheduler,
  state: initialState,
  seed,
  displaySize: initialSize,
  onFrame,
}: AvatarMotionOptions): AvatarMotion {
  let state = initialState
  let displaySize = initialSize
  let stateStart = scheduler.now()
  let transition: {
    readonly from: AvatarFrame
    readonly start: number
  } | null = null
  let destroyed = false

  const compute = (now: number): AvatarFrame => {
    const target = sampleMotionFrame({
      state,
      stateTimeMs: now - stateStart,
      seed,
      displaySize,
    })
    if (!transition) return target
    const elapsed = now - transition.start
    if (elapsed >= TRANSITION_MS) {
      transition = null
      return target
    }
    return blendMotionFrames(transition.from, target, transitionAmount(elapsed))
  }

  let current = compute(stateStart)
  const unregister = scheduler.register((now) => {
    current = compute(now)
    onFrame(current)
  })

  return {
    setState(next) {
      if (destroyed || next === state) return
      const now = scheduler.now()
      transition = { from: compute(now), start: now }
      state = next
      stateStart = now
      current = compute(now)
      onFrame(current)
    },
    setDisplaySize(size) {
      if (destroyed || size === displaySize) return
      displaySize = size
    },
    frame: () => current,
    destroy() {
      if (destroyed) return
      destroyed = true
      transition = null
      unregister()
    },
  }
}
