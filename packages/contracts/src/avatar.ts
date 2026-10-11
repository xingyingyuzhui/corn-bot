/**
 * Corn-owned avatar vocabulary (plan §13.3, §15). Views, state projection and
 * event adapters share these names; nothing here depends on React or DSH.
 */

/** Display states of the Corn-original artwork, not application activity. */
export const AVATAR_VISUAL_STATES = [
  'idle',
  'sleeping',
  'waking',
  'listening',
  'thinking',
  'searching',
  'working',
  'dictating',
  'writing',
  'sending',
  'receiving',
  'uploading',
  'alerting',
  'happy',
  'celebrate',
  'confused',
  'progress',
  'powering-down',
] as const

export type AvatarVisualState = (typeof AVATAR_VISUAL_STATES)[number]

export const CORN_AVATAR_SHAPES = [
  'cob',
  'baby-cob',
  'round-cob',
  'tall-cob',
  'kernel',
  'twin-kernel',
  'husk-bud',
  'husk-fan',
  'popcorn',
] as const

export type CornAvatarShape = (typeof CORN_AVATAR_SHAPES)[number]

/** Locked catalog order; default selection depends on it, so only append. */
export const CORN_AVATAR_VARIANT_IDS = [
  'xiaohuang',
  'ops',
  'backend',
  'frontend',
  'architect',
  'news',
  'excel',
  'cad',
  'word',
  'pdf',
  'ppt',
  'wechat',
  'video',
  'audio',
  'sales',
  'research',
] as const

export type CornAvatarVariantId = (typeof CORN_AVATAR_VARIANT_IDS)[number]

/** 小黄 is the coordinator's look; new Bots never receive it by default. */
export const RESERVED_AVATAR_VARIANT_ID =
  'xiaohuang' satisfies CornAvatarVariantId

export const DEFAULT_AVATAR_VARIANT_IDS: readonly CornAvatarVariantId[] =
  CORN_AVATAR_VARIANT_IDS.filter((id) => id !== RESERVED_AVATAR_VARIANT_ID)

const includes = <T extends string>(list: readonly T[], value: unknown) =>
  typeof value === 'string' && (list as readonly string[]).includes(value)

export const isCornAvatarVariantId = (
  value: unknown,
): value is CornAvatarVariantId => includes(CORN_AVATAR_VARIANT_IDS, value)

export const isCornAvatarShape = (value: unknown): value is CornAvatarShape =>
  includes(CORN_AVATAR_SHAPES, value)

export const isAvatarVisualState = (
  value: unknown,
): value is AvatarVisualState => includes(AVATAR_VISUAL_STATES, value)

/** 32-bit FNV-1a over UTF-16 code units: stable across runtimes and renames. */
export function stableAvatarHash(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/**
 * Default look for a new Bot, keyed by its immutable id rather than its
 * editable name. Callers persist the result; it is never recomputed later.
 */
export function defaultAvatarVariantFor(botId: string): CornAvatarVariantId {
  const choices = DEFAULT_AVATAR_VARIANT_IDS
  const pick = choices[stableAvatarHash(botId) % choices.length]
  if (pick === undefined) throw new Error('Corn avatar catalog is empty')
  return pick
}

/** What a user chose; persisted. Runtime state is never stored here. */
export interface AvatarPreference {
  readonly kind: 'uploaded' | 'generated' | 'default'
  /** Validated against the Corn catalog; unknown or missing falls back to the initial placeholder. */
  readonly variantId?: string
  /** Only images the user has the right to use (M2). */
  readonly assetId?: string
  readonly color?: string
  readonly motion?: {
    readonly shape: CornAvatarShape
    readonly seed: number
    readonly enabled: boolean
  }
}

export interface AvatarRuntimeSignals {
  readonly botId: string
  readonly activeRunCount: number
  readonly phase:
    | 'idle'
    | 'thinking'
    | 'searching'
    | 'tool'
    | 'sending'
    | 'waiting_approval'
    | 'waiting_resource'
    | 'failed'
    | 'completed'
  readonly voice: 'none' | 'listening' | 'dictating'
  readonly message: 'none' | 'inbound' | 'outbound'
  readonly updatedAt: number
}

export interface AvatarPresentation {
  readonly visual: AvatarVisualState
  readonly animated: boolean
  readonly tone: 'neutral' | 'attention' | 'error' | 'success'
  readonly transientUntil?: number
}
