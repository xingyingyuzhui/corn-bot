import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  CORN_AVATAR_SHAPES,
  CORN_AVATAR_VARIANT_IDS,
} from '@corn-bot/contracts/avatar'
import {
  type AvatarDecoration,
  type AvatarExpression,
  avatarDetailFor,
  cornAvatarArtwork,
  EYE_TILT_DEGREES,
  type SvgNode,
  serialiseSvgNodes,
} from '../src/avatar/artwork.ts'
import {
  CORN_AVATAR_VARIANTS,
  type CornAvatarVariant,
  findAvatarVariant,
} from '../src/avatar/variants.ts'

const assets = new URL('../assets/', import.meta.url)
const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"'

interface LockedCatalog {
  readonly variants: readonly {
    id: string
    name: string
    shape: string
    body: string
    husk: string
    eye: string
  }[]
  readonly shapes: readonly string[]
  readonly groups: readonly { id: string; name: string; variants: string[] }[]
}

const catalog: LockedCatalog = JSON.parse(
  await readFile(new URL('catalog.json', assets), 'utf8'),
)

const variantOf = (id: string): CornAvatarVariant => {
  const found = findAvatarVariant(id)
  assert.ok(found, id)
  return found
}

/** The kit's standalone SVG wrapper around the same artwork. */
const standalone = (variant: CornAvatarVariant, size: number, prefix: string) =>
  `<svg ${SVG_NS} width="${size}" height="${size}" viewBox="0 0 128 128" role="img" aria-labelledby="${prefix}-title"><title id="${prefix}-title">${variant.name} · Corn Bot</title>${serialiseSvgNodes(
    cornAvatarArtwork({ variant, idPrefix: prefix }),
  )}</svg>`

const walk = (nodes: readonly SvgNode[]): SvgNode[] =>
  nodes.flatMap((node) => [node, ...walk(node.children ?? [])])

test('variant catalog matches the locked Corn catalog and the contract order', () => {
  assert.deepEqual(
    CORN_AVATAR_VARIANTS.map(({ id, name, shape, body, husk, eye }) => ({
      id,
      name,
      shape,
      body,
      husk,
      eye,
    })),
    catalog.variants,
  )
  assert.deepEqual(
    CORN_AVATAR_VARIANTS.map((variant) => variant.id),
    [...CORN_AVATAR_VARIANT_IDS],
  )
  assert.deepEqual(catalog.shapes, [...CORN_AVATAR_SHAPES])
})

test('adapted geometry reproduces every migrated static avatar byte for byte', async () => {
  for (const variant of CORN_AVATAR_VARIANTS) {
    const locked = await readFile(
      new URL(`avatars/${variant.id}.svg`, assets),
      'utf8',
    )
    assert.equal(
      standalone(variant, 512, `static-${variant.id}`),
      locked,
      variant.id,
    )
  }
})

test('archived group avatars are compositions of the same static artwork', async () => {
  for (const group of catalog.groups) {
    const children = group.variants
      .map((id, index) =>
        standalone(variantOf(id), 100, `group-${group.id}-${index}`).replace(
          '<svg ',
          `<svg x="${[1, 34, 67][index]}" y="${[24, 4, 24][index]}" `,
        ),
      )
      .join('')
    const locked = await readFile(
      new URL(`groups/${group.id}.svg`, assets),
      'utf8',
    )
    assert.equal(
      `<svg ${SVG_NS} width="512" height="400" viewBox="0 0 168 132"><title>${group.name} · Corn Bot</title>${children}</svg>`,
      locked,
      group.id,
    )
  }
})

test('unknown or missing variant ids resolve to null for the placeholder fallback', () => {
  assert.equal(findAvatarVariant(undefined), null)
  assert.equal(findAvatarVariant('grok-bot'), null)
  assert.equal(findAvatarVariant(''), null)
  assert.equal(findAvatarVariant('constructor'), null)
  assert.equal(findAvatarVariant('pdf')?.name, 'PDF专员')
})

