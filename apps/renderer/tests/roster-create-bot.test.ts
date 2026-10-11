import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EMPTY_CREATE_BOT_FORM,
  errorsFromResult,
  validateCreateBot,
} from '../src/features/bot-editor/create-bot-form.ts'
import {
  FixtureWorkspaceRepository,
  NAME_MAX,
} from '../src/fixtures/fixture-repository.ts'

test('required fields are checked before the repository is called', () => {
  assert.deepEqual(validateCreateBot(EMPTY_CREATE_BOT_FORM, NAME_MAX), {
    name: '请填写名称',
    role: '请填写职责',
  })
  const tooLong = {
    ...EMPTY_CREATE_BOT_FORM,
    name: '名'.repeat(NAME_MAX + 1),
    role: '写稿',
  }
  assert.equal(
    validateCreateBot(tooLong, NAME_MAX)?.name,
    `名称最多 ${NAME_MAX} 个字`,
  )
  const exact = { ...tooLong, name: '名'.repeat(NAME_MAX) }
  assert.equal(validateCreateBot(exact, NAME_MAX), null)
})

test('repository errors land on their field, others on the form', async () => {
  const repository = new FixtureWorkspaceRepository()
  const duplicate = await repository.createBot({
    name: '小黄',
    role: '重复',
    workStyle: '',
    groupId: null,
  })
  assert.equal(duplicate.ok, false)
  if (duplicate.ok) return
  assert.deepEqual(errorsFromResult(duplicate.error), {
    name: '已经有同名的 Bot',
  })
  const group = await repository.createBot({
    name: '新 Bot',
    role: '测试',
    workStyle: '',
    groupId: 'missing',
  })
  assert.equal(group.ok, false)
  if (group.ok) return
  assert.deepEqual(errorsFromResult(group.error), { groupId: '找不到这个分组' })
  assert.deepEqual(
    errorsFromResult({ code: 'unavailable', message: '暂不可用' }),
    {
      form: '暂不可用',
    },
  )
})

test('a created Bot is a labelled mock and joins the visible roster', async () => {
  const repository = new FixtureWorkspaceRepository()
  const created = await repository.createBot({
    name: '数据分析师',
    role: '整理数据',
    workStyle: '',
    groupId: 'tech',
  })
  assert.equal(created.ok, true)
  if (!created.ok) return
  const bot = repository.getSnapshot().roster.bots[created.value]
  assert.equal(bot?.origin, 'mock-created')
})
