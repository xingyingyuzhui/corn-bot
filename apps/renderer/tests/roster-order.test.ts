import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  adjacentBotId,
  NO_FILTER,
  rosterFilterFor,
  rosterSections,
  UNLISTED_GROUP,
  visibleBotOrder,
} from '../src/features/roster/roster-order.ts'
import { m1FixtureSnapshot } from '../src/fixtures/m1-workspace.ts'
import type { RosterView } from '../src/model/workspace.ts'

const roster = (patch: Partial<RosterView> = {}): RosterView => ({
  ...m1FixtureSnapshot().roster,
  ...patch,
})

const REFERENCE_ORDER = [
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
]

test('reference roster order is pinned first, then groups top to bottom', () => {
  assert.deepEqual(visibleBotOrder(roster(), NO_FILTER), REFERENCE_ORDER)
})

test('hidden Bots and folded groups leave the visible order', () => {
  const order = visibleBotOrder(
    roster({ hiddenBotIds: ['backend', 'xiaohuang'] }),
    {
      foldedGroupIds: ['office'],
      search: '',
    },
  )
  assert.deepEqual(order, ['ops', 'frontend', 'architect', 'wechat', 'video'])
})

test('a pinned Bot renders once, in the pinned strip', () => {
  const view = roster({ pinnedBotIds: ['xiaohuang', 'cad'] })
  const sections = rosterSections(view, NO_FILTER)
  assert.deepEqual(
    sections.pinned.map((bot) => bot.id),
    ['xiaohuang', 'cad'],
  )
  const office = sections.groups.find((group) => group.id === 'office')
  assert.equal(
    office?.bots.some((bot) => bot.id === 'cad'),
    false,
  )
  assert.deepEqual(visibleBotOrder(view, NO_FILTER).slice(0, 3), [
    'xiaohuang',
    'cad',
    'ops',
  ])
})

test('an unpinned Bot without a group lands in the trailing 其他 group', () => {
  const sections = rosterSections(roster({ pinnedBotIds: [] }), NO_FILTER)
  const last = sections.groups.at(-1)
  assert.equal(last?.id, UNLISTED_GROUP.id)
  assert.deepEqual(
    last?.bots.map((bot) => bot.id),
    ['xiaohuang'],
  )
})

test('search matches name, role and tag label, case-insensitively', () => {
  const byName = visibleBotOrder(roster(), {
    foldedGroupIds: [],
    search: ' excel ',
  })
  assert.deepEqual(byName, ['excel'])
  const byRole = visibleBotOrder(roster(), {
    foldedGroupIds: [],
    search: '排版',
  })
  assert.deepEqual(byRole, ['word', 'wechat'])
  const byTag = visibleBotOrder(roster(), {
    foldedGroupIds: [],
    search: '内容',
  })
  assert.deepEqual(byTag, ['wechat', 'video'])
})

test('search ignores folds, drops empty groups and reports hidden matches separately', () => {
  const view = roster({ hiddenBotIds: ['excel'] })
  const sections = rosterSections(view, {
    foldedGroupIds: ['office'],
    search: 'excel',
  })
  assert.equal(sections.searching, true)
  assert.deepEqual(sections.groups, [])
  assert.deepEqual(
    sections.hidden.map((bot) => bot.id),
    ['excel'],
  )
  const word = rosterSections(view, {
    foldedGroupIds: ['office'],
    search: 'word',
  })
  assert.equal(word.groups[0]?.folded, false)
})

test('empty search result yields no sections', () => {
  const sections = rosterSections(roster(), {
    foldedGroupIds: [],
    search: '不存在的 Bot',
  })
  assert.deepEqual(sections.pinned, [])
  assert.deepEqual(sections.groups, [])
  assert.deepEqual(sections.hidden, [])
})

test('the rail ignores folds and search so it always lists every visible Bot', () => {
  assert.equal(rosterFilterFor(true, ['tech'], 'excel'), NO_FILTER)
  assert.deepEqual(rosterFilterFor(false, ['tech'], undefined), {
    foldedGroupIds: ['tech'],
    search: '',
  })
})

test('adjacent Bot stops at both ends and enters from outside the order', () => {
  const order = ['a', 'b', 'c']
  assert.equal(adjacentBotId(order, 'a', 1), 'b')
  assert.equal(adjacentBotId(order, 'c', 1), null)
  assert.equal(adjacentBotId(order, 'a', -1), null)
  assert.equal(adjacentBotId(order, 'hidden', 1), 'a')
  assert.equal(adjacentBotId(order, 'hidden', -1), 'c')
  assert.equal(adjacentBotId([], 'a', 1), null)
})