test('two instances of one Bot never share an SVG id', () => {
  const variant = variantOf('xiaohuang')
  const ids = (prefix: string) =>
    walk(cornAvatarArtwork({ variant, idPrefix: prefix }))
      .map((node) => node.attrs.id)
      .filter((id) => id !== undefined)
  const first = ids('corn-r1')
  const second = ids('corn-r2')
  assert.equal(first.length, 1)
  assert.equal(new Set([...first, ...second]).size, 2)
  const markup = serialiseSvgNodes(
    cornAvatarArtwork({ variant, idPrefix: 'corn-r1' }),
  )
  assert.ok(markup.includes('clip-path="url(#corn-r1-body)"'))
  assert.throws(
    () => cornAvatarArtwork({ variant, idPrefix: '1bad' }),
    TypeError,
  )
  assert.throws(
    () => cornAvatarArtwork({ variant, idPrefix: 'bad"id' }),
    TypeError,
  )
})

test('every variant keeps `/` eyes: upper end right, lower end left, at every size', () => {
  for (const variant of CORN_AVATAR_VARIANTS)
    for (const size of [14, 24, 32, 36, 48, 52, 60]) {
      const eyes = walk(
        cornAvatarArtwork({
          variant,
          idPrefix: 'eyes',
          detail: avatarDetailFor(size),
        }),
      ).filter((node) => node.tag === 'rect')
      assert.equal(eyes.length, 2, `${variant.id}@${size}`)
      for (const eye of eyes) {
        const match = /^rotate\((-?[\d.]+) /.exec(eye.attrs.transform ?? '')
        const degrees = Number(match?.[1])
        assert.equal(degrees, EYE_TILT_DEGREES)
        // SVG y grows downwards, so a positive rotation moves the top end right.
        const radians = (degrees * Math.PI) / 180
        const half = Number(eye.attrs.height) / 2
        const top = {
          x: half * Math.sin(radians),
          y: -half * Math.cos(radians),
        }
        assert.ok(top.x > 0 && top.y < 0, `${variant.id}@${size}`)
      }
    }
})

test('compact detail drops seams and ids at 24 px and below only', () => {
  assert.equal(avatarDetailFor(14), 'compact')
  assert.equal(avatarDetailFor(24), 'compact')
  assert.equal(avatarDetailFor(30), 'full')
  for (const variant of CORN_AVATAR_VARIANTS) {
    const compact = walk(
      cornAvatarArtwork({ variant, idPrefix: 'c', detail: 'compact' }),
    )
    assert.ok(compact.every((node) => node.attrs.id === undefined))
    assert.ok(compact.every((node) => node.attrs['clip-path'] === undefined))
    assert.equal(
      compact.filter((node) => node.attrs.fill === variant.body).length,
      1,
    )
  }
})

test('every shape, decoration and expression stays finite', () => {
  const decorations: AvatarDecoration[] = [
    'none',
    'dots',
    'wave',
    'pencil',
    'upload',
    'send',
    'receive',
    'alert',
    'progress',
    'sparkles',
    'standby',
  ]
  const expressions: AvatarExpression[] = [
    'neutral',
    'happy',
    'sleepy',
    'confused',
  ]
  const variant = variantOf('xiaohuang')
  for (const shape of CORN_AVATAR_SHAPES)
    for (const decoration of decorations)
      for (const expression of expressions) {
        const markup = serialiseSvgNodes(
          cornAvatarArtwork({
            variant,
            shape,
            idPrefix: 'f',
            frame: {
              decoration,
              expression,
              phase: 1e9,
              tilt: Number.NaN,
              scale: Number.POSITIVE_INFINITY,
              eyeOpen: 0.9,
              gazeX: -9,
            },
          }),
        )
        assert.doesNotMatch(
          markup,
          /NaN|Infinity|undefined/,
          `${shape}/${decoration}`,
        )
      }
})
