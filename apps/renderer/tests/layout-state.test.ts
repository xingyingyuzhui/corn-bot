import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  autoCompactFor,
  clampSidebarWidth,
  detailsLocationFor,
  draftFor,
  initialLayout,
  LAYOUT,
  type LayoutAction,
  type LayoutState,
  layoutReducer,
  type Overlay,
  resolveLayout,
  resolveSidebarDrag,
  sidebarCollapsed,
  sidebarSnapshot,
} from '../src/app/layout-state.ts'
import { EMPTY_DRAFT } from '../src/model/draft.ts'

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
    {
      type: 'edit-draft',
      botId: 'a',
      draft: { text: 'draft for a', attachments: [] },
    },
    { type: 'record-scroll', scroll: { top: 120, pinnedToBottom: false } },
    { type: 'open-details-entry', botId: 'a', entry: 'memory' },
    { type: 'select-bot', botId: 'b' },
    {
      type: 'edit-draft',
      botId: 'b',
      draft: { text: 'draft for b', attachments: [] },
    },
    { type: 'close-details' },
    { type: 'select-bot', botId: 'a' },
  )
  assert.equal(draftFor(state, 'a').text, 'draft for a')
  assert.equal(draftFor(state, 'b').text, 'draft for b')
  assert.deepEqual(draftFor(state, 'c'), EMPTY_DRAFT)
  assert.deepEqual(state.scroll.a, { top: 120, pinnedToBottom: false })
  assert.equal(detailsLocationFor(state, 'a').tab, 'library')
  assert.equal(detailsLocationFor(state, 'a').section, 'memory')
  assert.equal(detailsLocationFor(state, 'b').tab, 'overview')
})

test('automatic compaction never overwrites the manual sidebar preference', () => {
  const narrow = run(initialLayout('a'), { type: 'viewport', width: 699 })
  assert.equal(sidebarCollapsed(narrow), true)
  assert.equal(narrow.sidebarManualCollapsed, false)
  const wide = run(narrow, { type: 'viewport', width: 1200 })
  assert.equal(sidebarCollapsed(wide), false)

  const manual = run(initialLayout('a'), { type: 'toggle-sidebar' })
  const resized = run(
    manual,
    { type: 'viewport', width: 699 },
    { type: 'viewport', width: 1200 },
  )
  assert.equal(resized.sidebarManualCollapsed, true)
  assert.equal(sidebarCollapsed(resized), true)
})

test('unchanged actions keep state identity', () => {
  const state = initialLayout('a')
  assert.equal(layoutReducer(state, { type: 'select-bot', botId: 'a' }), state)
  assert.equal(layoutReducer(state, { type: 'close-details' }), state)
  const sized = run(state, { type: 'viewport', width: 1024 })
  assert.equal(layoutReducer(sized, { type: 'viewport', width: 1024 }), sized)
  assert.equal(layoutReducer(state, { type: 'close-roster-search' }), state)
})

test('one overlay at a time, closing is idempotent', () => {
  const state = run(
    initialLayout('a'),
    { type: 'open-overlay', overlay: { kind: 'create-bot' } },
    { type: 'open-overlay', overlay: { kind: 'bot-tags', botId: 'a' } },
  )
  assert.deepEqual(state.overlay, { kind: 'bot-tags', botId: 'a' })
  const open = state.overlay
  if (!open) throw new Error('overlay expected')
  const closed = run(state, { type: 'close-overlay', overlay: open })
  assert.equal(closed.overlay, null)
  assert.equal(
    layoutReducer(closed, { type: 'close-overlay', overlay: open }),
    closed,
  )
})

test('a late close from a replaced overlay leaves its successor open', () => {
  const profile: Overlay = { kind: 'bot-profile', botId: 'a' }
  const settings: Overlay = { kind: 'settings', section: 'models' }
  const state = run(
    initialLayout('a'),
    { type: 'open-overlay', overlay: profile },
    { type: 'open-overlay', overlay: settings },
    { type: 'close-overlay', overlay: profile },
  )
  assert.equal(state.overlay, settings)
})

