import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  checkNewTag,
  filterTags,
  sameTagSet,
  toggleTag,
} from '../src/features/bot-editor/tag-editor.ts'
import { TAG_MAX } from '../src/model/limits.ts'
import type { TagView } from '../src/model/workspace.ts'

const TAGS: Readonly<Record<string, TagView>> = {
  a: { id: 'a', label: '调度' },
  b: { id: 'b', label: '内容' },
  c: { id: 'c', label: 'Design' },
}

test('filter matches case-insensitively and lists selected tags first', () => {
  assert.deepEqual(
    filterTags(TAGS, '', ['c']).map((tag) => tag.id),
    ['c', 'a', 'b'],
  )
  assert.deepEqual(
    filterTags(TAGS, '  des ', []).map((tag) => tag.id),
    ['c'],
  )
  assert.deepEqual(filterTags(TAGS, '不存在', []), [])
})

test('toggling keeps the order tags were chosen in', () => {
  const first = toggleTag([], 'b')
  const second = toggleTag(first, 'a')
  assert.deepEqual(second, ['b', 'a'])
  assert.deepEqual(toggleTag(second, 'b'), ['a'])
})

test('selection comparison ignores order and duplicates', () => {
  assert.ok(sameTagSet(['a', 'b'], ['b', 'a']))
  assert.ok(sameTagSet(['a', 'a'], ['a']))
  assert.ok(!sameTagSet(['a'], ['a', 'b']))
})

test('new tag check: empty, existing, too long and ok', () => {
  assert.deepEqual(checkNewTag('   ', TAGS, TAG_MAX), { kind: 'empty' })
  assert.deepEqual(checkNewTag(' design ', TAGS, TAG_MAX), {
    kind: 'existing',
    tag: TAGS.c,
  })
  assert.equal(
    checkNewTag('一'.repeat(TAG_MAX + 1), TAGS, TAG_MAX).kind,
    'too-long',
  )
  assert.deepEqual(checkNewTag('  运维 ', TAGS, TAG_MAX), {
    kind: 'ok',
    label: '运维',
  })
})
