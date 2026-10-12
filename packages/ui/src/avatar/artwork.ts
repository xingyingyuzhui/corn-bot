import type { CornAvatarShape } from '@corn-bot/contracts/avatar'
import type { AvatarMorph } from './motion-frame.ts'
import type { CornAvatarVariant } from './variants.ts'

/**
 * Corn-original flat corn artwork on a 128×128 grid, adapted from
 * corn-avatar-kit-v1 `src/artwork.ts` (see design/corn-assets/PROVENANCE.md).
 * It returns a plain element tree instead of markup so React can render it
 * without `dangerouslySetInnerHTML` and tests can serialise it without a DOM.
 */

export type SvgTag = 'g' | 'path' | 'rect' | 'circle' | 'defs' | 'clipPath'

export type SvgAttribute =
  | 'id'
  | 'd'
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'rx'
  | 'cx'
  | 'cy'
  | 'r'
  | 'fill'
  | 'opacity'
  | 'transform'
  | 'clip-path'
  | 'stroke'
  | 'stroke-opacity'
  | 'stroke-width'
  | 'stroke-linecap'
  | 'stroke-linejoin'

/** Attribute order is significant: serialisation keeps insertion order. */
export type SvgAttributes = Readonly<Partial<Record<SvgAttribute, string>>>

export interface SvgNode {
  readonly tag: SvgTag
  readonly attrs: SvgAttributes
  readonly children?: readonly SvgNode[]
}

export const AVATAR_VIEWBOX = '0 0 128 128'

export type AvatarExpression = 'neutral' | 'happy' | 'sleepy' | 'confused'

export type AvatarDecoration =
  | 'none'
  | 'dots'
  | 'wave'
  | 'pencil'
  | 'upload'
  | 'send'
  | 'receive'
  | 'alert'
  | 'progress'
  | 'sparkles'
  | 'standby'

export interface AvatarFrame {
  readonly tilt?: number
  readonly shiftX?: number
  readonly shiftY?: number
  readonly scale?: number
  readonly eyeOpen?: number
  readonly gazeX?: number
  readonly gazeY?: number
  readonly expression?: AvatarExpression
  readonly phase?: number
  readonly decoration?: AvatarDecoration
  /** Motion frames only; still frames never carry a morph. */
  readonly morph?: AvatarMorph
}

/**
 * `compact` is for 24 px and below: the seam lines vanish at that size, so
 * they and the clip path (the only SVG id) are dropped. Eyes keep their `/` tilt.
 */
export type AvatarDetail = 'full' | 'compact'

export const COMPACT_AVATAR_MAX_SIZE = 24

export const avatarDetailFor = (size: number): AvatarDetail =>
  size <= COMPACT_AVATAR_MAX_SIZE ? 'compact' : 'full'

export interface ArtworkOptions {
  readonly variant: CornAvatarVariant
  /** Unique per rendered instance; prefixes every SVG id. */
  readonly idPrefix: string
  readonly shape?: CornAvatarShape
  readonly detail?: AvatarDetail
  readonly frame?: AvatarFrame
}

/** Upper end tilts right, lower end left: the `/` capsule eye. */
export const EYE_TILT_DEGREES = 35

const ID_PREFIX = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/

interface Geometry {
  readonly body: string
  readonly left: string
  readonly right: string
  readonly extra?: string
  readonly eyes: readonly [number, number, number, number]
  readonly seams: boolean
}

const n = (value: number) => String(Math.round(value * 1000) / 1000)

