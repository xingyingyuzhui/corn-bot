import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  displayedValue,
  rowStatus,
  type SaveAction,
  type SaveState,
  saveReducer,
} from '../src/features/settings/save-state.ts'
import {
  APPEARANCE_OPTIONS,
  chooseOption,
  LANGUAGE_OPTIONS,
} from '../src/features/settings/settings-options.ts'

const run = (...actions: SaveAction<string>[]): SaveState<string> =>
  actions.reduce<SaveState<string>>(saveReducer, { status: 'idle' })

test('a successful save goes saving → saved and shows the target meanwhile', () => {
  const saving = run({ type: 'start', target: 'b' })
  assert.equal(displayedValue(saving, 'a'), 'b')
  assert.deepEqual(rowStatus(saving), { kind: 'pending', text: '正在保存…' })
  const saved = saveReducer(saving, { type: 'succeed' })
  assert.deepEqual(saved, { status: 'saved' })
  assert.equal(displayedValue(saved, 'b'), 'b')
  assert.deepEqual(rowStatus(saved), { kind: 'saved', text: '已保存' })
})

test('a failed save keeps the committed value and remembers what to retry', () => {
  const failed = run(
    { type: 'start', target: 'b' },
    { type: 'fail', message: '网络断开' },
  )
  assert.deepEqual(failed, {
    status: 'error',
    target: 'b',
    message: '网络断开',
  })
  assert.equal(displayedValue(failed, 'a'), 'a')
  assert.deepEqual(rowStatus(failed), {
    kind: 'failure',
    text: '保存失败：网络断开',
  })
  const retry = saveReducer(failed, { type: 'start', target: 'b' })
  assert.equal(retry.status, 'saving')
})

test('a second start while saving is ignored; stray results are ignored', () => {
  const saving = run({ type: 'start', target: 'b' })
  assert.equal(saveReducer(saving, { type: 'start', target: 'c' }), saving)
  const idle: SaveState<string> = { status: 'idle' }
  assert.equal(saveReducer(idle, { type: 'succeed' }), idle)
  assert.equal(saveReducer(idle, { type: 'fail', message: 'x' }), idle)
  assert.equal(saveReducer(saving, { type: 'dismiss' }), saving)
})

test('unavailable wins over save state', () => {
  assert.deepEqual(rowStatus({ status: 'saved' }, '管理员已禁用'), {
    kind: 'unavailable',
    text: '管理员已禁用',
  })
  assert.deepEqual(rowStatus({ status: 'idle' }), { kind: 'value' })
})

test('M1 appearance: only light is selectable, the rest explain why', () => {
  assert.deepEqual(chooseOption(APPEARANCE_OPTIONS, 'light'), {
    kind: 'select',
    value: 'light',
  })
  for (const value of ['system', 'dark'] as const)
    assert.deepEqual(chooseOption(APPEARANCE_OPTIONS, value), {
      kind: 'explain',
      reason: '深色主题在 M1 之后提供',
    })
})

test('M1 language: only Simplified Chinese is selectable', () => {
  const selectable = LANGUAGE_OPTIONS.filter(
    (option) => chooseOption(LANGUAGE_OPTIONS, option.value).kind === 'select',
  )
  assert.deepEqual(
    selectable.map((option) => option.value),
    ['zh-CN'],
  )
})
