import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  detailsLocationFor,
  initialLayout,
  type LayoutAction,
  type LayoutState,
  layoutReducer,
  type Overlay,
  type UnsavedConfigOverlay,
} from '../src/app/layout-state.ts'
import { BotEditorController } from '../src/features/bot-editor/bot-editor-controller.ts'
import { PROFILE_EDITOR } from '../src/features/bot-editor/editor-specs.ts'
import {
  type ConfigDraftHandle,
  ConfigDraftRegistry,
  settleUnsaved,
} from '../src/features/details/configuration/config-drafts.ts'
import { FixtureWorkspaceRepository } from '../src/fixtures/fixture-repository.ts'

const run = (state: LayoutState, ...actions: LayoutAction[]) =>
  actions.reduce(layoutReducer, state)

/** Bot `a` on its core subpage with unsaved changes. */
const dirtyCore = () =>
  run(
    initialLayout('a'),
    { type: 'open-details-entry', botId: 'a', entry: 'core' },
    { type: 'config-draft', botId: 'a', page: 'core', dirty: true },
  )

const promptOf = (state: LayoutState): UnsavedConfigOverlay => {
  const { overlay } = state
  if (overlay?.kind !== 'unsaved-config') throw new Error('prompt expected')
  return overlay
}

test('switching Bot, tab or subpage, or closing the pane asks first', () => {
  const start = dirtyCore()
  const leaving: readonly LayoutAction[] = [
    { type: 'select-bot', botId: 'b' },
    { type: 'close-details' },
    { type: 'open-details-entry', botId: 'a', entry: 'overview' },
    { type: 'open-details-entry', botId: 'a', entry: 'model' },
    {
      type: 'navigate-details',
      botId: 'a',
      location: { tab: 'configuration', page: 'home', section: 'artifacts' },
    },
  ]
  for (const action of leaving) {
    const held = layoutReducer(start, action)
    const prompt = promptOf(held)
    assert.equal(prompt.botId, 'a')
    assert.equal(prompt.page, 'core')
    assert.equal(held.selectedBotId, 'a')
    assert.ok(held.detailsOpen)
    assert.deepEqual(
      detailsLocationFor(held, 'a'),
      detailsLocationFor(start, 'a'),
    )
  }
})

test('staying on the same subpage or unrelated actions are not held', () => {
  const start = dirtyCore()
  const same = run(start, {
    type: 'open-details-entry',
    botId: 'a',
    entry: 'core',
  })
  assert.equal(same.overlay, null)
  const typed = run(start, {
    type: 'edit-draft',
    botId: 'a',
    draft: { text: 'hi', attachments: [] },
  })
  assert.equal(typed.overlay, null)
  const settings = run(start, {
    type: 'open-overlay',
    overlay: { kind: 'settings', section: 'models' },
  })
  assert.equal(settings.overlay?.kind, 'settings')
})

test('cancel stays; save or discard runs the held action once', () => {
  const held = run(dirtyCore(), { type: 'select-bot', botId: 'b' })
  const prompt = promptOf(held)
  const stayed = run(held, {
    type: 'resolve-unsaved-config',
    overlay: prompt,
    leave: false,
  })
  assert.equal(stayed.overlay, null)
  assert.equal(stayed.selectedBotId, 'a')
  assert.deepEqual(stayed.unsavedConfig, { botId: 'a', page: 'core' })

  const left = run(held, {
    type: 'resolve-unsaved-config',
    overlay: prompt,
    leave: true,
  })
  assert.equal(left.overlay, null)
  assert.equal(left.selectedBotId, 'b')
  assert.equal(left.unsavedConfig, null)
  assert.equal(
    layoutReducer(left, {
      type: 'resolve-unsaved-config',
      overlay: prompt,
      leave: true,
    }),
    left,
    'a stale resolve is ignored',
  )
})

test('a finished create waits for the prompt before selecting the new Bot', () => {
  const create: Overlay = { kind: 'create-bot' }
  const held = run(
    dirtyCore(),
    { type: 'open-overlay', overlay: create },
    { type: 'bot-created', overlay: create, botId: 'new' },
  )
  const prompt = promptOf(held)
  assert.deepEqual(prompt.then, { type: 'select-bot', botId: 'new' })
  assert.equal(held.selectedBotId, 'a')
  const left = run(held, {
    type: 'resolve-unsaved-config',
    overlay: prompt,
    leave: true,
  })
  assert.equal(left.selectedBotId, 'new')
})

test('the editor reporting clean or unmounting removes the guard', () => {
  const clean = run(dirtyCore(), {
    type: 'config-draft',
    botId: 'a',
    page: 'core',
    dirty: false,
  })
  assert.equal(clean.unsavedConfig, null)
  assert.equal(
    run(clean, { type: 'select-bot', botId: 'b' }).selectedBotId,
    'b',
  )
  const otherPage = run(dirtyCore(), {
    type: 'config-draft',
    botId: 'a',
    page: 'model',
    dirty: false,
  })
  assert.deepEqual(otherPage.unsavedConfig, { botId: 'a', page: 'core' })
})

test('settle: save leaves only when the write succeeds', async () => {
  const calls: string[] = []
  const handle = (saved: boolean): ConfigDraftHandle => ({
    botId: 'a',
    page: 'core',
    save: async () => {
      calls.push('save')
      return saved
    },
    discard: () => calls.push('discard'),
  })
  assert.equal(await settleUnsaved('save', handle(true)), true)
  assert.equal(await settleUnsaved('save', handle(false)), false)
  assert.equal(await settleUnsaved('discard', handle(true)), true)
  assert.equal(await settleUnsaved('cancel', handle(true)), false)
  assert.deepEqual(calls, ['save', 'save', 'discard'])
  assert.equal(await settleUnsaved('save', undefined), true)
})

test('end to end: a failed save keeps the draft and does not switch Bot', async () => {
  const repository = new FixtureWorkspaceRepository()
  const registry = new ConfigDraftRegistry()
  const bot = repository.getSnapshot().roster.bots.ops
  if (!bot) throw new Error('fixture Bot missing')
  const editor = new BotEditorController(repository, PROFILE_EDITOR, bot)
  const unregister = registry.register({
    botId: 'ops',
    page: 'core',
    save: async () => (await editor.save()) !== 'failed',
    discard: () => editor.reload(),
  })
  editor.edit((draft) => ({ ...draft, name: '' }), 'name')

  let state = run(
    initialLayout('ops'),
    { type: 'open-details-entry', botId: 'ops', entry: 'core' },
    { type: 'config-draft', botId: 'ops', page: 'core', dirty: true },
    { type: 'select-bot', botId: 'backend' },
  )
  const prompt = promptOf(state)
  const leave = await settleUnsaved(
    'save',
    registry.find(prompt.botId, prompt.page),
  )
  state = run(state, { type: 'resolve-unsaved-config', overlay: prompt, leave })
  assert.equal(leave, false)
  assert.equal(state.selectedBotId, 'ops')
  assert.equal(editor.getState().draft.name, '')
  assert.equal(editor.getState().fieldErrors.name, '请填写名称')

  const discarded = await settleUnsaved(
    'discard',
    registry.find(prompt.botId, prompt.page),
  )
  assert.equal(editor.getState().draft.name, bot.name)
  state = run(state, { type: 'select-bot', botId: 'backend' })
  state = run(state, {
    type: 'resolve-unsaved-config',
    overlay: promptOf(state),
    leave: discarded,
  })
  assert.equal(state.selectedBotId, 'backend')
  unregister()
  assert.equal(registry.find('ops', 'core'), undefined)
})
