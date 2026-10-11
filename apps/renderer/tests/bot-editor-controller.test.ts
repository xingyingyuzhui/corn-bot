import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BotEditorController } from '../src/features/bot-editor/bot-editor-controller.ts'
import {
  MODEL_EDITOR,
  MODEL_UNAVAILABLE_ERROR,
  PROFILE_EDITOR,
} from '../src/features/bot-editor/editor-specs.ts'
import type { ProfileDraft } from '../src/features/bot-editor/profile-form.ts'
import { FixtureWorkspaceRepository } from '../src/fixtures/fixture-repository.ts'
import type { BotView } from '../src/model/workspace.ts'
import { botOf, GatedRepository, tick } from './helpers/gated-repository.ts'

const profileEditor = (repository: FixtureWorkspaceRepository, id: string) =>
  new BotEditorController(repository, PROFILE_EDITOR, botOf(repository, id))

const setRole = (role: string) => (draft: ProfileDraft) => ({ ...draft, role })
const setWorkStyle = (workStyle: string) => (draft: ProfileDraft) => ({
  ...draft,
  workStyle,
})

test('a save rebases the draft on the stored Bot', async () => {
  const repository = new FixtureWorkspaceRepository()
  const editor = profileEditor(repository, 'ops')
  assert.equal(editor.dirty, false)
  assert.equal(await editor.save(), 'unchanged')
  editor.edit(setRole('  维护运行环境和工具链  '))
  assert.equal(editor.dirty, false, 'trimmed value equals the stored one')
  editor.edit(setRole('维护运行环境与发布'), 'role')
  assert.ok(editor.dirty)
  assert.equal(await editor.save(), 'saved')
  const stored = botOf(repository, 'ops')
  assert.equal(stored.role, '维护运行环境与发布')
  assert.equal(editor.getState().base.revision, stored.revision)
  assert.equal(editor.dirty, false)
})

test('a failed save keeps the draft and shows the field error', async () => {
  const repository = new FixtureWorkspaceRepository()
  const editor = profileEditor(repository, 'ops')
  editor.edit((draft) => ({ ...draft, name: '小黄' }), 'name')
  assert.equal(await editor.save(), 'failed')
  const state = editor.getState()
  assert.equal(state.draft.name, '小黄')
  assert.equal(state.fieldErrors.name, '已经有同名的 Bot')
  assert.equal(state.saving, false)
  assert.ok(editor.dirty)
  editor.edit((draft) => ({ ...draft, name: '小黄二号' }), 'name')
  assert.equal(editor.getState().fieldErrors.name, undefined)
})

test('a revision change elsewhere surfaces as a conflict, never an overwrite', async () => {
  const repository = new FixtureWorkspaceRepository()
  const dialog = profileEditor(repository, 'ops')
  const subpage = profileEditor(repository, 'ops')
  dialog.edit(setRole('来自对话框'))
  subpage.edit(setRole('来自子页'))
  assert.equal(await dialog.save(), 'saved')
  assert.equal(await subpage.save(), 'failed')
  assert.ok(subpage.getState().conflict)
  assert.equal(botOf(repository, 'ops').role, '来自对话框')
  subpage.reload()
  assert.equal(subpage.getState().conflict, false)
  assert.equal(subpage.getState().draft.role, '来自对话框')
})

test('outside changes are followed only while there is no draft', async () => {
  const repository = new FixtureWorkspaceRepository()
  const clean = profileEditor(repository, 'ops')
  const edited = profileEditor(repository, 'ops')
  edited.edit(setRole('我的草稿'))
  await repository.updateBotProfile('ops', { role: '外部修改' }, 1)
  const stored = botOf(repository, 'ops')
  clean.sync(stored)
  edited.sync(stored)
  assert.equal(clean.getState().draft.role, '外部修改')
  assert.equal(edited.getState().draft.role, '我的草稿')
  assert.equal(edited.getState().base.revision, 1)
})

test('repeated saves while one is in flight share a single write', async () => {
  const repository = new GatedRepository()
  const editor = profileEditor(repository, 'ops')
  editor.edit(setRole('新的职责'))
  const first = editor.save()
  const second = editor.save()
  assert.equal(first, second)
  assert.ok(editor.getState().saving)
  repository.release()
  assert.equal(await first, 'saved')
  assert.deepEqual(repository.writes, ['ops'])
})

test('a late result for Bot A never touches Bot B or a detached editor', async () => {
  const repository = new GatedRepository()
  const a = profileEditor(repository, 'ops')
  a.edit(setRole('A 的职责'))
  const pending = a.save()
  a.detach()
  const b = profileEditor(repository, 'backend')
  b.edit(setRole('B 的草稿'))
  let aNotified = 0
  let bNotified = 0
  a.subscribe(() => aNotified++)
  b.subscribe(() => bNotified++)
  const aBefore = a.getState()
  const bBefore = b.getState()
  repository.release()
  assert.equal(await pending, 'saved')
  await tick()
  assert.equal(botOf(repository, 'ops').role, 'A 的职责', 'the write landed')
  assert.equal(a.getState(), aBefore)
  assert.equal(a.attached, false)
  assert.equal(aNotified, 0)
  assert.equal(b.getState(), bBefore)
  assert.equal(bNotified, 0)
  assert.equal(b.getState().draft.role, 'B 的草稿')
  assert.equal(botOf(repository, 'backend').role, '后端接口与数据处理')
})

