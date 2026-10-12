import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type AvatarVisualState,
  stableAvatarHash,
} from '@corn-bot/contracts/avatar'
import type { AvatarFrame } from '../src/avatar/artwork.ts'
import {
  type AvatarMotion,
  createAvatarMotion,
} from '../src/avatar/avatar-motion.ts'
import {
  type IntersectionLike,
  type MotionEnvironment,
  watchMotionGate,
} from '../src/avatar/motion-gate.ts'
import { sampleMotionFrame } from '../src/avatar/motion-presets.ts'
import {
  createMotionScheduler,
  type MotionScheduler,
} from '../src/avatar/motion-scheduler.ts'
import { virtualClock } from './helpers/virtual-clock.ts'

/** Browser stand-ins that count every live listener and observer. */
function fakeEnvironment({
  hidden = false,
  reduced = false,
  intersection = true,
} = {}) {
  const listeners = new Set<() => void>()
  const mediaListeners = new Set<() => void>()
  const observers: {
    callback: (entries: IntersectionLike[]) => void
    live: boolean
  }[] = []
  const media = {
    matches: reduced,
    addEventListener: (_: 'change', listener: () => void) =>
      mediaListeners.add(listener),
    removeEventListener: (_: 'change', listener: () => void) =>
      mediaListeners.delete(listener),
  }
  const document = {
    hidden,
    addEventListener: (_: 'visibilitychange', listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: 'visibilitychange', listener: () => void) =>
      listeners.delete(listener),
  }
  const env: MotionEnvironment = {
    document,
    reducedMotion: media,
    ...(intersection
      ? {
          observeIntersection: (
            callback: (entries: IntersectionLike[]) => void,
          ) => {
            const observer = { callback, live: false }
            observers.push(observer)
            return {
              observe: () => {
                observer.live = true
              },
              disconnect: () => {
                observer.live = false
              },
            }
          },
        }
      : {}),
  }
  return {
    env,
    get live() {
      return (
        listeners.size +
        mediaListeners.size +
        observers.filter((observer) => observer.live).length
      )
    },
    get liveObservers() {
      return observers.filter((observer) => observer.live).length
    },
    intersect(isIntersecting: boolean) {
      for (const observer of observers)
        if (observer.live) observer.callback([{ isIntersecting }])
    },
    setHidden(value: boolean) {
      document.hidden = value
      for (const listener of [...listeners]) listener()
    },
    setReduced(value: boolean) {
      media.matches = value
      for (const listener of [...mediaListeners]) listener()
    },
    lateCallbacks() {
      for (const observer of observers)
        observer.callback([{ isIntersecting: true }])
    },
  }
}

const target = {} as Element

/**
 * The effect sequence of one `AvatarRenderer` Corn slot: the lifecycle gate
 * runs only when motion is enabled, and the motion instance exists only while
 * the gate allows it, exactly as `useAvatarLifecycle` + `CornMotionAvatar` do.
 */
function mountSlot(
  env: MotionEnvironment,
  scheduler: MotionScheduler,
  options: { enabled: boolean; botId: string; state: AvatarVisualState },
) {
  let motion: AvatarMotion | null = null
  let frames: AvatarFrame[] = []
  const stopGate = options.enabled
    ? watchMotionGate(target, env, (allowed) => {
        if (allowed && !motion)
          motion = createAvatarMotion({
            scheduler,
            state: options.state,
            seed: stableAvatarHash(options.botId),
            displaySize: 32,
            onFrame: (frame) => {
              frames = [...frames, frame]
            },
          })
        if (!allowed) {
          motion?.destroy()
          motion = null
        }
      })
    : () => {}
  return {
    get animated() {
      return motion !== null
    },
    get frames() {
      return frames
    },
    setState: (state: AvatarVisualState) => motion?.setState(state),
    unmount() {
      stopGate()
      motion?.destroy()
      motion = null
    },
  }
}

function harness(env = fakeEnvironment()) {
  const host = virtualClock()
  return { env, host, scheduler: createMotionScheduler(host.clock) }
}

test('app setting off renders static with no listener, observer or frame', () => {
  const { env, host, scheduler } = harness()
  const slot = mountSlot(env.env, scheduler, {
    enabled: false,
    botId: 'b1',
    state: 'writing',
  })
  assert.equal(slot.animated, false)
  assert.equal(env.live, 0)
  assert.equal(host.pendingCount, 0)
  slot.unmount()
})

test('off screen until the first intersection report, then animates', () => {
  const { env, host, scheduler } = harness()
  const slot = mountSlot(env.env, scheduler, {
    enabled: true,
    botId: 'b1',
    state: 'idle',
  })
  assert.equal(slot.animated, false)
  assert.equal(host.pendingCount, 0)
  env.intersect(true)
  assert.equal(slot.animated, true)
  assert.equal(host.pendingCount, 1)
  env.intersect(false)
  assert.equal(slot.animated, false)
  assert.equal(host.pendingCount, 0)
  assert.equal(scheduler.registered, 0)
  slot.unmount()
  assert.equal(env.live, 0)
})

