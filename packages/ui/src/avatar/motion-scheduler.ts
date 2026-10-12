/** The host's frame callback API; injectable so tests drive a virtual clock. */
export interface FrameClock {
  request(callback: (timestamp: number) => void): number
  cancel(handle: number): void
}

export type MotionTick = (nowMs: number) => void

export interface MotionScheduler {
  /** Virtual motion time: wall time minus clamped gaps and stopped periods. */
  now(): number
  /** Starts the shared frame loop if needed; the returned function unregisters. */
  register(tick: MotionTick): () => void
  readonly registered: number
  readonly pending: boolean
}

export interface MotionSchedulerOptions {
  /** A longer gap between two frames advances motion time by only this much. */
  readonly maxFrameGapMs?: number
}

export const DEFAULT_MAX_FRAME_GAP_MS = 100

/**
 * One frame loop for every mounted animated avatar. Motion time is derived
 * from the frame timestamp, never accumulated per frame, so the same
 * timestamp yields the same time at any frame rate.
 */
export function createMotionScheduler(
  clock: FrameClock,
  { maxFrameGapMs = DEFAULT_MAX_FRAME_GAP_MS }: MotionSchedulerOptions = {},
): MotionScheduler {
  const entries = new Set<{ readonly tick: MotionTick }>()
  let handle: number | null = null
  let virtual = 0
  let offset = 0
  let last: number | null = null

  const frame = (timestamp: number) => {
    handle = null
    if (last === null) offset = timestamp - virtual
    else {
      const gap = timestamp - last
      if (gap > maxFrameGapMs) offset += gap - maxFrameGapMs
      else if (gap < 0) offset += gap
    }
    last = timestamp
    virtual = timestamp - offset
    for (const entry of [...entries])
      if (entries.has(entry)) entry.tick(virtual)
    if (entries.size > 0) handle = clock.request(frame)
    else last = null
  }

  return {
    now: () => virtual,
    register(tick) {
      const entry = { tick }
      entries.add(entry)
      if (handle === null) handle = clock.request(frame)
      return () => {
        if (!entries.delete(entry) || entries.size > 0) return
        if (handle !== null) clock.cancel(handle)
        handle = null
        last = null
      }
    },
    get registered() {
      return entries.size
    },
    get pending() {
      return handle !== null
    },
  }
}

let shared: MotionScheduler | null = null

/** The page-wide scheduler, created on first animated mount. */
export function sharedMotionScheduler(): MotionScheduler {
  shared ??= createMotionScheduler({
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
  })
  return shared
}