test('preferred width is clamped to the kit range 240–400', () => {
  assert.equal(clampSidebarWidth(100), LAYOUT.sidebarMinWidth)
  assert.equal(clampSidebarWidth(239.6), 240)
  assert.equal(clampSidebarWidth(312.4), 312)
  assert.equal(clampSidebarWidth(900), LAYOUT.sidebarMaxWidth)
  assert.equal(initialLayout('a').sidebarPreferredWidth, 276)
})

test('auto-compact follows preferred width + 424 (700 at 276, 824 at 400)', () => {
  for (const [preferred, threshold] of [
    [276, 700],
    [400, 824],
  ] as const) {
    assert.equal(autoCompactFor(threshold - 1, preferred), true)
    assert.equal(autoCompactFor(threshold, preferred), false)
    assert.equal(autoCompactFor(threshold + 1, preferred), false)
  }
  const wide = run(
    initialLayout('a', 1200),
    { type: 'resize-sidebar', width: 400 },
    { type: 'viewport', width: 823 },
  )
  assert.equal(wide.sidebarPreferredWidth, 400)
  assert.equal(sidebarCollapsed(wide), true)
  assert.equal(wide.sidebarManualCollapsed, false)
  assert.equal(
    sidebarCollapsed(run(wide, { type: 'viewport', width: 824 })),
    false,
  )
  assert.equal(sidebarCollapsed(initialLayout('a', 699)), true)
  assert.equal(sidebarCollapsed(initialLayout('a', 700)), false)
})

test('drag thresholds: expanded collapses below 210, collapsed expands from 220', () => {
  assert.deepEqual(resolveSidebarDrag('expanded', 209, 1200), {
    kind: 'collapse',
  })
  assert.deepEqual(resolveSidebarDrag('expanded', 210, 1200), {
    kind: 'expand',
    width: 240,
  })
  assert.deepEqual(resolveSidebarDrag('expanded', 520, 1200), {
    kind: 'expand',
    width: 400,
  })
  assert.deepEqual(resolveSidebarDrag('expanded', 380, 744), {
    kind: 'expand',
    width: 320,
  })
  assert.deepEqual(resolveSidebarDrag('collapsed', 219, 1200), {
    kind: 'collapse',
  })
  assert.deepEqual(resolveSidebarDrag('collapsed', 220, 1200), {
    kind: 'expand',
    width: 240,
  })
  assert.deepEqual(
    resolveSidebarDrag('collapsed', 300, 700),
    { kind: 'collapse' },
    'no forced expansion when the main reserve no longer fits',
  )
})

test('dragging collapses manually and back out restores the preferred width', () => {
  const start = initialLayout('a', 1024)
  const collapsed = run(start, { type: 'resize-sidebar', width: 150 })
  assert.equal(collapsed.sidebarManualCollapsed, true)
  assert.equal(collapsed.sidebarPreferredWidth, 276)
  assert.equal(
    resolveLayout(collapsed, 1024).sidebarWidth,
    LAYOUT.sidebarRailWidth,
  )
  assert.equal(
    run(collapsed, { type: 'resize-sidebar', width: 200 }),
    collapsed,
  )
  const reopened = run(collapsed, { type: 'resize-sidebar', width: 300 })
  assert.equal(sidebarCollapsed(reopened), false)
  assert.equal(reopened.sidebarPreferredWidth, 300)
})

test('Escape restores the snapshot taken when the drag began', () => {
  const start = run(initialLayout('a', 1200), {
    type: 'resize-sidebar',
    width: 320,
  })
  const snapshot = sidebarSnapshot(start)
  const dragged = run(
    start,
    { type: 'resize-sidebar', width: 390 },
    { type: 'resize-sidebar', width: 100 },
  )
  assert.equal(dragged.sidebarManualCollapsed, true)
  const restored = run(dragged, { type: 'restore-sidebar', snapshot })
  assert.deepEqual(sidebarSnapshot(restored), snapshot)
})

