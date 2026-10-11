import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  approvalView,
  deliveryLine,
  followDecision,
} from '../src/features/chat/transcript-model.ts'

test('queued can be cancelled; dispatching cannot; failed can resend or cancel', () => {
  assert.deepEqual(deliveryLine('queued', undefined), {
    text: '等待连接 Bot 后发送',
    tone: 'muted',
    actions: ['cancel'],
  })
  assert.deepEqual(deliveryLine('dispatching', undefined).actions, [])
  assert.equal(deliveryLine('dispatching', undefined).text, '正在发送…')
  const failed = deliveryLine('failed', '连接超时')
  assert.equal(failed.text, '连接超时')
  assert.equal(failed.tone, 'error')
  assert.deepEqual(failed.actions, ['resend', 'cancel'])
  assert.equal(deliveryLine('failed', undefined).text, '发送失败')
})

test('accepted is not presented as a Bot reply', () => {
  const accepted = deliveryLine('accepted', undefined)
  assert.equal(accepted.text, '已发送')
  assert.deepEqual(accepted.actions, [])
})

test('approval views use RC2 outcomes; stale settles as expired', () => {
  assert.deepEqual(approvalView('pending'), { kind: 'pending', busy: false })
  assert.deepEqual(approvalView('submitting'), { kind: 'pending', busy: true })
  assert.deepEqual(approvalView('allowed-once'), {
    kind: 'settled',
    text: '已允许一次',
  })
  assert.deepEqual(approvalView('rejected'), {
    kind: 'settled',
    text: '已拒绝',
  })
  assert.deepEqual(approvalView('cancelled'), {
    kind: 'settled',
    text: '请求已失效',
  })
})

test('the feed only moves a reader who is pinned or who just sent', () => {
  assert.equal(
    followDecision({ pinned: false, appended: true, userSent: true }),
    'scroll-to-latest',
  )
  assert.equal(
    followDecision({ pinned: true, appended: true, userSent: false }),
    'scroll-to-latest',
  )
  assert.equal(
    followDecision({ pinned: false, appended: true, userSent: false }),
    'show-latest-button',
  )
  assert.equal(
    followDecision({ pinned: false, appended: false, userSent: false }),
    'stay',
  )
})
