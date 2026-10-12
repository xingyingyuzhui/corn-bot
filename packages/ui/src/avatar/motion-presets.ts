import type { AvatarVisualState } from '@corn-bot/contracts/avatar'
import type { AvatarFrame } from './artwork.ts'
import type {
  AlertingMorph,
  AvatarMorph,
  MorphPoint,
  ProgressMorph,
  RadarMorph,
  ThinkingMorph,
  WritingMorph,
} from './motion-frame.ts'

/**
 * Time-sampled motion for the Corn artwork. Phase structure and cycle lengths
 * follow the Grok Bot 0.68.1 (DMG) engine as documented in the pinned research
 * kit; poses, figures and curves are Corn's own. A frame is a pure function of
 * (state, state time, seed, display size).
 */

/** Below this display size the resting loop is the calm compact variant. */
export const MOTION_COMPACT_BELOW = 48
export const MORPH_ENTER_MS = 320
export const TRANSITION_MS = 240

export const WRITING_CYCLE_MS = 2500
/** Share of the writing cycle with the pen down; the rest lifts and returns. */
export const WRITING_DOWN_SHARE = 0.68
export const INK_SAMPLES = 24
export const RADAR_CYCLE_MS = 1300
export const RADAR_RINGS = 3
export const PROGRESS_SHOW_MS = 2500
export const PROGRESS_REST_MS = 1500
export const ALERT_CYCLE_MS = 2200
export const THINKING_CYCLE_MS = 1400
export const SENDING_CYCLE_MS = 1500
export const RECEIVING_CYCLE_MS = 1700
/** Waking settles into the resting pose; the state itself never changes. */
export const WAKING_SETTLE_MS = 1600
const WAKING_BLEND_MS = 400

/** Large finite times are folded before phase math so it never loses precision. */
const WAVE_PERIOD_MS = 3_600_000

