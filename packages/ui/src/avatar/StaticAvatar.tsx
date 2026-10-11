import { createElement, type ReactNode, useId, useMemo } from 'react'
import {
  AVATAR_VIEWBOX,
  avatarDetailFor,
  cornAvatarArtwork,
  type SvgAttribute,
  type SvgNode,
} from './artwork.ts'
import type { CornAvatarVariant } from './variants.ts'

const REACT_PROP: Readonly<Record<SvgAttribute, string>> = {
  id: 'id',
  d: 'd',
  x: 'x',
  y: 'y',
  width: 'width',
  height: 'height',
  rx: 'rx',
  cx: 'cx',
  cy: 'cy',
  r: 'r',
  fill: 'fill',
  opacity: 'opacity',
  transform: 'transform',
  'clip-path': 'clipPath',
  stroke: 'stroke',
  'stroke-opacity': 'strokeOpacity',
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
}

function toReact(node: SvgNode, key: number): ReactNode {
  const props: Record<string, string | number> = { key }
  for (const [name, value] of Object.entries(node.attrs) as [
    SvgAttribute,
    string,
  ][])
    props[REACT_PROP[name]] = value
  return createElement(node.tag, props, node.children?.map(toReact))
}

/** React ids contain characters that are awkward inside `url(#…)`. */
const svgIdPrefix = (reactId: string) =>
  `corn-${reactId.replace(/[^A-Za-z0-9_-]/g, '')}`

export interface StaticAvatarProps {
  readonly variant: CornAvatarVariant
  readonly size: number
}

/** One still frame of the Corn artwork; no animation runtime is loaded. */
export function StaticAvatar({ variant, size }: StaticAvatarProps) {
  const idPrefix = svgIdPrefix(useId())
  const detail = avatarDetailFor(size)
  const children = useMemo(
    () => cornAvatarArtwork({ variant, idPrefix, detail }).map(toReact),
    [variant, idPrefix, detail],
  )
  return (
    <svg
      className="corn-avatar__art"
      width={size}
      height={size}
      viewBox={AVATAR_VIEWBOX}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}
