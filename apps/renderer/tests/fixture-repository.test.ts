import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FixtureWorkspaceRepository } from '../src/fixtures/fixture-repository.ts'
import { m1FixtureSnapshot } from '../src/fixtures/m1-workspace.ts'
import { parseFixtureRoute } from '../src/fixtures/routes.ts'
import { uiStatesSnapshot } from '../src/fixtures/ui-states.ts'
import { effectiveModel } from '../src/model/models.ts'
import type { FeedItem } from '../src/model/workspace.ts'

const fresh = () => new FixtureWorkspaceRepository()
const items = (repo: FixtureWorkspaceRepository, botId: string) =>
  repo.getSnapshot().conversations[botId]?.items ?? []
const last = (list: readonly FeedItem[]) => list[list.length - 1]

test('a send is queued locally, never marked delivered, and a retry never enqueues twice', async () => {
  const repo = fresh()
  const before = items(repo, 'ops').length
  const input = {
    botId: 'ops',
    clientId: 'c1',
    text: '你好\n\n第二段',
    attachments: [],
  }
  const first = await repo.sendMessage(input)
  const again = await repo.sendMessage(input)
  assert.deepEqual(first, again)
  assert.equal(items(repo, 'ops').length, before + 1)
  const message = last(items(repo, 'ops'))
  assert.equal(message?.kind, 'message')
  if (message?.kind !== 'message') return
  assert.equal(message.delivery, 'queued')
  assert.deepEqual(message.paragraphs, ['你好', '第二段'])
})

test('attachment-only sends are allowed; empty and read-only sends are refused', async () => {
  const repo = fresh()
  const attachment = { id: 'f1', name: 'a.png', size: 10 }
  assert.equal(
    (
      await repo.sendMessage({
        botId: 'ops',
        clientId: 'a',
        text: ' ',
        attachments: [attachment],
      })
    ).ok,
    true,
  )
  const empty = await repo.sendMessage({
    botId: 'ops',
    clientId: 'b',
    text: '  ',
    attachments: [],
  })
  assert.equal(empty.ok === false && empty.error.code, 'validation')

  const snapshot = m1FixtureSnapshot()
  const ops = snapshot.conversations.ops
  assert.ok(ops)
  const readOnly = new FixtureWorkspaceRepository({
    ...snapshot,
    conversations: {
      ...snapshot.conversations,
      ops: { ...ops, readOnly: true },
    },
  })
  const refused = await readOnly.sendMessage({
    botId: 'ops',
    clientId: 'c',
    text: 'hi',
    attachments: [],
  })
  assert.equal(refused.ok === false && refused.error.code, 'read-only')
})

test('queued messages can be cancelled; only failed messages can be resent', async () => {
  const repo = fresh()
  const sent = await repo.sendMessage({
    botId: 'ops',
    clientId: 'x',
    text: 'hi',
    attachments: [],
  })
  assert.ok(sent.ok)
  const resend = await repo.resend('ops', sent.value)
  assert.equal(resend.ok === false && resend.error.code, 'conflict')
  assert.equal((await repo.cancelQueued('ops', sent.value)).ok, true)
  assert.equal(
    items(repo, 'ops').some((item) => item.id === sent.value),
    false,
  )
})

test('approvals settle once; stale requests settle as cancelled', async () => {
  const repo = new FixtureWorkspaceRepository(uiStatesSnapshot())
  const approval = () =>
    items(repo, 'xiaohuang').find((item) => item.kind === 'approval')
  assert.equal(
    (await repo.answerApproval('xiaohuang', 'req-1', 'allowed-once')).ok,
    true,
  )
  assert.equal(
    approval()?.kind === 'approval' && approval()?.status,
    'allowed-once',
  )
  const twice = await repo.answerApproval('xiaohuang', 'req-1', 'rejected')
  assert.equal(twice.ok === false && twice.error.code, 'conflict')

  const stale = new FixtureWorkspaceRepository(uiStatesSnapshot(), {
    staleRequestIds: ['req-1'],
  })
  const result = await stale.answerApproval(
    'xiaohuang',
    'req-1',
    'allowed-once',
  )
  assert.equal(result.ok === false && result.error.code, 'stale')
  const card = items(stale, 'xiaohuang').find(
    (item) => item.kind === 'approval',
  )
  assert.equal(card?.kind === 'approval' && card.status, 'cancelled')
})

test('creating a Bot validates required fields and duplicate names', async () => {
  const repo = fresh()
  const blank = await repo.createBot({
    name: ' ',
    role: 'x',
    workStyle: '',
    groupId: null,
  })
  assert.equal(blank.ok === false && blank.error.field, 'name')
  const duplicate = await repo.createBot({
    name: ' 小黄 ',
    role: 'x',
    workStyle: '',
    groupId: null,
  })
  assert.equal(duplicate.ok === false && duplicate.error.code, 'duplicate')
  const noRole = await repo.createBot({
    name: '新 Bot',
    role: '',
    workStyle: '',
    groupId: null,
  })
  assert.equal(noRole.ok === false && noRole.error.field, 'role')

  const created = await repo.createBot({
    name: '新 Bot',
    role: '测试',
    workStyle: '',
    groupId: 'tech',
  })
  assert.ok(created.ok)
  const { roster, conversations } = repo.getSnapshot()
  assert.equal(roster.bots[created.value]?.origin, 'mock-created')
  assert.ok(
    roster.groups
      .find((group) => group.id === 'tech')
      ?.botIds.includes(created.value),
  )
  assert.ok(conversations[created.value])
})

test('profile, tag and model writes check the revision', async () => {
  const repo = fresh()
  const stale = await repo.updateBotProfile('ops', { role: '新职责' }, 0)
  assert.equal(stale.ok === false && stale.error.code, 'conflict')
  const updated = await repo.updateBotProfile('ops', { role: '新职责' }, 1)
  assert.ok(updated.ok)
  assert.equal(updated.value, 2)

  const tag = await repo.createTag(' 运维 ')
  assert.ok(tag.ok)
  const dupTag = await repo.createTag('运维')
  assert.equal(dupTag.ok === false && dupTag.error.code, 'duplicate')
  const tagged = await repo.setBotTags('ops', [tag.value, tag.value], 2)
  assert.ok(tagged.ok)
  assert.deepEqual(repo.getSnapshot().roster.bots.ops?.tagIds, [tag.value])

  const unavailable = await repo.setBotModel('ops', 'mimo-v2-pro', 3)
  assert.equal(unavailable.ok === false && unavailable.error.field, 'model')
  assert.ok((await repo.setBotModel('ops', 'deepseek-reasoner', 3)).ok)
})

test('effective model is override ?? global and never silently substitutes', () => {
  const { models } = m1FixtureSnapshot()
  assert.deepEqual(
    effectiveModel({ modelOverride: null }, models).status === 'ok' &&
      effectiveModel({ modelOverride: null }, models).source,
    'global',
  )
  const needs = effectiveModel({ modelOverride: 'mimo-v2-pro' }, models)
  assert.equal(needs.status, 'needs_model')
  assert.equal(needs.status === 'needs_model' && needs.requested, 'mimo-v2-pro')
  const none = effectiveModel(
    { modelOverride: null },
    { ...models, globalDefault: null },
  )
  assert.equal(none.status, 'needs_model')
})

test('fixture routes are dev-only', () => {
  assert.equal(parseFixtureRoute('#fixture=ui-states', true), 'ui-states')
  assert.equal(parseFixtureRoute('#fixture=ui-states', false), 'default')
  assert.equal(parseFixtureRoute('#fixture=nope', true), 'default')
})