test('edits typed while a save was in flight are kept on top of it', async () => {
  const repository = new GatedRepository()
  const editor = profileEditor(repository, 'ops')
  editor.edit(setRole('第一版'))
  const pending = editor.save()
  editor.edit((draft) => ({ ...draft, workStyle: '先列计划' }))
  repository.release()
  assert.equal(await pending, 'saved')
  const { draft, base } = editor.getState()
  assert.equal(base.role, '第一版')
  assert.equal(draft.workStyle, '先列计划')
  assert.ok(editor.dirty)
})

test('an earlier write landing under newer edits is not a saved draft', async () => {
  const repository = new GatedRepository()
  const editor = profileEditor(repository, 'ops')
  const storedWorkStyle = botOf(repository, 'ops').workStyle
  editor.edit(setRole('第一版'))
  const subpage = editor.saveDraft()
  editor.edit(setWorkStyle('保存中输入的第二版'))
  const dialog = editor.saveDraft()
  repository.release()
  assert.equal(await subpage, 'unsaved', 'the subpage never says saved')
  assert.equal(await dialog, 'unsaved', 'the dialog stays open')
  assert.ok(editor.dirty)
  assert.equal(editor.getState().draft.workStyle, '保存中输入的第二版')
  assert.equal(botOf(repository, 'ops').workStyle, storedWorkStyle)
  await tick()
  assert.equal(repository.waiting, 0, 'no second write on its own')

  const next = editor.saveDraft()
  repository.release()
  assert.equal(await next, 'saved')
  const stored = botOf(repository, 'ops')
  assert.equal(stored.role, '第一版')
  assert.equal(stored.workStyle, '保存中输入的第二版')
  assert.equal(editor.dirty, false)
  assert.deepEqual(repository.writes, ['ops', 'ops'])
})

test('a detached editor never confirms a save', async () => {
  const repository = new GatedRepository()
  const a = profileEditor(repository, 'ops')
  a.edit(setRole('A 的职责'))
  const pending = a.saveDraft()
  a.detach()
  repository.release()
  assert.equal(await pending, 'failed')
  assert.equal(botOf(repository, 'ops').role, 'A 的职责', 'the write landed')
})

test('saving locks the editor until the write settles; failures keep the draft', async () => {
  const repository = new GatedRepository()
  const editor = profileEditor(repository, 'ops')
  editor.edit((draft) => ({ ...draft, name: '小黄' }), 'name')
  const duplicate = editor.saveDraft()
  assert.ok(editor.getState().saving)
  repository.release()
  assert.equal(await duplicate, 'failed')
  assert.equal(editor.getState().saving, false)
  assert.equal(editor.getState().draft.name, '小黄')

  const { name } = botOf(repository, 'ops')
  editor.edit((draft) => ({ ...draft, name }), 'name')
  editor.edit(setRole('冲突前的草稿'))
  const outside = repository.updateBotProfile('ops', { role: '外部修改' }, 1)
  const conflicted = editor.saveDraft()
  assert.ok(editor.getState().saving)
  repository.release()
  repository.release()
  await outside
  assert.equal(await conflicted, 'failed')
  const state = editor.getState()
  assert.equal(state.saving, false)
  assert.ok(state.conflict)
  assert.equal(state.draft.role, '冲突前的草稿')
  assert.equal(botOf(repository, 'ops').role, '外部修改')
})

test('a write in flight survives reload; discard waits and reads it back', async () => {
  const repository = new GatedRepository()
  const editor = profileEditor(repository, 'ops')
  const storedWorkStyle = botOf(repository, 'ops').workStyle
  editor.edit(setRole('已经发出的职责'))
  const pending = editor.save()
  editor.edit(setWorkStyle('还没发出的修改'))
  editor.reload()
  assert.ok(editor.getState().saving, 'reload cannot clear saving')

  let discarded = false
  const discard = editor.discard().then(() => {
    discarded = true
  })
  await tick()
  assert.equal(discarded, false, 'discard waits for the write')
  assert.ok(editor.getState().saving)
  repository.release()
  await discard
  assert.equal(await pending, 'saved')
  const stored = botOf(repository, 'ops')
  assert.equal(stored.role, '已经发出的职责', 'a sent write is not undone')
  const state = editor.getState()
  assert.equal(state.saving, false)
  assert.equal(state.draft.role, stored.role)
  assert.equal(state.draft.workStyle, storedWorkStyle)
  assert.equal(state.base.revision, stored.revision)
  assert.equal(editor.dirty, false)
})

test('the model editor refuses an unavailable model before writing', async () => {
  const repository = new FixtureWorkspaceRepository()
  const bot: BotView = botOf(repository, 'ops')
  const editor = new BotEditorController(repository, MODEL_EDITOR, bot)
  editor.edit(() => 'mimo-v2-pro')
  assert.equal(await editor.save(), 'failed')
  assert.equal(editor.getState().formError, MODEL_UNAVAILABLE_ERROR)
  assert.equal(botOf(repository, 'ops').revision, bot.revision)
  editor.edit(() => 'deepseek-reasoner')
  assert.equal(await editor.save(), 'saved')
  assert.equal(botOf(repository, 'ops').modelOverride, 'deepseek-reasoner')
  assert.equal(editor.dirty, false)
})
