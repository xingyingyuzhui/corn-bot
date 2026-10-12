import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import type { ConversationView } from '../../../packages/contracts/src/workspace.ts'
import { ChatFollower } from '../src/workspace/chat-follow.ts'
import type { ChatRuntime } from '../src/workspace/chat-runtime.ts'

const TARGET = { botId: 'bot_1', sessionId: 'corn-1', conversationId: 'conv_1' }

function follower(options: { runtime: () => ChatRuntime | undefined }) {
  const delays: number[] = []
  const pending: (() => void)[] = []
  const views: ConversationView[] = []
  const chat = new ChatFollower({
    approvals: { observe: () => {}, cards: () => [] },
    ledger: { observe: () => false, views: () => [] },
    runtime: options.runtime,
    onEvents: () => {},
    onView: (view) => views.push(view),
    schedule: (fn, ms) => {
      delays.push(ms)
      pending.push(fn)
      return () => {}
    },
    timing: { reopenBaseMs: 100, reopenMaxMs: 300, reopenFailureLimit: 3 },
  })
  return { chat, delays, pending, views }
}

/** A Host whose follow opens always fail. */
function failingRuntime(opens: { count: number }): ChatRuntime {
  return {
    openFollow: () => {
      opens.count += 1
      throw new Error('socket closed')
    },
  } as unknown as ChatRuntime
}

test('ChatFollower: failed opens back off exponentially to a cap, then park as error until resumed', async () => {
  const opens = { count: 0 }
  const runtime = failingRuntime(opens)
  const { chat, delays, pending, views } = follower({ runtime: () => runtime })

  chat.follow(TARGET, true)
  for (let tries = 0; tries < 3; tries += 1) {
    await setImmediate()
    pending.shift()?.()
  }
  await setImmediate()

  assert.deepEqual(delays, [100, 200, 300])
  assert.equal(opens.count, 4)
  assert.equal(views.at(-1)?.state, 'error')
  assert.equal(pending.length, 0, 'past the limit the reopen is parked')

  chat.resume()
  await setImmediate()
  assert.equal(opens.count, 5, 'resume runs the parked reopen')
  assert.deepEqual(delays, [100, 200, 300, 100], 'and restarts the backoff')
})

test('ChatFollower: without a Host the reopen waits for resume; unfollow drops it', async () => {
  const opens = { count: 0 }
  const live = failingRuntime(opens)
  let runtime: ChatRuntime | undefined = live
  const { chat, delays } = follower({ runtime: () => runtime })

  chat.follow(TARGET, true)
  runtime = undefined
  await setImmediate()
  assert.deepEqual(delays, [], 'no timer while the Host is down')

  chat.unfollow()
  runtime = live
  chat.resume()
  await setImmediate()
  assert.equal(opens.count, 1)
  assert.equal(chat.current, undefined)
})
