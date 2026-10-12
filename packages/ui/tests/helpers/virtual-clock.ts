import type { FrameClock } from '../../src/avatar/motion-scheduler.ts'

/** Frame callbacks run only when a test calls `frame(timestamp)`. */
export function virtualClock() {
  let nextHandle = 1
  const pending = new Map<number, (timestamp: number) => void>()
  const clock: FrameClock = {
    request(callback) {
      const handle = nextHandle++
      pending.set(handle, callback)
      return handle
    },
    cancel(handle) {
      pending.delete(handle)
    },
  }
  return {
    clock,
    get pendingCount() {
      return pending.size
    },
    frame(timestamp: number) {
      const due = [...pending.values()]
      pending.clear()
      for (const callback of due) callback(timestamp)
    },
  }
}