function geometry(shape: CornAvatarShape, leafFlex: number): Geometry {
  const leftTip = n(58 + leafFlex)
  const rightTip = n(73 - leafFlex)
  const common = {
    left: `M64 119 C33 124 6 111 9 84 C10 74 13 ${leftTip} 19 56 C35 63 56 94 64 119 Z`,
    right: `M64 119 C80 98 103 84 118 ${rightTip} C130 106 112 124 64 119 Z`,
    eyes: [51, 59, 78, 63] as const,
    seams: true,
  }
  switch (shape) {
    case 'cob':
      return {
        ...common,
        body: 'M28 76 C24 53 54 18 78 14 C105 8 116 34 110 64 C108 91 83 112 58 117 C44 110 31 95 28 76 Z',
      }
    case 'baby-cob':
      return {
        ...common,
        body: 'M34 79 C29 59 45 34 65 26 C87 15 105 28 107 50 C110 77 87 103 61 116 C46 107 36 94 34 79 Z',
        eyes: [53, 66, 77, 69],
      }
    case 'round-cob':
      return {
        ...common,
        body: 'M22 65 C22 36 47 18 78 20 C105 22 117 46 111 76 C104 103 79 118 53 114 C32 108 20 87 22 65 Z',
        eyes: [49, 60, 77, 62],
      }
    case 'tall-cob':
      return {
        ...common,
        body: 'M39 77 C35 48 54 13 75 10 C95 9 105 28 100 55 C97 81 81 107 59 119 C47 107 41 92 39 77 Z',
        eyes: [56, 55, 79, 58],
      }
    case 'kernel':
      return {
        ...common,
        body: 'M27 73 C17 52 28 27 46 24 C61 22 73 29 83 24 C101 15 116 32 115 54 C114 85 93 111 63 119 C45 109 34 94 27 73 Z',
        eyes: [49, 60, 77, 62],
        seams: false,
      }
    case 'twin-kernel':
      return {
        ...common,
        body: 'M21 66 C12 38 31 20 50 27 C63 31 64 36 69 30 C90 9 115 28 114 56 C114 90 90 113 62 119 C42 110 24 91 21 66 Z',
        eyes: [48, 60, 80, 58],
        seams: false,
      }
    case 'husk-bud':
      return {
        ...common,
        body: 'M35 76 C26 49 49 29 69 12 C91 25 108 45 103 71 C98 96 80 111 62 119 C48 108 39 93 35 76 Z',
        left: `M63 120 C31 114 18 90 17 ${n(41 + leafFlex)} C35 47 51 70 63 120 Z`,
        right: `M63 120 C68 78 89 53 113 ${n(41 - leafFlex)} C121 84 104 115 63 120 Z`,
        eyes: [51, 61, 77, 62],
      }
    case 'husk-fan':
      return {
        ...common,
        body: 'M32 78 C24 55 48 23 74 18 C99 13 112 35 109 60 C108 89 83 110 62 120 C47 109 36 96 32 78 Z',
        left: `M62 119 C32 124 4 104 7 ${n(48 + leafFlex)} C28 55 48 89 62 119 Z`,
        right: `M62 119 C80 89 100 56 121 ${n(50 - leafFlex)} C127 103 100 124 62 119 Z`,
        extra: 'M58 118 C39 102 23 80 23 68 C37 73 55 96 58 118 Z',
        eyes: [51, 60, 78, 62],
      }
    case 'popcorn':
      return {
        ...common,
        body: 'M30 83 C14 79 12 56 25 47 C14 27 37 12 54 22 C65 2 91 10 91 28 C113 23 126 44 112 60 C127 78 111 98 94 96 C82 113 55 120 42 104 C29 106 21 93 30 83 Z',
        left: `M61 120 C34 117 20 104 19 ${n(84 + leafFlex)} C35 85 53 105 61 120 Z`,
        right: `M61 120 C77 102 99 87 115 ${n(82 - leafFlex)} C111 109 91 122 61 120 Z`,
        eyes: [48, 61, 78, 59],
        seams: false,
      }
    default: {
      const unknown: never = shape
      throw new RangeError(`Unknown Corn avatar shape: ${String(unknown)}`)
    }
  }
}

