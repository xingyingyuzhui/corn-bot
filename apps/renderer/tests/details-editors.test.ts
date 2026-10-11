import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  canSaveChoice,
  MODEL_UNAVAILABLE_REASON,
  modelChoices,
  modelSummary,
  needsModelWarning,
} from '../src/features/bot-editor/model-choice.ts'
import {
  enforcedLevel,
  exceedsCeiling,
  LEVEL_LABELS,
} from '../src/features/bot-editor/permission-levels.ts'
import {
  draftFromBot,
  isProfileField,
  profilePatch,
} from '../src/features/bot-editor/profile-form.ts'
import { m1FixtureSnapshot } from '../src/fixtures/m1-workspace.ts'
import { effectiveModel } from '../src/model/models.ts'
import type { BotView, ModelSettings } from '../src/model/workspace.ts'

const snapshot = m1FixtureSnapshot()
const settings = snapshot.models
const bot = snapshot.roster.bots.xiaohuang as BotView

test('model choices: follow-global first, unavailable catalog entries explain why', () => {
  const choices = modelChoices(settings)
  assert.deepEqual(
    choices.map((choice) => choice.value),
    [null, 'deepseek-chat', 'deepseek-reasoner', 'mimo-v2-pro'],
  )
  assert.equal(choices[0]?.label, '跟随全局默认（DeepSeek Chat）')
  assert.equal(choices[0]?.unavailable, undefined)
  assert.equal(choices[3]?.unavailable, MODEL_UNAVAILABLE_REASON)
})

test('follow-global is unavailable when the global default cannot run', () => {
  const broken: ModelSettings = { ...settings, globalDefault: 'mimo-v2-pro' }
  const [follow] = modelChoices(broken)
  assert.equal(follow?.label, '跟随全局默认（MiMo V2 Pro）')
  assert.ok(follow?.unavailable)
  const unset: ModelSettings = { ...settings, globalDefault: null }
  assert.equal(modelChoices(unset)[0]?.label, '跟随全局默认（未设置）')
})

test('summary distinguishes follow-global from a Bot override', () => {
  assert.equal(modelSummary(bot, settings), 'DeepSeek Chat（跟随全局）')
  assert.equal(
    modelSummary({ modelOverride: 'deepseek-reasoner' }, settings),
    'DeepSeek Reasoner（单独设置）',
  )
  assert.equal(
    modelSummary({ modelOverride: 'mimo-v2-pro' }, settings),
    '需要选择模型（单独设置）',
  )
})

test('needs_model is detected and never resolved to another model', () => {
  assert.equal(needsModelWarning(effectiveModel(bot, settings), settings), null)
  const override = effectiveModel({ modelOverride: 'mimo-v2-pro' }, settings)
  assert.equal(override.status, 'needs_model')
  assert.match(
    needsModelWarning(override, settings) ?? '',
    /单独设置的模型（MiMo V2 Pro）当前不可用.*不会自动换成其他模型/u,
  )
  const unset = effectiveModel(bot, { ...settings, globalDefault: null })
  assert.match(
    needsModelWarning(unset, settings) ?? '',
    /全局默认模型尚未设置/u,
  )
  const unknown = effectiveModel({ modelOverride: 'gone-model' }, settings)
  assert.match(needsModelWarning(unknown, settings) ?? '', /gone-model/u)
})

test('only a changed, runnable choice can be saved', () => {
  const choices = modelChoices(settings)
  assert.ok(!canSaveChoice(choices, null, null))
  assert.ok(canSaveChoice(choices, null, 'deepseek-reasoner'))
  assert.ok(canSaveChoice(choices, 'deepseek-reasoner', null))
  assert.ok(!canSaveChoice(choices, null, 'mimo-v2-pro'))
  assert.ok(!canSaveChoice(choices, null, 'gone-model'))
})

test('profile patch carries only changed, trimmed fields', () => {
  const draft = draftFromBot(bot)
  assert.deepEqual(profilePatch(bot, draft), {})
  assert.deepEqual(profilePatch(bot, { ...draft, role: `  ${bot.role}  ` }), {})
  assert.deepEqual(
    profilePatch(bot, { ...draft, name: ' 小黄二号 ', workStyle: '简洁' }),
    { name: '小黄二号', workStyle: '简洁' },
  )
  assert.ok(isProfileField('role'))
  assert.ok(!isProfileField('groupId'))
  assert.ok(!isProfileField(undefined))
})

test('permission levels never show more than the hard ceiling', () => {
  assert.deepEqual(LEVEL_LABELS, { allow: '允许', ask: '询问', deny: '拒绝' })
  assert.ok(exceedsCeiling('allow', 'ask'))
  assert.ok(!exceedsCeiling('ask', 'ask'))
  assert.ok(!exceedsCeiling('deny', 'allow'))
  const row = {
    capability: 'shell.exec',
    label: '运行终端命令',
    effective: 'allow' as const,
    ceiling: 'ask' as const,
    note: '',
  }
  assert.equal(enforcedLevel(row), 'ask')
  assert.equal(enforcedLevel({ ...row, effective: 'deny' }), 'deny')
})
