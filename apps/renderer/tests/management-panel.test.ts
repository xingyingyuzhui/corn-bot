import assert from 'node:assert/strict'
import { test } from 'node:test'
import { configSummaries } from '../src/features/details/configuration/config-summaries.ts'
import {
  activityLabel,
  botIdentityRows,
} from '../src/features/details/overview/bot-identity.ts'
import { m1FixtureSnapshot } from '../src/fixtures/m1-workspace.ts'
import { fixtureSections } from '../src/fixtures/management-sections.ts'
import { UI_STATES_BOTS } from '../src/fixtures/ui-states.ts'
import type { BotView } from '../src/model/workspace.ts'

const snapshot = m1FixtureSnapshot()
const bot = snapshot.roster.bots.xiaohuang as BotView

test('Corn Bot ID and Claw Agent ID are labelled apart; none is invented', () => {
  for (const origin of ['fixture', 'mock-created', 'live'] as const) {
    const [corn, claw] = botIdentityRows({ id: 'mock-3', origin })
    assert.deepEqual(corn, {
      id: 'corn-bot',
      label: 'Corn Bot ID',
      value: 'mock-3',
      note: null,
    })
    assert.equal(claw?.label, 'Claw Agent ID')
    assert.equal(claw?.value, null, `${origin} has no Claw Agent ID to copy`)
    assert.ok(claw?.note)
  }
  assert.match(
    botIdentityRows({ id: 'x', origin: 'fixture' })[1]?.note ?? '',
    /未绑定/u,
  )
  assert.match(
    botIdentityRows({ id: 'x', origin: 'live' })[1]?.note ?? '',
    /M2/u,
  )
})

test('fixture run state says it is sample data', () => {
  assert.equal(activityLabel(bot), '空闲（示例数据，未运行）')
  assert.equal(activityLabel({ activity: 'working', origin: 'live' }), '工作中')
})

test('every M1 section is reported as not connected, never as empty', () => {
  const sections = fixtureSections('default')
  for (const section of [
    'workspace',
    'routines',
    'identity',
    'skills',
    'artifacts',
    'memory',
  ] as const)
    assert.equal(sections('xiaohuang', section).kind, 'unavailable')
})

test('the dev ui-states route shows loading, error and empty for review', () => {
  const sections = fixtureSections('ui-states')
  assert.equal(sections(UI_STATES_BOTS.loading, 'memory').kind, 'loading')
  assert.equal(sections(UI_STATES_BOTS.error, 'artifacts').kind, 'error')
  assert.equal(sections(UI_STATES_BOTS.readOnly, 'artifacts').kind, 'empty')
  assert.equal(sections(UI_STATES_BOTS.loading, 'skills').kind, 'unavailable')
  assert.equal(sections('xiaohuang', 'memory').kind, 'unavailable')
})

test('configuration summaries never turn an unknown into zero', () => {
  const skills = fixtureSections('default')('xiaohuang', 'skills')
  const summaries = configSummaries(
    bot,
    snapshot.models,
    snapshot.permissions.xiaohuang,
    skills,
  )
  assert.equal(summaries.core, bot.role)
  assert.equal(summaries.model, 'DeepSeek Chat（跟随全局）')
  assert.match(summaries.permissions, /^\d+ 项能力 · 只读$/u)
  assert.equal(summaries.skills, '尚未接通')
  const unknown = configSummaries(bot, snapshot.models, undefined, skills)
  assert.equal(unknown.permissions, '尚未接通')
  const none = configSummaries(bot, snapshot.models, [], skills)
  assert.equal(none.permissions, '没有权限记录 · 只读')
})
