import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AVATAR_VISUAL_STATES,
  CORN_AVATAR_SHAPES,
  CORN_AVATAR_VARIANT_IDS,
  DEFAULT_AVATAR_VARIANT_IDS,
  defaultAvatarVariantFor,
  isAvatarVisualState,
  isCornAvatarShape,
  isCornAvatarVariantId,
  stableAvatarHash,
} from '../src/avatar.ts'

test('vocabulary sizes are locked: 18 states, 9 shapes, 16 variants', () => {
  for (const [list, size] of [
    [AVATAR_VISUAL_STATES, 18],
    [CORN_AVATAR_SHAPES, 9],
    [CORN_AVATAR_VARIANT_IDS, 16],
  ] as const) {
    assert.equal(list.length, size)
    assert.equal(new Set(list).size, size)
  }
})

test('guards reject unknown strings and non-strings', () => {
  assert.ok(isCornAvatarVariantId('ppt'))
  assert.ok(!isCornAvatarVariantId('Ppt'))
  assert.ok(!isCornAvatarVariantId(undefined))
  assert.ok(isCornAvatarShape('husk-fan'))
  assert.ok(!isCornAvatarShape('circle'))
  assert.ok(isAvatarVisualState('powering-down'))
  assert.ok(!isAvatarVisualState('done'))
  assert.ok(!isAvatarVisualState(3))
})

test('stable hash is 32-bit FNV-1a', () => {
  assert.equal(stableAvatarHash(''), 0x811c9dc5)
  assert.equal(stableAvatarHash('a'), 0xe40c292c)
  assert.equal(stableAvatarHash('foobar'), 0xbf9cf968)
})

test('new Bot defaults come from the 15 non-小黄 variants, keyed by id only', () => {
  assert.equal(DEFAULT_AVATAR_VARIANT_IDS.length, 15)
  assert.ok(!DEFAULT_AVATAR_VARIANT_IDS.includes('xiaohuang'))
  const seen = new Set<string>()
  for (let index = 0; index < 600; index++) {
    const id = `mock-${index}`
    const pick = defaultAvatarVariantFor(id)
    assert.notEqual(pick, 'xiaohuang')
    assert.equal(defaultAvatarVariantFor(id), pick)
    seen.add(pick)
  }
  assert.equal(seen.size, 15)
  // Locked examples: changing the hash or catalog order would re-skin Bots.
  assert.deepEqual(
    ['mock-1', 'mock-2', 'mock-3'].map(defaultAvatarVariantFor),
    ['news', 'word', 'cad'],
  )
})
