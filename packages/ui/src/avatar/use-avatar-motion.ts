import type { AvatarVisualState } from '@corn-bot/contracts/avatar'
import { useEffect, useRef, useState } from 'react'
import type { AvatarFrame } from './artwork.ts'
import { type AvatarMotion, createAvatarMotion } from './avatar-motion.ts'
import { sampleMotionFrame } from './motion-presets.ts'
import { sharedMotionScheduler } from './motion-scheduler.ts'

export interface AvatarMotionInput {
  readonly state: AvatarVisualState
  readonly seed: number
  readonly displaySize: number
}

/**
 * The current frame of one animated avatar. State and size changes update the
 * running instance; a new seed (another Bot) replaces it.
 */
export function useAvatarMotion({
  state,
  seed,
  displaySize,
}: AvatarMotionInput): AvatarFrame {
  const [frame, setFrame] = useState(() =>
    sampleMotionFrame({ state, stateTimeMs: 0, seed, displaySize }),
  )
  const motion = useRef<AvatarMotion | null>(null)
  const latestState = useRef(state)
  const latestSize = useRef(displaySize)

  useEffect(() => {
    latestState.current = state
    motion.current?.setState(state)
  }, [state])
  useEffect(() => {
    latestSize.current = displaySize
    motion.current?.setDisplaySize(displaySize)
  }, [displaySize])
  useEffect(() => {
    const instance = createAvatarMotion({
      scheduler: sharedMotionScheduler(),
      state: latestState.current,
      seed,
      displaySize: latestSize.current,
      onFrame: setFrame,
    })
    motion.current = instance
    setFrame(instance.frame())
    return () => {
      instance.destroy()
      motion.current = null
    }
  }, [seed])

  return frame
}