test('hidden document and reduced motion fall back to static with no frame loop', () => {
  for (const [initial, toggle] of [
    [
      { hidden: true },
      (env: ReturnType<typeof fakeEnvironment>, on: boolean) =>
        env.setHidden(!on),
    ],
    [
      { reduced: true },
      (env: ReturnType<typeof fakeEnvironment>, on: boolean) =>
        env.setReduced(!on),
    ],
  ] as const) {
    const { env, host, scheduler } = harness(fakeEnvironment(initial))
    const slot = mountSlot(env.env, scheduler, {
      enabled: true,
      botId: 'b1',
      state: 'searching',
    })
    env.intersect(true)
    assert.equal(slot.animated, false)
    assert.equal(host.pendingCount, 0)
    toggle(env, true)
    assert.equal(slot.animated, true)
    assert.equal(host.pendingCount, 1)
    toggle(env, false)
    assert.equal(slot.animated, false)
    assert.equal(host.pendingCount, 0)
    slot.unmount()
    assert.equal(env.live, 0)
  }
})

test('without IntersectionObserver the avatar counts as on screen', () => {
  const { env, host, scheduler } = harness(
    fakeEnvironment({ intersection: false }),
  )
  const slot = mountSlot(env.env, scheduler, {
    enabled: true,
    botId: 'b1',
    state: 'idle',
  })
  assert.equal(slot.animated, true)
  assert.equal(host.pendingCount, 1)
  slot.unmount()
  assert.equal(host.pendingCount, 0)
  assert.equal(env.live, 0)
})

test('StrictMode double mount leaves one observer and one frame loop, then none', () => {
  const { env, host, scheduler } = harness()
  const options = { enabled: true, botId: 'b1', state: 'writing' } as const
  const first = mountSlot(env.env, scheduler, options)
  env.intersect(true)
  first.unmount()
  assert.equal(env.live, 0)
  assert.equal(host.pendingCount, 0)
  const second = mountSlot(env.env, scheduler, options)
  env.intersect(true)
  assert.equal(env.liveObservers, 1)
  assert.equal(host.pendingCount, 1)
  assert.equal(scheduler.registered, 1)
  second.unmount()
  assert.equal(env.live, 0)
  assert.equal(host.pendingCount, 0)
  assert.equal(scheduler.registered, 0)
})

test('twenty visible avatars share one frame request; unmounting all leaves zero', () => {
  const { env, host, scheduler } = harness()
  const slots = Array.from({ length: 20 }, (_, index) =>
    mountSlot(env.env, scheduler, {
      enabled: true,
      botId: `bot-${index}`,
      state: index % 2 ? 'searching' : 'idle',
    }),
  )
  env.intersect(true)
  for (let t = 0; t <= 200; t += 16) {
    host.frame(t)
    assert.equal(host.pendingCount, 1)
  }
  assert.equal(scheduler.registered, 20)
  assert.ok(slots.every((slot) => slot.frames.length > 0))
  for (const slot of slots) slot.unmount()
  assert.equal(host.pendingCount, 0)
  assert.equal(scheduler.registered, 0)
  assert.equal(env.live, 0)
})

test('switching Bot replaces the instance with the new seed and no leftover loop', () => {
  const { env, host, scheduler } = harness()
  const first = mountSlot(env.env, scheduler, {
    enabled: true,
    botId: 'bot-a',
    state: 'idle',
  })
  env.intersect(true)
  for (let t = 0; t <= 700; t += 20) host.frame(t)
  first.unmount()
  const second = mountSlot(env.env, scheduler, {
    enabled: true,
    botId: 'bot-b',
    state: 'idle',
  })
  env.intersect(true)
  assert.equal(scheduler.registered, 1)
  assert.equal(host.pendingCount, 1)
  for (let t = 720; t <= 1420; t += 20) host.frame(t)
  assert.notDeepEqual(second.frames.at(-1), first.frames.at(-1))
  second.unmount()
  assert.equal(host.pendingCount, 0)
  assert.equal(env.live, 0)
})

test('destroy is idempotent and late browser callbacks after it are ignored', () => {
  const { env, host, scheduler } = harness()
  let changes = 0
  const stop = watchMotionGate(target, env.env, () => {
    changes++
  })
  const motion = createAvatarMotion({
    scheduler,
    state: 'alerting',
    seed: 1,
    displaySize: 14,
    onFrame: () => {},
  })
  stop()
  stop()
  motion.destroy()
  motion.destroy()
  const before = changes
  env.lateCallbacks()
  env.setHidden(true)
  motion.setState('idle')
  assert.equal(changes, before)
  assert.equal(env.live, 0)
  assert.equal(host.pendingCount, 0)
  assert.equal(scheduler.registered, 0)
})

test('the engine keeps rendering the given state and never moves on by itself', () => {
  const { host, scheduler } = harness()
  const frames = new Map<number, AvatarFrame>()
  const motion = createAvatarMotion({
    scheduler,
    state: 'waking',
    seed: 7,
    displaySize: 48,
    onFrame: (frame) => frames.set(scheduler.now(), frame),
  })
  for (let t = 0; t <= 130_000; t += 50) host.frame(t)
  for (const [time, frame] of frames)
    assert.deepEqual(
      frame,
      sampleMotionFrame({
        state: 'waking',
        stateTimeMs: time,
        seed: 7,
        displaySize: 48,
      }),
    )
  assert.equal(frames.size, 2601)
  motion.destroy()
})
