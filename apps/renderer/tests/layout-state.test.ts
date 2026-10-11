import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  detailsTabFor,
  draftFor,
  EMPTY_DRAFT,
  initialLayout,
  LAYOUT,
  type LayoutAction,
  type LayoutState,
  layoutReducer,
  resolveLayout,
  sidebarCollapsed,
} from '../src/app/layout-state.ts'

const run = (state: LayoutState, ...actions: LayoutAction[]) =>
  actions.reduce(layoutReducer, state)

test('reference viewport matches the screenshot calibration', () => {
  const open = run(initialLayout('a'), { type: 'open-details' })
  const layout = resolveLayout(open, 1024)
  assert.equal(layout.details, 'column')
  assert.equal(layout.sidebarWidth, 276)
  assert.equal(layout.detailsWidth, 376)
  assert.equal(1024 - layout.sidebarWidth - layout.detailsWidth, 372)
  assert.equal(resolveLayout(initialLayout('a'), 1024).details, 'closed')
})

test('details overlay the chat instead of crushing it', () => {
  const open = run(initialLayout('a'), { type: 'open-details' })
  const narrow = resolveLayout(open, 960)
  assert.equal(narrow.details, 'overlay')
  assert.equal(narrow.sidebarWidth, LAYOUT.sidebarWidth)
})

test('drafts, scroll and tabs are kept per Bot across switches and panel toggles', () => {
  const state = run(
    initialLayout('a'),
    { type: 'edit-draft', draft: { text: 'draft for a', attachments: [] } },
    { type: 'record-scroll', scroll: { top: 120, pinnedToBottom: false } },
    { type: 'select-tab', tab: 'computer' },
    { type: 'open-details' },
    { type: 'select-bot', botId: 'b' },
    { type: 'edit-draft', draft: { text: 'draft for b', attachments: [] } },
    { type: 'close-details' },
    { type: 'select-bot', botId: 'a' },
  )
  assert.equal(draftFor(state, 'a').text, 'draft for a')
  assert.equal(draftFor(state, 'b').text, 'draft for b')
  assert.deepEqual(draftFor(state, 'c'), EMPTY_DRAFT)
  assert.deepEqual(state.scroll.a, { top: 120, pinnedToBottom: false })
  assert.equal(detailsTabFor(state, 'a'), 'computer')
  assert.equal(detailsTabFor(state, 'b'), 'details')
})

test('automatic compaction never overwrites the manual sidebar preference', () => {
  const narrow = run(initialLayout('a'), { type: 'viewport', width: 700 })
  assert.equal(sidebarCollapsed(narrow), true)
  assert.equal(narrow.sidebarManualCollapsed, false)
  const wide = run(narrow, { type: 'viewport', width: 1200 })
  assert.equal(sidebarCollapsed(wide), false)

  const manual = run(initialLayout('a'), { type: 'toggle-sidebar' })
  const resized = run(
    manual,
    { type: 'viewport', width: 700 },
    { type: 'viewport', width: 1200 },
  )
  assert.equal(resized.sidebarManualCollapsed, true)
  assert.equal(sidebarCollapsed(resized), true)
})

test('unchanged actions keep state identity', () => {
  const state = initialLayout('a')
  assert.equal(layoutReducer(state, { type: 'select-bot', botId: 'a' }), state)
  assert.equal(layoutReducer(state, { type: 'close-details' }), state)
  assert.equal(layoutReducer(state, { type: 'viewport', width: 1024 }), state)
})

test('one overlay at a time, closing is idempotent', () => {
  const state = run(
    initialLayout('a'),
    { type: 'open-overlay', overlay: { kind: 'create-bot' } },
    { type: 'open-overlay', overlay: { kind: 'bot-tags', botId: 'a' } },
  )
  assert.deepEqual(state.overlay, { kind: 'bot-tags', botId: 'a' })
  const closed = run(state, { type: 'close-overlay' })
  assert.equal(closed.overlay, null)
  assert.equal(layoutReducer(closed, { type: 'close-overlay' }), closed)
})
