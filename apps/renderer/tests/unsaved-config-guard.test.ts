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
import {
  BotEditorController,
  type DraftSaveResult,
} from '../src/features/bot-editor/bot-editor-controller.ts'
import {
  MODEL_EDITOR,
  PROFILE_EDITOR,
} from '../src/features/bot-editor/editor-specs.ts'
import type { ProfileDraft } from '../src/features/bot-editor/profile-form.ts'
import {
  type ConfigDraftHandle,
  ConfigDraftRegistry,
  configDraftHandle,
  leavesAfter,
  settlementNotice,
  settleUnsaved,
  type UnsavedChoice,
} from '../src/features/details/configuration/config-drafts.ts'
import type { ConfigSubpage } from '../src/features/details/details-navigation.ts'
import { FixtureWorkspaceRepository } from '../src/fixtures/fixture-repository.ts'
import { botOf, GatedRepository, tick } from './helpers/gated-repository.ts'

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
  const handle = (result: DraftSaveResult): ConfigDraftHandle => ({
    botId: 'a',
    page: 'core',
    save: async () => {
      calls.push('save')
      return result
    },
    discard: async () => {
      calls.push('discard')
    },
  })
  const leaves = async (choice: UnsavedChoice, result: DraftSaveResult) =>
    leavesAfter(await settleUnsaved(choice, handle(result)))
  assert.equal(await leaves('save', 'saved'), true)
  assert.equal(await leaves('save', 'unchanged'), true)
  assert.equal(await leaves('save', 'failed'), false)
  assert.equal(await leaves('discard', 'saved'), true)
  assert.equal(await leaves('cancel', 'saved'), false)
  assert.deepEqual(calls, ['save', 'save', 'save', 'discard'])
})

test('end to end: a failed save keeps the draft and does not switch Bot', async () => {
  const repository = new FixtureWorkspaceRepository()
  const registry = new ConfigDraftRegistry()
  const bot = repository.getSnapshot().roster.bots.ops
  if (!bot) throw new Error('fixture Bot missing')
  const editor = new BotEditorController(repository, PROFILE_EDITOR, bot)
  const unregister = registry.register(configDraftHandle('core', editor))
  editor.edit((draft) => ({ ...draft, name: '' }), 'name')

  let state = run(
    initialLayout('ops'),
    { type: 'open-details-entry', botId: 'ops', entry: 'core' },
    { type: 'config-draft', botId: 'ops', page: 'core', dirty: true },
    { type: 'select-bot', botId: 'backend' },
  )
  const prompt = promptOf(state)
  const saved = await settleUnsaved(
    'save',
    registry.find(prompt.botId, prompt.page),
  )
  state = run(state, {
    type: 'resolve-unsaved-config',
    overlay: prompt,
    leave: leavesAfter(saved),
  })
  assert.equal(saved, 'failed')
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
    leave: leavesAfter(discarded),
  })
  assert.equal(state.selectedBotId, 'backend')
  unregister()
  assert.equal(registry.find('ops', 'core'), undefined)
})

test('a missing editor for a dirty page stays; only discard leaves', async () => {
  const missing = await settleUnsaved('save', undefined)
  assert.equal(missing, 'missing')
  assert.equal(leavesAfter(missing), false)
  assert.ok(settlementNotice(missing, '核心设置'))
  assert.equal(leavesAfter(await settleUnsaved('discard', undefined)), true)
})

/** Every way out of Bot `ops`'s subpage the prompt holds. */
const LEAVING: readonly LayoutAction[] = [
  { type: 'select-bot', botId: 'backend' },
  { type: 'open-details-entry', botId: 'ops', entry: 'overview' },
  {
    type: 'navigate-details',
    botId: 'ops',
    location: { tab: 'configuration', page: 'home', section: 'artifacts' },
    focus: { kind: 'config-entry', page: 'core' },
  },
  { type: 'close-details' },
]

/** `ops` on `page` with the draft reported dirty, as the pane would hold it. */
const onSubpage = (page: ConfigSubpage) =>
  run(
    initialLayout('ops'),
    { type: 'open-details-entry', botId: 'ops', entry: page },
    { type: 'config-draft', botId: 'ops', page, dirty: true },
  )

/** Where the layout ends up when `action` runs with nothing held. */
const placeAfter = (start: LayoutState, action: LayoutAction) => {
  const state = run({ ...start, unsavedConfig: null }, action)
  return {
    selectedBotId: state.selectedBotId,
    detailsOpen: state.detailsOpen,
    location: detailsLocationFor(state, 'ops'),
  }
}

const placeOf = (state: LayoutState) => ({
  selectedBotId: state.selectedBotId,
  detailsOpen: state.detailsOpen,
  location: detailsLocationFor(state, 'ops'),
})

/** Answers the prompt the way the dialog does, releasing held writes first. */
async function answer(
  state: LayoutState,
  registry: ConfigDraftRegistry,
  repository: GatedRepository,
  choice: UnsavedChoice,
) {
  const prompt = promptOf(state)
  const settling = settleUnsaved(
    choice,
    registry.find(prompt.botId, prompt.page),
  )
  while (repository.waiting > 0) {
    repository.release()
    await tick()
  }
  const settlement = await settling
  return {
    settlement,
    state: run(state, {
      type: 'resolve-unsaved-config',
      overlay: prompt,
      leave: leavesAfter(settlement),
    }),
  }
}