export interface MotionSampleInput {
  readonly state: AvatarVisualState
  readonly stateTimeMs: number
  readonly seed: number
  readonly displaySize: number
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const smooth = (value: number) => {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}
const mix = (from: number, to: number, amount: number) =>
  from + (to - from) * amount
const cycle = (timeMs: number, periodMs: number) =>
  (((timeMs % periodMs) + periodMs) % periodMs) / periodMs

const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback

/** Fraction of the morph shown at `timeMs` after entering a morph state. */
const enterWeight = (timeMs: number) => smooth(timeMs / MORPH_ENTER_MS)

const eyesHiddenAt = (weight: number) => weight > 0.5

/** Pen path for one stroke, `u` from 0 (start) to 1 (end). Corn's own curve. */
function inkPoint(u: number): MorphPoint {
  const x = mix(40, 88, smooth(u))
  return { x, y: 108 + 3.5 * Math.sin(u * Math.PI * 4) }
}

const INK_PATH: readonly MorphPoint[] = Array.from(
  { length: INK_SAMPLES },
  (_, index) => inkPoint(index / (INK_SAMPLES - 1)),
)

function writingMorph(timeMs: number): WritingMorph {
  const progress = cycle(timeMs, WRITING_CYCLE_MS)
  const weight = enterWeight(timeMs)
  const base = { kind: 'writing' as const, progress, weight }
  if (progress < WRITING_DOWN_SHARE) {
    const u = progress / WRITING_DOWN_SHARE
    const pen = inkPoint(u)
    const drawn = INK_PATH.filter((_, index) => index / (INK_SAMPLES - 1) <= u)
    return {
      ...base,
      eyesHidden: eyesHiddenAt(weight),
      pen: { ...pen, lift: 0 },
      ink: [...drawn, pen],
    }
  }
  const v = (progress - WRITING_DOWN_SHARE) / (1 - WRITING_DOWN_SHARE)
  const from = inkPoint(1)
  const to = inkPoint(0)
  return {
    ...base,
    eyesHidden: eyesHiddenAt(weight),
    pen: {
      x: mix(from.x, to.x, smooth(v)),
      y: mix(from.y, to.y, smooth(v)),
      lift: Math.sin(Math.PI * v),
    },
    // The trail is erased from its start as the pen returns.
    ink: INK_PATH.filter((_, index) => index / (INK_SAMPLES - 1) >= v),
  }
}

function radarMorph(timeMs: number): RadarMorph {
  const progress = cycle(timeMs, RADAR_CYCLE_MS)
  const weight = enterWeight(timeMs)
  return {
    kind: 'radar',
    progress,
    weight,
    eyesHidden: eyesHiddenAt(weight),
    rings: Array.from({ length: RADAR_RINGS }, (_, index) => {
      const spread = (progress + index / RADAR_RINGS) % 1
      return { radius: mix(16, 60, spread), opacity: (1 - spread) ** 1.5 }
    }),
  }
}

function progressMorph(timeMs: number): ProgressMorph {
  const period = PROGRESS_SHOW_MS + PROGRESS_REST_MS
  const local = cycle(timeMs, period) * period
  const progress = local / period
  if (local >= PROGRESS_SHOW_MS)
    return { kind: 'progress', progress, weight: 0, eyesHidden: false, fill: 0 }
  const weight = Math.min(
    smooth(local / MORPH_ENTER_MS),
    smooth((PROGRESS_SHOW_MS - local) / MORPH_ENTER_MS),
  )
  return {
    kind: 'progress',
    progress,
    weight,
    eyesHidden: eyesHiddenAt(weight),
    fill: smooth(local / (PROGRESS_SHOW_MS - MORPH_ENTER_MS)),
  }
}

function alertingMorph(timeMs: number): AlertingMorph {
  const progress = cycle(timeMs, ALERT_CYCLE_MS)
  const weight = enterWeight(timeMs)
  return {
    kind: 'alerting',
    progress,
    weight,
    eyesHidden: eyesHiddenAt(weight),
    shake: Math.exp(-4 * progress) * Math.sin(progress * Math.PI * 2 * 5),
  }
}

function thinkingMorph(timeMs: number): ThinkingMorph {
  const progress = cycle(timeMs, THINKING_CYCLE_MS)
  const weight = enterWeight(timeMs)
  const dot = (offset: number) => {
    const local = cycle(progress + offset, 1)
    const lift = local < 0.5 ? Math.sin(local * 2 * Math.PI) : 0
    return { lift, scale: 1 + 0.3 * lift, opacity: 0.5 + 0.5 * lift }
  }
  return {
    kind: 'thinking',
    progress,
    weight,
    eyesHidden: eyesHiddenAt(weight),
    sideDots: [dot(0), dot(0.5)],
  }
}

/** Resting poses are Corn-original (corn-avatar-kit-v1), sampled in seconds. */
function restingPose(
  state: AvatarVisualState,
  timeMs: number,
  seed: number,
  compact: boolean,
): AvatarFrame {
  const t =
    (((timeMs % WAVE_PERIOD_MS) + WAVE_PERIOD_MS) % WAVE_PERIOD_MS) / 1000
  const seedPhase = ((((seed % 101) + 101) % 101) / 101) * Math.PI * 2
  const wave = (rate: number) => Math.sin(t * rate + seedPhase)
  const phase = (((t * 0.31 + seedPhase / (Math.PI * 2)) % 1) + 1) % 1
  const blinkPosition = (t + seedPhase) % 5.9
  const blink =
    blinkPosition < 0.13 ? 0.12 + 0.88 * Math.abs(blinkPosition / 0.065 - 1) : 1
  const base: AvatarFrame = {
    tilt: 0,
    shiftX: 0,
    shiftY: 0,
    scale: 1,
    eyeOpen: blink,
    gazeX: 0,
    gazeY: 0,
    expression: 'neutral',
    phase,
    decoration: 'none',
  }
  const timedPhase = (periodMs: number) => cycle(timeMs, periodMs) * Math.PI * 2
  switch (state) {
    case 'idle':
      return compact
        ? { ...base, shiftY: wave(1.2) * 0.5 }
        : { ...base, shiftY: wave(1.2) * 0.7, tilt: wave(0.63) * 1.4 }
    case 'sleeping':
      return {
        ...base,
        eyeOpen: 0.09,
        expression: 'sleepy',
        shiftY: wave(0.95) * 1.2,
        tilt: -4,
        decoration: 'standby',
      }
    case 'waking': {
      const settle = smooth((timeMs - WAKING_SETTLE_MS) / WAKING_BLEND_MS)
      const waking: AvatarFrame = {
        ...base,
        eyeOpen: 0.65 + wave(1.4) * 0.25,
        shiftY: -1.5,
        tilt: wave(1.8) * 2.3,
        scale: 1.025,
        decoration: 'wave',
      }
      return settle === 0
        ? waking
        : blendMotionFrames(
            waking,
            restingPose('idle', timeMs, seed, compact),
            settle,
          )
    }
    case 'listening':
      return {
        ...base,
        tilt: 5 + wave(1.3),
        gazeX: 1.8,
        shiftY: wave(1.7) * 0.5,
        decoration: 'wave',
      }
    case 'thinking':
      return { ...base, tilt: -5 + wave(0.9), gazeX: -1.8, gazeY: -2.3 }
    case 'searching':
      return { ...base, tilt: wave(1.9) * 3, gazeX: wave(1.9) * 4, gazeY: -0.8 }
    case 'working':
      return {
        ...base,
        tilt: wave(4.1) * 1.5,
        shiftY: -Math.abs(wave(4.1)) * 1.7,
        decoration: 'progress',
      }
    case 'dictating':
      return {
        ...base,
        scale: 1 + wave(3.3) * 0.015,
        eyeOpen: 0.85,
        gazeY: -0.7,
        decoration: 'wave',
      }
    case 'writing':
      return { ...base, gazeY: 2.5, tilt: 3 }
    case 'sending': {
      const travel = Math.sin(timedPhase(SENDING_CYCLE_MS))
      return {
        ...base,
        shiftX: travel * 2.8,
        tilt: 4,
        gazeX: 2.5,
        phase: timedPhase(SENDING_CYCLE_MS),
        decoration: 'send',
      }
    }
    case 'receiving': {
      const travel = Math.sin(timedPhase(RECEIVING_CYCLE_MS))
      return {
        ...base,
        shiftX: -travel * 2.3,
        tilt: -3,
        gazeX: -2.5,
        phase: timedPhase(RECEIVING_CYCLE_MS),
        decoration: 'receive',
      }
    }
    case 'uploading':
      return {
        ...base,
        shiftY: -Math.abs(wave(2.1)) * 2.8,
        gazeY: -2,
        decoration: 'upload',
      }
    case 'alerting':
      return { ...base, eyeOpen: 1, scale: 1.02 }
    case 'happy':
      return {
        ...base,
        expression: 'happy',
        eyeOpen: 0.75,
        tilt: wave(2.2) * 2.8,
        shiftY: -1,
        decoration: 'sparkles',
      }
    case 'celebrate':
      return {
        ...base,
        expression: 'happy',
        tilt: wave(5.2) * 8,
        shiftY: -Math.abs(wave(3.4)) * 5.5,
        scale: 1.035,
        decoration: 'sparkles',
      }
    case 'confused':
      return {
        ...base,
        expression: 'confused',
        tilt: wave(1.6) * 7,
        gazeX: -1.5,
        eyeOpen: 0.8,
        decoration: 'alert',
      }
    case 'progress':
      return { ...base, tilt: wave(1.1) * 0.6, gazeY: 1, scale: 0.99 }
    case 'powering-down':
      return {
        ...base,
        expression: 'sleepy',
        eyeOpen: 0.23,
        shiftY: 3.3,
        scale: 0.965,
        tilt: 4,
        decoration: 'standby',
      }
    default: {
      const unknown: never = state
      throw new RangeError(`Unknown Corn avatar state: ${String(unknown)}`)
    }
  }
}

function morphFor(
  state: AvatarVisualState,
  timeMs: number,
): AvatarMorph | undefined {
  switch (state) {
    case 'thinking':
      return thinkingMorph(timeMs)
    case 'searching':
      return radarMorph(timeMs)
    case 'progress':
      return progressMorph(timeMs)
    case 'writing':
      return writingMorph(timeMs)
    case 'alerting':
      return alertingMorph(timeMs)
    case 'idle':
    case 'sleeping':
    case 'waking':
    case 'listening':
    case 'working':
    case 'dictating':
    case 'sending':
    case 'receiving':
    case 'uploading':
    case 'happy':
    case 'celebrate':
    case 'confused':
    case 'powering-down':
      return undefined
    default: {
      const unknown: never = state
      throw new RangeError(`Unknown Corn avatar state: ${String(unknown)}`)
    }
  }
}

export const isCompactMotion = (displaySize: number) =>
  displaySize < MOTION_COMPACT_BELOW

/** The frame for `state` at `stateTimeMs` after it was entered. */
export function sampleMotionFrame({
  state,
  stateTimeMs,
  seed,
  displaySize,
}: MotionSampleInput): AvatarFrame {
  const time = Math.max(0, finiteOr(stateTimeMs, 0))
  const pose = restingPose(
    state,
    time,
    finiteOr(seed, 0),
    isCompactMotion(displaySize),
  )
  const morph = morphFor(state, time)
  if (!morph) return pose
  const shake = morph.kind === 'alerting' ? morph.shake * 2.5 : 0
  return {
    ...pose,
    shiftX: (pose.shiftX ?? 0) + shake,
    decoration: 'none',
    morph,
  }
}

const NUMERIC_FIELDS = [
  'tilt',
  'shiftX',
  'shiftY',
  'scale',
  'eyeOpen',
  'gazeX',
  'gazeY',
  'phase',
] as const
const RESTING: Readonly<Record<(typeof NUMERIC_FIELDS)[number], number>> = {
  tilt: 0,
  shiftX: 0,
  shiftY: 0,
  scale: 1,
  eyeOpen: 1,
  gazeX: 0,
  gazeY: 0,
  phase: 0,
}

function blendMorph(
  from: AvatarMorph | undefined,
  to: AvatarMorph | undefined,
  amount: number,
): AvatarMorph | undefined {
  // Fade the outgoing figure out before the incoming one grows in, so two
  // morphs never share the body and recovery to rest always ends morph-free.
  if (from && to && from.kind === to.kind)
    return {
      ...to,
      weight: mix(from.weight, to.weight, amount),
      eyesHidden: eyesHiddenAt(mix(from.weight, to.weight, amount)),
    }
  if (from && amount < 0.5) {
    const weight = from.weight * (1 - amount * 2)
    return { ...from, weight, eyesHidden: eyesHiddenAt(weight) }
  }
  if (to && (amount >= 0.5 || !from)) {
    const weight = to.weight * (from ? amount * 2 - 1 : amount)
    return { ...to, weight, eyesHidden: eyesHiddenAt(weight) }
  }
  return undefined
}

/** Frame `amount` (0–1) of the way from `from` to `to`. */
export function blendMotionFrames(
  from: AvatarFrame,
  to: AvatarFrame,
  amount: number,
): AvatarFrame {
  const a = clamp01(amount)
  if (a === 1) return to
  const numeric: Record<string, number> = {}
  for (const key of NUMERIC_FIELDS)
    numeric[key] = mix(from[key] ?? RESTING[key], to[key] ?? RESTING[key], a)
  const { morph: _drop, ...discrete } = a < 0.5 ? from : to
  const morph = blendMorph(from.morph, to.morph, a)
  return morph
    ? { ...discrete, ...numeric, morph }
    : { ...discrete, ...numeric }
}

export const transitionAmount = (elapsedMs: number) =>
  smooth(elapsedMs / TRANSITION_MS)