test('auto-compact rail can be expanded by drag without touching the manual flag', () => {
  const narrow = initialLayout('a', 690)
  assert.equal(sidebarCollapsed(narrow), true)
  assert.equal(run(narrow, { type: 'resize-sidebar', width: 270 }), narrow)
  const wider = run(narrow, { type: 'viewport', width: 699 })
  assert.equal(sidebarCollapsed(wider), true)
  const opened = run(wider, { type: 'resize-sidebar', width: 270 })
  assert.equal(sidebarCollapsed(opened), false)
  assert.equal(opened.sidebarManualCollapsed, false)
})

test('preferred width survives collapse and drives the expanded column', () => {
  const state = run(
    initialLayout('a', 1280),
    { type: 'resize-sidebar', width: 330 },
    { type: 'toggle-sidebar' },
    { type: 'toggle-sidebar' },
    { type: 'open-details' },
  )
  const layout = resolveLayout(state, 1280)
  assert.equal(layout.sidebarWidth, 330)
  assert.equal(layout.details, 'column')
})

test('roster search keeps its query and re-focuses on every open request', () => {
  const opened = run(initialLayout('a'), { type: 'open-roster-search' })
  assert.deepEqual(opened.rosterSearch, { query: '', focusPending: true })
  const focused = run(opened, { type: 'roster-search-focused' })
  assert.equal(focused.rosterSearch?.focusPending, false)
  assert.equal(
    layoutReducer(focused, { type: 'roster-search-focused' }),
    focused,
  )
  const typed = run(focused, { type: 'edit-roster-search', query: '工程' })
  assert.equal(typed.rosterSearch?.focusPending, false)
  const again = run(typed, { type: 'open-roster-search' })
  assert.deepEqual(again.rosterSearch, { query: '工程', focusPending: true })
  const closed = run(
    again,
    { type: 'roster-search-focused' },
    { type: 'close-roster-search' },
  )
  assert.equal(closed.rosterSearch, null)
  const reopened = run(closed, { type: 'open-roster-search' })
  assert.equal(reopened.rosterSearch?.focusPending, true)
})

test('group folds toggle independently', () => {
  const state = run(
    initialLayout('a'),
    { type: 'toggle-group', groupId: 'tech' },
    { type: 'toggle-group', groupId: 'office' },
    { type: 'toggle-group', groupId: 'tech' },
  )
  assert.deepEqual(state.foldedGroupIds, ['office'])
})

test('a send that settles after a Bot switch clears the sending Bot only', () => {
  const sent = { clientId: 'c1', text: 'hi', attachmentIds: [] }
  const state = run(
    initialLayout('a'),
    { type: 'edit-draft', botId: 'a', draft: { text: 'hi', attachments: [] } },
    { type: 'select-bot', botId: 'b' },
    { type: 'edit-draft', botId: 'b', draft: { text: 'hi', attachments: [] } },
    { type: 'settle-sent-draft', botId: 'a', sent },
  )
  assert.deepEqual(draftFor(state, 'a'), EMPTY_DRAFT)
  assert.equal(draftFor(state, 'b').text, 'hi')
})

test('a draft edited while its send was in flight is kept', () => {
  const sent = { clientId: 'c1', text: 'hi', attachmentIds: [] }
  const edited = run(initialLayout('a'), {
    type: 'edit-draft',
    botId: 'a',
    draft: { text: 'hi!', attachments: [] },
  })
  assert.equal(
    layoutReducer(edited, { type: 'settle-sent-draft', botId: 'a', sent }),
    edited,
  )
})

test('a create that settles after its dialog closed never steals selection', () => {
  const create: Overlay = { kind: 'create-bot' }
  const open = run(initialLayout('a'), {
    type: 'open-overlay',
    overlay: create,
  })
  const done = run(open, { type: 'bot-created', overlay: create, botId: 'new' })
  assert.equal(done.selectedBotId, 'new')
  assert.equal(done.overlay, null)
  const late = run(
    open,
    { type: 'close-overlay', overlay: create },
    { type: 'select-bot', botId: 'b' },
    { type: 'bot-created', overlay: create, botId: 'new' },
  )
  assert.equal(late.selectedBotId, 'b')
})
