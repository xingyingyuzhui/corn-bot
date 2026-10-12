import { createElement, type ReactNode } from 'react'
import type { SvgAttribute, SvgNode } from './artwork.ts'

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

export function svgNodeToReact(node: SvgNode, key: number): ReactNode {
  const props: Record<string, string | number> = { key }
  for (const [name, value] of Object.entries(node.attrs) as [
    SvgAttribute,
    string,
  ][])
    props[REACT_PROP[name]] = value
  return createElement(node.tag, props, node.children?.map(svgNodeToReact))
}

/** React ids contain characters that are awkward inside `url(#…)`. */
export const svgIdPrefix = (reactId: string) =>
  `corn-${reactId.replace(/[^A-Za-z0-9_-]/g, '')}`
