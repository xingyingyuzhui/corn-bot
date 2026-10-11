import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  detailsLocationFor,
  initialLayout,
  type LayoutAction,
  type LayoutState,
  layoutReducer,
} from '../src/app/layout-state.ts'
import {
  CONFIG_PAGE_CATALOG,
  CONFIG_SUBPAGES,
  DEFAULT_LOCATION,
  locationForEntry,
  MAIN_TAB_LABELS,
  MAIN_TABS,
  normalizeLocation,
  openSubpage,
  tabForKey,
  viewKey,
} from '../src/features/details/details-navigation.ts'

const run = (state: LayoutState, ...actions: LayoutAction[]) =>
  actions.reduce(layoutReducer, state)

test('catalog: three main tabs and four configuration entries, in order', () => {
  assert.deepEqual(
    MAIN_TABS.map((tab) => MAIN_TAB_LABELS[tab]),
    ['概览', '配置', '资料库'],
  )
  assert.deepEqual(
    CONFIG_SUBPAGES.map((page) => CONFIG_PAGE_CATALOG[page].label),
    ['核心设定', '模型', '权限', '技能'],
  )
})

test('old tab ids map to the new hierarchy; unknown values fall back', () => {
  assert.deepEqual(normalizeLocation('details'), DEFAULT_LOCATION)
  assert.deepEqual(normalizeLocation('library'), {
    ...DEFAULT_LOCATION,
    tab: 'library',
    section: 'artifacts',
  })
  assert.deepEqual(normalizeLocation('computer'), {
    ...DEFAULT_LOCATION,
    tab: 'configuration',
    page: 'permissions',
  })
  assert.deepEqual(normalizeLocation('configuration').tab, 'configuration')
  for (const unknown of ['media', '', null, undefined, 3, { tab: 'computer' }])
    assert.deepEqual(normalizeLocation(unknown), DEFAULT_LOCATION)
})

test('an invalid subpage or section restores that tab home', () => {
  assert.deepEqual(
    normalizeLocation({ tab: 'configuration', page: 'computer' }),
    { tab: 'configuration', page: 'home', section: 'artifacts' },
  )
  assert.deepEqual(
    normalizeLocation({ tab: 'library', page: 'model', section: 'notes' }),
    { tab: 'library', page: 'model', section: 'artifacts' },
  )
  const valid = { tab: 'library', page: 'skills', section: 'memory' } as const
  assert.deepEqual(normalizeLocation(valid), valid)
})

test('keyboard: arrows wrap, Home/End jump, other keys are ignored', () => {
  assert.equal(tabForKey('overview', 'ArrowRight'), 'configuration')
  assert.equal(tabForKey('library', 'ArrowRight'), 'overview')
  assert.equal(tabForKey('overview', 'ArrowLeft'), 'library')
  assert.equal(tabForKey('library', 'Home'), 'overview')
  assert.equal(tabForKey('overview', 'End'), 'library')
  assert.equal(tabForKey('overview', 'ArrowDown'), null)
  assert.equal(tabForKey('overview', 'Enter'), null)
})

test('entries land on the right place and keep the other remembered parts', () => {
  const start = { tab: 'library', page: 'skills', section: 'memory' } as const
  assert.deepEqual(locationForEntry(start, 'permissions'), {
    ...start,
    tab: 'configuration',
    page: 'permissions',
  })
  assert.deepEqual(locationForEntry(start, 'artifacts'), {
    ...start,
    section: 'artifacts',
  })
  assert.equal(locationForEntry(start, 'overview').tab, 'overview')
  assert.equal(openSubpage(locationForEntry(start, 'model')), 'model')
  assert.equal(
    openSubpage({ ...start, tab: 'configuration', page: 'home' }),
    null,
  )
  assert.equal(openSubpage(start), null)
})

test('view keys separate subpages and sections', () => {
  assert.equal(viewKey(DEFAULT_LOCATION), 'overview')
  assert.equal(
    viewKey({ ...DEFAULT_LOCATION, tab: 'configuration', page: 'model' }),
    'configuration/model',
  )
  assert.equal(
    viewKey({ ...DEFAULT_LOCATION, tab: 'library', section: 'memory' }),
    'library/memory',
  )
})

test('per-Bot location and pane scroll are restored after a switch', () => {
  const state = run(
    initialLayout('a'),
    { type: 'open-details-entry', botId: 'a', entry: 'model' },
    {
      type: 'record-details-scroll',
      botId: 'a',
      view: 'configuration/model',
      top: 140,
    },
    { type: 'select-bot', botId: 'b' },
    { type: 'open-details-entry', botId: 'b', entry: 'memory' },
    { type: 'select-bot', botId: 'a' },
  )
  assert.deepEqual(detailsLocationFor(state, 'a'), {
    tab: 'configuration',
    page: 'model',
    section: 'artifacts',
  })
  assert.equal(detailsLocationFor(state, 'b').section, 'memory')
  assert.equal(detailsLocationFor(state, 'c'), DEFAULT_LOCATION)
  assert.equal(state.detailsScroll.a?.['configuration/model'], 140)
  assert.equal(state.detailsScroll.b, undefined)
  assert.ok(state.detailsOpen)
})

test('entries open the pane and ask for heading focus only on subpages', () => {
  const opened = run(initialLayout('a'), {
    type: 'open-details-entry',
    botId: 'a',
    entry: 'permissions',
  })
  assert.ok(opened.detailsOpen)
  assert.deepEqual(opened.detailsFocus, {
    botId: 'a',
    target: { kind: 'page-heading' },
  })
  const focused = run(opened, { type: 'details-focused' })
  assert.equal(focused.detailsFocus, null)
  assert.equal(layoutReducer(focused, { type: 'details-focused' }), focused)
  const library = run(focused, {
    type: 'open-details-entry',
    botId: 'a',
    entry: 'memory',
  })
  assert.equal(library.detailsFocus, null)
})

test('returning to configuration home asks to focus the originating entry', () => {
  const state = run(
    initialLayout('a'),
    { type: 'open-details-entry', botId: 'a', entry: 'skills' },
    {
      type: 'navigate-details',
      botId: 'a',
      location: { tab: 'configuration', page: 'home', section: 'artifacts' },
      focus: { kind: 'config-entry', page: 'skills' },
    },
  )
  assert.equal(detailsLocationFor(state, 'a').page, 'home')
  assert.deepEqual(state.detailsFocus?.target, {
    kind: 'config-entry',
    page: 'skills',
  })
})

test('a navigation for a Bot that is no longer selected changes nothing', () => {
  const state = run(initialLayout('a'), { type: 'select-bot', botId: 'b' })
  const late = run(state, {
    type: 'navigate-details',
    botId: 'a',
    location: { ...DEFAULT_LOCATION, tab: 'library' },
    open: true,
    focus: { kind: 'page-heading' },
  })
  assert.equal(late, state)
  assert.equal(late.detailsOpen, false)
})

test('switching Bot drops a pending focus request', () => {
  const state = run(
    initialLayout('a'),
    { type: 'open-details-entry', botId: 'a', entry: 'core' },
    { type: 'select-bot', botId: 'b' },
  )
  assert.equal(state.detailsFocus, null)
})
