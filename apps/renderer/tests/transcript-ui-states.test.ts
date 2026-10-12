import assert from 'node:assert/strict'
import { test } from 'node:test'
import { m1FixtureSnapshot } from '../src/fixtures/m1-workspace.ts'
import {
  createUiStatesRepository,
  UI_STATES_BOTS,
  UI_STATES_STALE_HANDLE,
  uiStatesSnapshot,
} from '../src/fixtures/ui-states.ts'
import type { FeedItem } from '../src/model/workspace.ts'

const home = () => uiStatesSnapshot().conversations.xiaohuang?.items ?? []
const messages = (items: readonly FeedItem[]) =>
  items.flatMap((item) => (item.kind === 'message' ? [item] : []))

test('ui-states covers queued, dispatching and failed sends with a reason', () => {
  const sent = messages(home()).filter((item) => item.delivery)
  assert.deepEqual(
    sent.map((item) => item.delivery),
    ['queued', 'dispatching', 'failed'],
  )
  const failed = sent.find((item) => item.delivery === 'failed')
  assert.ok(failed?.failure)
  assert.ok(sent.some((item) => (item.attachments?.length ?? 0) > 0))
})

test('ui-states has two pending approvals, one of them stale', async () => {
  const approvals = home().flatMap((item) =>
    item.kind === 'approval' ? [item] : [],
  )
  assert.equal(approvals.length, 2)
  assert.ok(approvals.every((item) => item.status === 'pending'))
  assert.ok(approvals.some((item) => item.handle === UI_STATES_STALE_HANDLE))

  const repo = createUiStatesRepository({ latencyMs: 0 })
  const stale = await repo.answerApproval(
    'xiaohuang',
    UI_STATES_STALE_HANDLE,
    'allowed-once',
  )
  assert.equal(stale.ok === false && stale.error.code, 'stale')
  const fresh = await repo.answerApproval('xiaohuang', 'req-1', 'rejected')
  assert.equal(fresh.ok, true)
})

test('ui-states has an info and an error notice', () => {
  const tones = home().flatMap((item) =>
    item.kind === 'notice' ? [item.tone] : [],
  )
  assert.deepEqual([...tones].sort(), ['error', 'info'])
})

test('ui-states has read-only, loading and error conversations', () => {
  const { conversations } = uiStatesSnapshot()
  const readOnly = conversations[UI_STATES_BOTS.readOnly]
  assert.equal(readOnly?.readOnly, true)
  assert.ok((readOnly?.items.length ?? 0) > 0)
  assert.equal(conversations[UI_STATES_BOTS.loading]?.state, 'loading')
  assert.equal(conversations[UI_STATES_BOTS.error]?.state, 'error')
})

test('the default fixture keeps the reference view: no state items', () => {
  const { conversations } = m1FixtureSnapshot()
  for (const conversation of Object.values(conversations)) {
    assert.equal(conversation.state, 'ready')
    assert.equal(conversation.readOnly, false)
    assert.ok(
      conversation.items.every(
        (item) =>
          item.kind !== 'approval' &&
          item.kind !== 'notice' &&
          (item.kind !== 'message' || item.delivery === undefined),
      ),
    )
  }
})
