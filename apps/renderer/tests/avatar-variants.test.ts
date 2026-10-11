import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  defaultAvatarVariantFor,
  isCornAvatarVariantId,
} from '@corn-bot/contracts/avatar'
import { errorsFromResult } from '../src/features/bot-editor/create-bot-form.ts'
import {
  draftFromBot,
  isProfileField,
  profilePatch,
} from '../src/features/bot-editor/profile-form.ts'
import { FixtureWorkspaceRepository } from '../src/fixtures/fixture-repository.ts'
import { m1FixtureSnapshot } from '../src/fixtures/m1-workspace.ts'
import type { BotView, WorkspaceSnapshot } from '../src/model/workspace.ts'

const draft = { name: '数据分析师', role: '分析', workStyle: '', groupId: null }

const withLegacyBot = (avatar: BotView['avatar']): WorkspaceSnapshot => {
  const snapshot = m1FixtureSnapshot()
  const base = snapshot.roster.bots.ops as BotView
  return {
    ...snapshot,
    roster: {
      ...snapshot.roster,
      bots: { ...snapshot.roster.bots, ops: { ...base, avatar } },
    },
  }
}

test('every fixture Bot stores its own catalog role, never inferred from its name', () => {
  const { roster } = m1FixtureSnapshot()
  const bots = Object.values(roster.bots)
  assert.equal(bots.length, 13)
  for (const bot of bots) {
    assert.equal(bot.avatar.variantId, bot.id)
    assert.ok(isCornAvatarVariantId(bot.avatar.variantId))
  }
  assert.equal(roster.bots.excel?.avatar.initial, 'E')
  assert.equal('variantId' in roster.account, false)
})

test('a created Bot stores the id-hashed default, never 小黄', async () => {
  const repo = new FixtureWorkspaceRepository()
  const created = await repo.createBot(draft)
  assert.ok(created.ok)
  const variantId =
    repo.getSnapshot().roster.bots[created.value]?.avatar.variantId
  assert.equal(variantId, defaultAvatarVariantFor(created.value))
  assert.notEqual(variantId, 'xiaohuang')
})

test('a chosen role is stored as is; an unknown one is rejected on its field', async () => {
  const repo = new FixtureWorkspaceRepository()
  const chosen = await repo.createBot({ ...draft, variantId: 'xiaohuang' })
  assert.ok(chosen.ok)
  assert.equal(
    repo.getSnapshot().roster.bots[chosen.value]?.avatar.variantId,
    'xiaohuang',
  )
  const unknown = await repo.createBot({
    ...draft,
    name: '另一个',
    variantId: 'grok',
  })
  assert.equal(unknown.ok, false)
  if (unknown.ok) return
  assert.deepEqual(errorsFromResult(unknown.error), {
    variantId: '找不到这个头像',
  })
})

test('renaming keeps the look; changing the role look goes through the repository', async () => {
  const repo = new FixtureWorkspaceRepository()
  const renamed = await repo.updateBotProfile('ops', { name: '小黄' }, 1)
  assert.equal(renamed.ok, false)
  const ok = await repo.updateBotProfile('ops', { name: '环境管家' }, 1)
  assert.ok(ok.ok)
  const ops = repo.getSnapshot().roster.bots.ops
  assert.equal(ops?.avatar.variantId, 'ops')
  assert.equal(ops?.avatar.initial, '环')
  const changed = await repo.updateBotProfile('ops', { variantId: 'ppt' }, 2)
  assert.ok(changed.ok)
  assert.equal(repo.getSnapshot().roster.bots.ops?.avatar.variantId, 'ppt')
  const rejected = await repo.updateBotProfile('ops', { variantId: 'x' }, 3)
  assert.equal(rejected.ok === false && rejected.error.field, 'variantId')
  assert.ok(isProfileField('variantId'))
})

test('legacy records keep the placeholder until the user picks a role', async () => {
  for (const avatar of [
    { initial: '运', hue: 0 },
    { initial: '运', hue: 0, variantId: 'retired-role' },
  ]) {
    const repo = new FixtureWorkspaceRepository(withLegacyBot(avatar))
    const ops = repo.getSnapshot().roster.bots.ops as BotView
    const profile = draftFromBot(ops)
    assert.equal(profile.variantId, null)
    assert.deepEqual(profilePatch(ops, profile), {})
    const saved = await repo.updateBotProfile('ops', { role: '新职责' }, 1)
    assert.ok(saved.ok)
    assert.deepEqual(repo.getSnapshot().roster.bots.ops?.avatar, avatar)
  }
})

test('profile patch carries the role look only when it changed', () => {
  const ops = m1FixtureSnapshot().roster.bots.ops as BotView
  const profile = draftFromBot(ops)
  assert.equal(profile.variantId, 'ops')
  assert.deepEqual(profilePatch(ops, profile), {})
  assert.deepEqual(profilePatch(ops, { ...profile, variantId: 'news' }), {
    variantId: 'news',
  })
})
