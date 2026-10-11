import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HostRecovery } from '../src/runtime/host-recovery.ts'

const policy = {
  maxAttempts: 3,
  windowMs: 60_000,
  baseDelayMs: 500,
  maxDelayMs: 1_500,
}

test('backs off exponentially, caps the delay and stops after the window budget', () => {
  let now = 0
  const recovery = new HostRecovery(policy, () => now)
  assert.equal(recovery.nextDelay(), 500)
  assert.equal(recovery.nextDelay(), 1_000)
  assert.equal(recovery.nextDelay(), 1_500)
  now = 59_999
  assert.equal(recovery.nextDelay(), null)
})

test('attempts older than the window no longer count against recovery', () => {
  let now = 0
  const recovery = new HostRecovery(policy, () => now)
  for (let index = 0; index < 3; index++) recovery.nextDelay()
  now = 60_000
  assert.equal(recovery.nextDelay(), 500)
})
