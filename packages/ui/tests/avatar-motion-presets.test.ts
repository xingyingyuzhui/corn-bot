import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AVATAR_VISUAL_STATES,
  type AvatarVisualState,
  CORN_AVATAR_SHAPES,
  stableAvatarHash,
} from '@corn-bot/contracts/avatar'
import {
  type AvatarFrame,
  avatarDetailFor,
  cornAvatarArtwork,
  type SvgNode,
  serialiseSvgNodes,
} from '../src/avatar/artwork.ts'
import { createAvatarMotion } from '../src/avatar/avatar-motion.ts'
import type { AvatarMorph } from '../src/avatar/motion-frame.ts'
import {
  ALERT_CYCLE_MS,
  blendMotionFrames,
  INK_SAMPLES,
  isCompactMotion,
  MORPH_ENTER_MS,
  PROGRESS_REST_MS,
  PROGRESS_SHOW_MS,
  RADAR_CYCLE_MS,
  RADAR_RINGS,
  sampleMotionFrame,
  TRANSITION_MS,
  WAKING_SETTLE_MS,
  WRITING_CYCLE_MS,
  WRITING_DOWN_SHARE,
} from '../src/avatar/motion-presets.ts'
import { createMotionScheduler } from '../src/avatar/motion-scheduler.ts'
import {
  CORN_AVATAR_VARIANTS,
  findAvatarVariant,
} from '../src/avatar/variants.ts'
import { virtualClock } from './helpers/virtual-clock.ts'

const USAGE_SIZES = [14, 24, 30, 32, 36, 48, 52, 60, 144] as const
const SAMPLE_MS = [
  0, 250, 500, 1000, 1500, 1700, 2000, 2500, 3000, 3500, 4000, 6000, 10_000,
  1e9,
]
const SEED = stableAvatarHash('bot-fixture-1')
const xiaohuang = findAvatarVariant('xiaohuang')
if (!xiaohuang) throw new Error('missing fixture variant')

const sample = (
  state: AvatarVisualState,
  stateTimeMs: number,
  displaySize = 48,
  seed = SEED,
) => sampleMotionFrame({ state, stateTimeMs, seed, displaySize })

const walk = (nodes: readonly SvgNode[]): SvgNode[] =>
  nodes.flatMap((node) => [node, ...walk(node.children ?? [])])

const render = (frame: AvatarFrame, size = 48) =>
  cornAvatarArtwork({
    variant: xiaohuang,
    idPrefix: 'm',
    detail: avatarDetailFor(size),
    frame,
  })

const eyeCount = (frame: AvatarFrame, size = 48) =>
  walk(render(frame, size)).filter((node) => node.tag === 'rect').length

function morphOf<K extends AvatarMorph['kind']>(
  frame: AvatarFrame,
  kind: K,
): Extract<AvatarMorph, { kind: K }> {
  assert.equal(frame.morph?.kind, kind)
  return frame.morph as Extract<AvatarMorph, { kind: K }>
}

/** Runs one avatar through a fixed script and returns frames at checkpoints. */
function scripted(timestamps: readonly number[]) {
  const host = virtualClock()
  const scheduler = createMotionScheduler(host.clock)
  const motion = createAvatarMotion({
    scheduler,
    state: 'writing',
    seed: SEED,
    displaySize: 52,
    onFrame: () => {},
  })
  const script = new Map<number, AvatarVisualState>([
    [1000, 'searching'],
    [2000, 'idle'],
  ])
  const checkpoints = new Map<number, AvatarFrame>()
  for (const timestamp of timestamps) {
    host.frame(timestamp)
    const next = script.get(timestamp)
    if (next) motion.setState(next)
    if ([500, 1100, 2100, 3000].includes(timestamp))
      checkpoints.set(timestamp, motion.frame())
  }
  motion.destroy()
  return checkpoints
}

test('frames are a pure function of state, time, seed and size', () => {
  for (const state of AVATAR_VISUAL_STATES)
    for (const time of SAMPLE_MS)
      assert.deepEqual(sample(state, time), sample(state, time))
  assert.notDeepEqual(
    sample('idle', 700, 48, stableAvatarHash('bot-a')),
    sample('idle', 700, 48, stableAvatarHash('bot-b')),
  )
})

