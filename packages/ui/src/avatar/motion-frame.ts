/**
 * Morph part of the avatar frame contract. A morph replaces the resting body
 * with a state-specific figure; every value is sampled from state time, so a
 * frame never depends on how many animation frames preceded it.
 */

export const AVATAR_MORPH_KINDS = [
  'thinking',
  'radar',
  'progress',
  'writing',
  'alerting',
] as const

export type AvatarMorphKind = (typeof AVATAR_MORPH_KINDS)[number]

/** Points are in the 128×128 artwork grid. */
export interface MorphPoint {
  readonly x: number
  readonly y: number
}

interface MorphBase {
  /** Position within the current cycle, 0 to 1. */
  readonly progress: number
  /** How far the body has left its resting form, 0 (resting) to 1 (full morph). */
  readonly weight: number
  readonly eyesHidden: boolean
}

export interface MorphDot {
  readonly lift: number
  readonly scale: number
  readonly opacity: number
}

export interface MorphRing {
  readonly radius: number
  readonly opacity: number
}

export interface ThinkingMorph extends MorphBase {
  readonly kind: 'thinking'
  readonly sideDots: readonly [MorphDot, MorphDot]
}

export interface RadarMorph extends MorphBase {
  readonly kind: 'radar'
  readonly rings: readonly MorphRing[]
}

export interface ProgressMorph extends MorphBase {
  readonly kind: 'progress'
  /** Arc length as a fraction of the full track. */
  readonly fill: number
}

export interface WritingMorph extends MorphBase {
  readonly kind: 'writing'
  readonly pen: MorphPoint & { readonly lift: number }
  /** Bounded trail, oldest first. */
  readonly ink: readonly MorphPoint[]
}

export interface AlertingMorph extends MorphBase {
  readonly kind: 'alerting'
  /** Damped lateral offset, -1 to 1. */
  readonly shake: number
}

export type AvatarMorph =
  | ThinkingMorph
  | RadarMorph
  | ProgressMorph
  | WritingMorph
  | AlertingMorph
