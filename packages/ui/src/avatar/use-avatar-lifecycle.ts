import { type RefObject, useEffect, useState } from 'react'
import { browserMotionEnvironment, watchMotionGate } from './motion-gate.ts'

/**
 * Whether the avatar in `target` may animate now. With `enabled` false (app
 * setting off or no motion requested) nothing is observed at all.
 */
export function useAvatarLifecycle(
  target: RefObject<Element | null>,
  enabled: boolean,
): boolean {
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    const element = target.current
    const view = element?.ownerDocument.defaultView
    if (!enabled || !element || !view) return
    const stop = watchMotionGate(
      element,
      browserMotionEnvironment(view),
      setAllowed,
    )
    return () => {
      stop()
      setAllowed(false)
    }
  }, [enabled, target])
  return enabled && allowed
}
