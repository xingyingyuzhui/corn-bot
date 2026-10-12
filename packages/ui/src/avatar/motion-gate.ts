export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export interface MediaQueryLike {
  readonly matches: boolean
  addEventListener(type: 'change', listener: () => void): void
  removeEventListener(type: 'change', listener: () => void): void
}

export interface VisibilityDocumentLike {
  readonly hidden: boolean
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

export interface IntersectionLike {
  readonly isIntersecting: boolean
}

export interface IntersectionObserverLike {
  observe(target: Element): void
  disconnect(): void
}

export interface MotionEnvironment {
  readonly document: VisibilityDocumentLike
  readonly reducedMotion?: MediaQueryLike
  readonly observeIntersection?: (
    callback: (entries: readonly IntersectionLike[]) => void,
  ) => IntersectionObserverLike
}

export function browserMotionEnvironment(view: Window): MotionEnvironment {
  const reducedMotion = view.matchMedia?.(REDUCED_MOTION_QUERY)
  const Observer = (
    view as Window & {
      readonly IntersectionObserver?: typeof IntersectionObserver
    }
  ).IntersectionObserver
  return {
    document: view.document,
    ...(reducedMotion ? { reducedMotion } : {}),
    ...(Observer
      ? {
          observeIntersection: (
            callback: (entries: readonly IntersectionLike[]) => void,
          ) => new Observer((entries) => callback(entries)),
        }
      : {}),
  }
}

/**
 * Reports whether `target` may animate: document visible, no reduced-motion
 * preference and on screen. Until the first intersection report the target
 * counts as off screen, so nothing animates before it is known to be seen.
 * The returned function removes every listener and observer.
 */
export function watchMotionGate(
  target: Element,
  env: MotionEnvironment,
  onChange: (allowed: boolean) => void,
): () => void {
  let onScreen = env.observeIntersection === undefined
  let disposed = false
  let reported: boolean | null = null

  const report = () => {
    if (disposed) return
    const allowed =
      onScreen && !env.document.hidden && !env.reducedMotion?.matches
    if (allowed === reported) return
    reported = allowed
    onChange(allowed)
  }
  const observer = env.observeIntersection?.((entries) => {
    const latest = entries.at(-1)
    if (!latest) return
    onScreen = latest.isIntersecting
    report()
  })
  env.document.addEventListener('visibilitychange', report)
  env.reducedMotion?.addEventListener('change', report)
  observer?.observe(target)
  report()

  return () => {
    if (disposed) return
    disposed = true
    observer?.disconnect()
    env.document.removeEventListener('visibilitychange', report)
    env.reducedMotion?.removeEventListener('change', report)
  }
}