test('the same time gives the same frame at 30, 60, 120 FPS and irregular deltas', () => {
  const at = (fps: number) =>
    Array.from({ length: fps * 3 + 1 }, (_, index) => (index * 1000) / fps)
  const irregular = [0]
  for (let index = 0; irregular.at(-1) !== 3000; index++) {
    const previous = irregular.at(-1) ?? 0
    const delta = [9, 41, 3, 97, 16, 34][index % 6] ?? 1
    const next = Math.min(3000, previous + delta)
    // Every script and checkpoint time must be an actual frame.
    const stop = [500, 1000, 1100, 2000, 2100].find(
      (mark) => previous < mark && mark < next,
    )
    irregular.push(stop ?? next)
  }
  const reference = scripted(at(60))
  assert.equal(reference.size, 4)
  for (const timestamps of [at(30), at(120), irregular])
    assert.deepEqual(scripted(timestamps), reference)
})

test('every state renders finite geometry at every usage size', () => {
  const variants = CORN_AVATAR_SHAPES.map((shape) => {
    const variant = CORN_AVATAR_VARIANTS.find((item) => item.shape === shape)
    assert.ok(variant, shape)
    return variant
  })
  for (const size of USAGE_SIZES)
    for (const state of AVATAR_VISUAL_STATES)
      for (const time of SAMPLE_MS) {
        const frame = sample(state, time, size)
        for (const variant of variants) {
          const markup = serialiseSvgNodes(
            cornAvatarArtwork({
              variant,
              idPrefix: 'f',
              detail: avatarDetailFor(size),
              frame,
            }),
          )
          assert.doesNotMatch(
            markup,
            /NaN|Infinity|undefined/,
            `${variant.id}/${state}@${size}px t=${time}`,
          )
        }
      }
})

test('14 px uses the compact loop and detail but keeps every morph part', () => {
  assert.equal(isCompactMotion(14), true)
  assert.equal(isCompactMotion(47), true)
  assert.equal(isCompactMotion(48), false)
  assert.equal(avatarDetailFor(14), 'compact')
  assert.equal(sample('idle', 900, 14).tilt, 0)
  assert.notEqual(sample('idle', 900, 144).tilt, 0)
  const nodes = walk(render(sample('searching', 2000, 14), 14))
  assert.ok(nodes.every((node) => node.attrs.id === undefined))
  assert.equal(
    nodes.filter((node) => node.tag === 'circle' && node.attrs.fill === 'none')
      .length,
    RADAR_RINGS,
  )
})

test('writing draws for 68% of 2500 ms, then lifts and erases its trail by time', () => {
  const downEnd = WRITING_CYCLE_MS * WRITING_DOWN_SHARE
  const cycleStart = WRITING_CYCLE_MS * 2
  let previousInk = 0
  for (let t = cycleStart; t < cycleStart + downEnd; t += 50) {
    const writing = morphOf(sample('writing', t), 'writing')
    assert.equal(writing.pen.lift, 0)
    assert.equal(writing.eyesHidden, true)
    assert.ok(writing.ink.length >= previousInk)
    previousInk = writing.ink.length
  }
  let previousErased = INK_SAMPLES + 1
  for (
    let t = cycleStart + downEnd + 10;
    t < cycleStart + WRITING_CYCLE_MS;
    t += 50
  ) {
    const writing = morphOf(sample('writing', t), 'writing')
    assert.ok(writing.pen.lift > 0)
    assert.ok(writing.ink.length <= previousErased)
    previousErased = writing.ink.length
  }
  assert.ok(
    morphOf(sample('writing', cycleStart + WRITING_CYCLE_MS - 1), 'writing').ink
      .length <= 1,
  )
  for (let t = 0; t < 10_000; t += 7)
    assert.ok(
      morphOf(sample('writing', t), 'writing').ink.length <= INK_SAMPLES + 1,
    )
  assert.deepEqual(
    sample('writing', 1234).morph,
    sample('writing', 1234 + WRITING_CYCLE_MS).morph,
  )
})

test('searching is a 1300 ms radar with three staggered fading rings, thinking is dots', () => {
  const radar = morphOf(sample('searching', 2000), 'radar')
  assert.equal(radar.rings.length, RADAR_RINGS)
  const radii = radar.rings.map((ring) => ring.radius)
  assert.equal(new Set(radii).size, RADAR_RINGS)
  const byRadius = [...radar.rings].sort((a, b) => a.radius - b.radius)
  for (let index = 1; index < byRadius.length; index++)
    assert.ok(
      (byRadius[index]?.opacity ?? 1) < (byRadius[index - 1]?.opacity ?? 0),
    )
  assert.deepEqual(
    sample('searching', 2000).morph,
    sample('searching', 2000 + RADAR_CYCLE_MS).morph,
  )
  assert.equal(morphOf(sample('thinking', 2000), 'thinking').sideDots.length, 2)
})