test('an earlier write landing under newer core edits never leaves', async () => {
  for (const action of LEAVING) {
    const repository = new GatedRepository()
    const registry = new ConfigDraftRegistry()
    const editor = new BotEditorController(
      repository,
      PROFILE_EDITOR,
      botOf(repository, 'ops'),
    )
    registry.register(configDraftHandle('core', editor))
    const start = onSubpage('core')

    editor.edit((draft: ProfileDraft) => ({ ...draft, role: '第一版职责' }))
    const subpageSave = editor.saveDraft()
    editor.edit((draft: ProfileDraft) => ({
      ...draft,
      workStyle: '保存中输入的第二版',
    }))
    const held = run(start, action)
    const first = await answer(held, registry, repository, 'save')
    const label = JSON.stringify(action)
    assert.equal(first.settlement, 'unsaved', label)
    assert.equal(await subpageSave, 'unsaved', label)
    assert.equal(first.state.overlay, null, label)
    assert.deepEqual(placeOf(first.state), placeOf(start), label)
    assert.deepEqual(
      first.state.unsavedConfig,
      { botId: 'ops', page: 'core' },
      `${label}: the guard stays`,
    )
    assert.ok(editor.dirty, label)
    assert.equal(botOf(repository, 'ops').workStyle, '', label)

    const second = await answer(
      run(first.state, action),
      registry,
      repository,
      'save',
    )
    assert.equal(second.settlement, 'saved', label)
    assert.deepEqual(placeOf(second.state), placeAfter(start, action), label)
    assert.equal(second.state.unsavedConfig, null, label)
    const stored = botOf(repository, 'ops')
    assert.equal(stored.role, '第一版职责', label)
    assert.equal(stored.workStyle, '保存中输入的第二版', label)
    assert.deepEqual(repository.writes, ['ops', 'ops'], label)
  }
})

test('an earlier write landing under a newer model choice never leaves', async () => {
  const repository = new GatedRepository()
  const registry = new ConfigDraftRegistry()
  const editor = new BotEditorController(
    repository,
    MODEL_EDITOR,
    botOf(repository, 'ops'),
  )
  registry.register(configDraftHandle('model', editor))
  const start = onSubpage('model')
  editor.edit(() => 'deepseek-reasoner')
  const subpageSave = editor.saveDraft()
  editor.edit(() => 'deepseek-chat')
  const action: LayoutAction = { type: 'select-bot', botId: 'backend' }

  const first = await answer(run(start, action), registry, repository, 'save')
  assert.equal(first.settlement, 'unsaved')
  assert.equal(await subpageSave, 'unsaved')
  assert.equal(first.state.selectedBotId, 'ops')
  assert.equal(botOf(repository, 'ops').modelOverride, 'deepseek-reasoner')

  const second = await answer(
    run(first.state, action),
    registry,
    repository,
    'save',
  )
  assert.equal(second.settlement, 'saved')
  assert.equal(second.state.selectedBotId, 'backend')
  assert.equal(botOf(repository, 'ops').modelOverride, 'deepseek-chat')
})

test('discard waits for a write in flight, then drops the rest and leaves once', async () => {
  const repository = new GatedRepository()
  const registry = new ConfigDraftRegistry()
  const editor = new BotEditorController(
    repository,
    PROFILE_EDITOR,
    botOf(repository, 'ops'),
  )
  registry.register(configDraftHandle('core', editor))
  editor.edit((draft: ProfileDraft) => ({ ...draft, role: '已经发出的职责' }))
  const subpageSave = editor.saveDraft()
  editor.edit((draft: ProfileDraft) => ({ ...draft, workStyle: '未发出' }))
  const held = run(onSubpage('core'), { type: 'select-bot', botId: 'backend' })
  const prompt = promptOf(held)

  let settled = false
  const settling = settleUnsaved(
    'discard',
    registry.find(prompt.botId, prompt.page),
  ).then((settlement) => {
    settled = true
    return settlement
  })
  await tick()
  assert.equal(settled, false, 'discard waits for the write already sent')
  assert.ok(editor.getState().saving, 'saving is never cleared early')
  repository.release()
  const settlement = await settling
  assert.equal(settlement, 'discarded')
  assert.equal(await subpageSave, 'unsaved')
  const stored = botOf(repository, 'ops')
  assert.equal(stored.role, '已经发出的职责', 'a sent write is not undone')
  assert.equal(stored.workStyle, '')
  assert.equal(editor.dirty, false)
  assert.equal(editor.getState().draft.workStyle, '')

  const left = run(held, {
    type: 'resolve-unsaved-config',
    overlay: prompt,
    leave: leavesAfter(settlement),
  })
  assert.equal(left.selectedBotId, 'backend')
  assert.equal(
    run(left, { type: 'resolve-unsaved-config', overlay: prompt, leave: true }),
    left,
    'the held action runs once',
  )
})

test("Bot A's write settling never answers Bot B's prompt", async () => {
  const repository = new GatedRepository()
  const registry = new ConfigDraftRegistry()
  const a = new BotEditorController(
    repository,
    PROFILE_EDITOR,
    botOf(repository, 'ops'),
  )
  const b = new BotEditorController(
    repository,
    PROFILE_EDITOR,
    botOf(repository, 'backend'),
  )
  registry.register(configDraftHandle('core', a))
  registry.register(configDraftHandle('core', b))
  a.edit((draft: ProfileDraft) => ({ ...draft, role: 'A 的职责' }))
  const aSave = a.saveDraft()
  a.detach()
  b.edit((draft: ProfileDraft) => ({ ...draft, role: 'B 的职责' }))

  let bSettled = false
  const bSettling = settleUnsaved(
    'save',
    registry.find('backend', 'core'),
  ).then((settlement) => {
    bSettled = true
    return settlement
  })
  repository.release()
  assert.equal(await aSave, 'failed', 'a detached A confirms nothing')
  await tick()
  assert.equal(bSettled, false, "A's result does not settle B")
  assert.ok(b.getState().saving)
  repository.release()
  assert.equal(await bSettling, 'saved')
  assert.equal(botOf(repository, 'backend').role, 'B 的职责')
})
