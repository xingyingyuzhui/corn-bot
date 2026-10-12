import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createMotionScheduler,
  DEFAULT_MAX_FRAME_GAP_MS,
} from '../src/avatar/motion-scheduler.ts'
import { virtualClock } from './helpers/virtual-clock.ts'

test('any number of registered avatars share exactly one pending frame', () => {
  const host = virtualClock()
  const scheduler = createMotionScheduler(host.clock)
  const seen = new Map<number, number[]>()
  const stops = Array.from({ length: 24 }, (_, index) =>
    scheduler.register((now) => {
      seen.set(index, [...(seen.get(index) ?? []), now])
    }),
  )
  assert.equal(host.pendingCount, 1)
  for (let frame = 0; frame <= 10; frame++) {
    host.frame(frame * 16)
    assert.equal(host.pendingCount, 1)
  }
  assert.equal(seen.size, 24)
  assert.ok([...seen.values()].every((times) => times.length === 11))
  for (const stop of stops) stop()
  assert.equal(host.pendingCount, 0)
  assert.equal(scheduler.pending, false)
  assert.equal(scheduler.registered, 0)
})

test('the frame loop stops with the last registration and restarts without a jump', () => {
  const host = virtualClock()
  const scheduler = createMotionScheduler(host.clock)
  const stop = scheduler.register(() => {})
  host.frame(1000)
  host.frame(1016)
  assert.equal(scheduler.now(), 16)
  stop()
  stop()
  assert.equal(host.pendingCount, 0)
  const restart = scheduler.register(() => {})
  host.frame(60_000)
  assert.equal(scheduler.now(), 16)
  host.frame(60_010)
  assert.equal(scheduler.now(), 26)
  restart()
  assert.equal(host.pendingCount, 0)
})

test('a long gap between frames advances motion time by the cap only', () => {
  const host = virtualClock()
  const scheduler = createMotionScheduler(host.clock)
  const stop = scheduler.register(() => {})
  host.frame(0)
  host.frame(16)
  host.frame(5016)
  assert.equal(scheduler.now(), 16 + DEFAULT_MAX_FRAME_GAP_MS)
  host.frame(5032)
  assert.equal(scheduler.now(), 32 + DEFAULT_MAX_FRAME_GAP_MS)
  host.frame(5000)
  assert.equal(scheduler.now(), 32 + DEFAULT_MAX_FRAME_GAP_MS)
  stop()
})

test('motion time is the same at the same timestamp for any frame rate', () => {
  const times = (timestamps: readonly number[]) => {
    const host = virtualClock()
    const scheduler = createMotionScheduler(host.clock)
    const stop = scheduler.register(() => {})
    for (const timestamp of timestamps) host.frame(timestamp)
    stop()
    return scheduler.now()
  }
  const at = (fps: number) =>
    Array.from({ length: fps * 2 + 1 }, (_, index) => (index * 1000) / fps)
  const irregular = [0]
  for (let index = 0; irregular.at(-1) !== 2000; index++) {
    const delta = [7, 33, 1, 99, 50, 10][index % 6] ?? 1
    irregular.push(Math.min(2000, (irregular.at(-1) ?? 0) + delta))
  }
  for (const timestamps of [at(30), at(60), at(120), at(144), irregular])
    assert.equal(times(timestamps), 2000)
})

test("an avatar removed during another avatar's tick is not called again", () => {
  const host = virtualClock()
  const scheduler = createMotionScheduler(host.clock)
  let laterCalls = 0
  let stopLater = () => {}
  const stopFirst = scheduler.register(() => stopLater())
  stopLater = scheduler.register(() => {
    laterCalls++
  })
  host.frame(0)
  assert.equal(laterCalls, 0)
  assert.equal(scheduler.registered, 1)
  stopFirst()
  assert.equal(host.pendingCount, 0)
})