test('progress shows for 2500 ms and rests for 1500 ms with the eyes back', () => {
  const period = PROGRESS_SHOW_MS + PROGRESS_REST_MS
  for (const offset of [0, period, period * 3]) {
    const showing = morphOf(sample('progress', offset + 1200), 'progress')
    assert.equal(showing.weight, 1)
    assert.equal(showing.eyesHidden, true)
    assert.equal(eyeCount(sample('progress', offset + 1200)), 0)
    const resting = morphOf(
      sample('progress', offset + PROGRESS_SHOW_MS + 700),
      'progress',
    )
    assert.equal(resting.weight, 0)
    assert.equal(resting.eyesHidden, false)
    assert.equal(
      eyeCount(sample('progress', offset + PROGRESS_SHOW_MS + 700)),
      2,
    )
  }
  const early = morphOf(sample('progress', 600), 'progress').fill
  const late = morphOf(sample('progress', 2000), 'progress').fill
  assert.ok(early < late)
})

test('alerting repeats a damped shake every 2.2 s', () => {
  const shake = (t: number) =>
    Math.abs(morphOf(sample('alerting', t), 'alerting').shake)
  const peak = (from: number, to: number) => {
    let max = 0
    for (let t = from; t < to; t += 5) max = Math.max(max, shake(t))
    return max
  }
  const cycle = ALERT_CYCLE_MS * 2
  assert.ok(
    peak(cycle, cycle + 440) > peak(cycle + 1540, cycle + ALERT_CYCLE_MS) * 4,
  )
  assert.equal(shake(cycle + 300), shake(cycle + ALERT_CYCLE_MS + 300))
})

test('every morph hides the eyes only once it has entered', () => {
  for (const state of [
    'thinking',
    'searching',
    'progress',
    'writing',
    'alerting',
  ] as const) {
    assert.equal(eyeCount(sample(state, 0)), 2, state)
    assert.equal(sample(state, MORPH_ENTER_MS).morph?.eyesHidden, true, state)
    assert.equal(eyeCount(sample(state, MORPH_ENTER_MS)), 0, state)
  }
})

test('morph to idle restores both eyes and leaves no morph residue', () => {
  for (const state of [
    'thinking',
    'searching',
    'progress',
    'writing',
    'alerting',
  ] as const) {
    const host = virtualClock()
    const scheduler = createMotionScheduler(host.clock)
    const motion = createAvatarMotion({
      scheduler,
      state,
      seed: SEED,
      displaySize: 52,
      onFrame: () => {},
    })
    for (let t = 0; t <= 1000; t += 20) host.frame(t)
    motion.setState('idle')
    assert.ok(motion.frame().morph, state)
    for (let t = 1020; t <= 1000 + TRANSITION_MS; t += 20) host.frame(t)
    const recovered = motion.frame()
    assert.equal(recovered.morph, undefined, state)
    assert.deepEqual(recovered, sample('idle', TRANSITION_MS, 52), state)
    assert.equal(eyeCount(recovered, 52), 2, state)
    assert.equal(
      serialiseSvgNodes(render(recovered, 52)),
      serialiseSvgNodes(render(sample('idle', TRANSITION_MS, 52), 52)),
    )
    motion.destroy()
  }
  const halfway = blendMotionFrames(
    sample('writing', 1000),
    sample('idle', 0),
    0.75,
  )
  assert.equal(halfway.morph, undefined)
  assert.equal(eyeCount(halfway), 2)
})

test('waking settles into the resting pose without leaving the waking state', () => {
  const settled = WAKING_SETTLE_MS + 1000
  assert.deepEqual(sample('waking', settled), sample('idle', settled))
  assert.notDeepEqual(sample('waking', 200), sample('idle', 200))
})

test('non-finite times and seeds fall back instead of producing NaN', () => {
  for (const state of AVATAR_VISUAL_STATES) {
    const frame = sampleMotionFrame({
      state,
      stateTimeMs: Number.NaN,
      seed: Number.POSITIVE_INFINITY,
      displaySize: 32,
    })
    assert.doesNotMatch(
      serialiseSvgNodes(render(frame, 32)),
      /NaN|Infinity|undefined/,
    )
  }
})