function clamp(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

const el = (
  tag: SvgTag,
  attrs: SvgAttributes,
  children?: readonly SvgNode[],
): SvgNode => (children ? { tag, attrs, children } : { tag, attrs })

function eye(
  x: number,
  y: number,
  openness: number,
  expression: AvatarFrame['expression'],
  index: number,
  color: string,
): SvgNode {
  const angle = expression === 'confused' && index === 1 ? 8 : EYE_TILT_DEGREES
  const open = expression === 'sleepy' ? Math.min(0.28, openness) : openness
  const height = 2.4 + open * 19.6
  const transform = `rotate(${angle} ${n(x)} ${n(y)})`
  if (expression === 'happy' && open > 0.6)
    return el('path', {
      d: `M${n(x - 5)} ${n(y + 2)} Q${n(x)} ${n(y - 7)} ${n(x + 5)} ${n(y + 2)}`,
      fill: 'none',
      stroke: color,
      'stroke-width': '5.5',
      'stroke-linecap': 'round',
      transform,
    })
  return el('rect', {
    x: n(x - 5.5),
    y: n(y - height / 2),
    width: '11',
    height: n(height),
    rx: n(Math.min(5.5, height / 2)),
    fill: color,
    transform,
  })
}

const ink = (color: string): SvgAttributes => ({
  fill: 'none',
  stroke: color,
  'stroke-width': '3',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
})

function decoration(
  type: AvatarFrame['decoration'],
  phase: number,
  color: string,
): readonly SvgNode[] {
  const sin = Math.sin(phase)
  switch (type) {
    case undefined:
    case 'none':
      return []
    case 'dots':
      return [
        el(
          'g',
          { fill: color },
          [0, 1, 2].map((i) =>
            el('circle', {
              cx: String(51 + i * 13),
              cy: n(111 - 3 * Math.sin(phase + i * 1.9)),
              r: '3',
            }),
          ),
        ),
      ]
    case 'wave':
      return [
        el(
          'g',
          ink(color),
          [0, 1, 2, 3, 4].map((i) => {
            const h = 4 + 4 * (0.5 + 0.5 * Math.sin(phase + i * 1.6))
            return el('path', {
              d: `M${48 + i * 8} ${n(112 - h)} V${n(112 + h)}`,
            })
          }),
        ),
      ]
    case 'pencil':
      return [
        el('g', { transform: `translate(${n(sin * 2)} 0)`, ...ink(color) }, [
          el('path', {
            d: 'M94 98 L113 79 L118 84 L99 103 L92 105 Z M110 82 L115 87',
          }),
        ]),
      ]
    case 'upload': {
      const top = n(89 - 2 * sin)
      const arm = n(96 - 2 * sin)
      return [
        el('g', ink(color), [
          el('path', {
            d: `M100 106 V${top} M93 ${arm} L100 ${top} L107 ${arm} M89 109 V114 H111 V109`,
          }),
        ]),
      ]
    }
    case 'send':
      return [
        el('g', { transform: `translate(${n(2 * sin)} 0)`, ...ink(color) }, [
          el('path', {
            d: 'M94 91 L118 83 L108 107 L105 97 Z M105 97 L118 83',
          }),
        ]),
      ]
    case 'receive': {
      const tip = n(96 + 2 * sin)
      const arm = n(91 + 2 * sin)
      return [
        el('g', ink(color), [
          el('path', {
            d: `M90 106 L96 97 H112 L118 106 V114 H90 Z M91 106 H99 L102 110 H108 L111 106 H117 M104 83 V${tip} M99 ${arm} L104 ${tip} L109 ${arm}`,
          }),
        ]),
      ]
    }
    case 'alert':
      return [
        el('circle', { cx: '107', cy: '99', r: '12', fill: '#FFD3A5' }),
        el('path', { d: 'M107 91 V100', ...ink(color) }),
        el('circle', { cx: '107', cy: '106', r: '1.8', fill: color }),
      ]
    case 'progress':
      return [
        el('circle', {
          cx: '105',
          cy: '102',
          r: '10',
          fill: 'none',
          stroke: color,
          'stroke-opacity': '.15',
          'stroke-width': '3',
        }),
        el('path', {
          d: 'M105 92 A10 10 0 0 1 115 102',
          ...ink(color),
          transform: `rotate(${n((phase * 57.2958) % 360)} 105 102)`,
        }),
      ]
    case 'sparkles':
      return [
        el('g', { fill: color, opacity: n(0.7 + sin * 0.25) }, [
          el('path', {
            d: 'M16 22 L19 30 L27 33 L19 36 L16 44 L13 36 L5 33 L13 30 Z M112 9 L114 15 L120 17 L114 19 L112 25 L110 19 L104 17 L110 15 Z',
          }),
        ]),
      ]
    case 'standby':
      return [
        el('g', { ...ink(color), opacity: '.6' }, [
          el('path', {
            d: 'M102 23 H110 L102 33 H110 M113 11 H119 L113 18 H119',
          }),
        ]),
      ]
    default: {
      const unknown: never = type
      throw new RangeError(`Unknown avatar decoration: ${String(unknown)}`)
    }
  }
}

/** Resting body shrinks towards the figure centre as a morph takes over. */
const MORPH_CORE_SHRINK = 0.42
const CENTRE_X = 64
const CENTRE_Y = 70
const PENCIL_TIP_X = 92
const PENCIL_TIP_Y = 105

const unit = (value: number) => clamp(value, 0, 0, 1)

function morphNodes(
  morph: AvatarMorph,
  color: string,
  detail: AvatarDetail,
): readonly SvgNode[] {
  const weight = unit(morph.weight)
  if (weight === 0) return []
  const width = detail === 'compact' ? '5' : '3'
  const line = { ...ink(color), 'stroke-width': width }
  switch (morph.kind) {
    case 'thinking':
      return [
        el(
          'g',
          { fill: color },
          morph.sideDots.map((dot, index) =>
            el('circle', {
              cx: n(CENTRE_X + (index === 0 ? -30 : 30)),
              cy: n(CENTRE_Y - clamp(dot.lift, 0, 0, 1) * 8),
              r: n(5 * clamp(dot.scale, 1, 0.5, 1.5)),
              opacity: n(unit(dot.opacity) * weight),
            }),
          ),
        ),
      ]
    case 'radar':
      return morph.rings.map((ring) =>
        el('circle', {
          cx: n(CENTRE_X),
          cy: n(CENTRE_Y),
          r: n(clamp(ring.radius, 0, 0, 64)),
          fill: 'none',
          stroke: color,
          'stroke-opacity': n(unit(ring.opacity) * weight),
          'stroke-width': width,
        }),
      )
    case 'progress': {
      const fill = unit(morph.fill)
      const radius = 44
      const angle = fill * Math.PI * 2
      const track = el('circle', {
        cx: n(CENTRE_X),
        cy: n(CENTRE_Y),
        r: String(radius),
        fill: 'none',
        stroke: color,
        'stroke-opacity': n(0.15 * weight),
        'stroke-width': width,
      })
      if (fill === 0) return [track]
      const arc =
        fill === 1
          ? el('circle', {
              cx: n(CENTRE_X),
              cy: n(CENTRE_Y),
              r: String(radius),
              ...line,
              opacity: n(weight),
            })
          : el('path', {
              d: `M${n(CENTRE_X)} ${n(CENTRE_Y - radius)} A${radius} ${radius} 0 ${fill > 0.5 ? 1 : 0} 1 ${n(CENTRE_X + radius * Math.sin(angle))} ${n(CENTRE_Y - radius * Math.cos(angle))}`,
              ...line,
              opacity: n(weight),
            })
      return [track, arc]
    }
    case 'writing': {
      const points = morph.ink.filter(
        (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
      )
      const penX = clamp(morph.pen.x, CENTRE_X, -64, 192)
      const penY =
        clamp(morph.pen.y, CENTRE_Y, -64, 192) -
        clamp(morph.pen.lift, 0, 0, 1) * 8
      return [
        ...(points.length > 1
          ? [
              el('path', {
                d: points
                  .map(
                    (point, index) =>
                      `${index === 0 ? 'M' : 'L'}${n(point.x)} ${n(point.y)}`,
                  )
                  .join(' '),
                ...line,
                opacity: n(weight),
              }),
            ]
          : []),
        el(
          'g',
          {
            transform: `translate(${n(penX - PENCIL_TIP_X)} ${n(penY - PENCIL_TIP_Y)})`,
            opacity: n(weight),
          },
          decoration('pencil', 0, color),
        ),
      ]
    }
    case 'alerting':
      return [
        el(
          'g',
          {
            transform: `translate(${n(clamp(morph.shake, 0, -1, 1) * 4)} 0)`,
            opacity: n(weight),
          },
          decoration('alert', 0, color),
        ),
      ]
    default: {
      const unknown: never = morph
      throw new RangeError(
        `Unknown avatar morph: ${String((unknown as AvatarMorph).kind)}`,
      )
    }
  }
}

const SEAMS =
  'M21 48 Q65 33 112 62 M19 79 Q67 62 111 94 M49 114 Q46 57 79 10 M79 119 Q89 70 102 23'

/** Children of a `viewBox="0 0 128 128"` root. */
export function cornAvatarArtwork(options: ArtworkOptions): readonly SvgNode[] {
  const { variant, idPrefix } = options
  if (!ID_PREFIX.test(idPrefix))
    throw new TypeError(
      'idPrefix must start with a letter and contain at most 80 letters, digits, underscores or hyphens',
    )
  const shape = options.shape ?? variant.shape
  const detail = options.detail ?? 'full'
  const frame = options.frame ?? {}
  const phase = clamp(frame.phase, 0, -1e6, 1e6)
  const leafFlex = frame.phase === undefined ? 0 : Math.sin(phase) * 2.2
  const geo = geometry(shape, leafFlex)
  const tilt = clamp(frame.tilt, 0, -720, 720) % 360
  const dx = clamp(frame.shiftX, 0, -8, 8)
  const dy = clamp(frame.shiftY, 0, -8, 8)
  const morph = frame.morph
  const morphWeight = morph ? unit(morph.weight) : 0
  const scale =
    clamp(frame.scale, 1, 0.8, 1.12) * (1 - MORPH_CORE_SHRINK * morphWeight)
  const openness =
    clamp(frame.eyeOpen, 1, 0, 1) * Math.max(0, 1 - 2 * morphWeight)
  const gazeX = clamp(frame.gazeX, 0, -3, 3)
  const gazeY = clamp(frame.gazeY, 0, -3, 3)
  const [leftX, leftY, rightX, rightY] = geo.eyes
  const clip = `${idPrefix}-body`
  const seams = geo.seams && detail === 'full'
  const breathe = frame.phase === undefined ? 1 : 1 + Math.sin(phase) * 0.008

  const bodyGroup = el(
    'g',
    { transform: `translate(0 119) scale(1 ${n(breathe)}) translate(0 -119)` },
    [
      el('path', { d: geo.body, fill: variant.body }),
      ...(seams
        ? [
            el(
              'g',
              {
                'clip-path': `url(#${clip})`,
                fill: 'none',
                stroke: variant.eye,
                'stroke-opacity': '.065',
                'stroke-width': '3.8',
                'stroke-linecap': 'round',
              },
              [el('path', { d: SEAMS })],
            ),
          ]
        : []),
    ],
  )
  const figure = el(
    'g',
    {
      transform: `translate(${n(dx)} ${n(dy)}) rotate(${n(tilt)} 64 70) translate(64 70) scale(${n(scale)}) translate(-64 -70)`,
    },
    [
      bodyGroup,
      el('path', { d: geo.left, fill: variant.husk }),
      el('path', { d: geo.right, fill: variant.husk }),
      ...(geo.extra ? [el('path', { d: geo.extra, fill: variant.husk })] : []),
      ...(morph?.eyesHidden
        ? []
        : [
            el('g', { transform: `translate(${n(gazeX)} ${n(gazeY)})` }, [
              eye(leftX, leftY, openness, frame.expression, 0, variant.eye),
              eye(rightX, rightY, openness, frame.expression, 1, variant.eye),
            ]),
          ]),
    ],
  )
  return [
    ...(detail === 'full'
      ? [
          el('defs', {}, [
            el('clipPath', { id: clip }, [el('path', { d: geo.body })]),
          ]),
        ]
      : []),
    figure,
    ...decoration(frame.decoration, phase, variant.eye),
    ...(morph ? morphNodes(morph, variant.eye, detail) : []),
  ]
}

/** Markup form of an element tree, for tests and offline asset checks. */
export function serialiseSvgNodes(nodes: readonly SvgNode[]): string {
  return nodes
    .map((node) => {
      const attrs = Object.entries(node.attrs)
        .map(([name, value]) => ` ${name}="${value}"`)
        .join('')
      return `<${node.tag}${attrs}${
        node.children
          ? `>${serialiseSvgNodes(node.children)}</${node.tag}>`
          : '/>'
      }`
    })
    .join('')
}
