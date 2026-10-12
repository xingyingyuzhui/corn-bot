import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type DataLifecycle,
  type RuntimeLifecycle,
  startServices,
  stopServices,
} from '../src/app-lifecycle.ts'

function fakes(dataStatus = 'ready') {
  const calls: string[] = []
  const data: DataLifecycle & { status: string } = {
    status: 'opening',
    async open() {
      calls.push('data.open')
      this.status = dataStatus
      return dataStatus
    },
    async verifyHome() {
      calls.push('data.verifyHome')
      return 'matched'
    },
    async close() {
      calls.push('data.close')
    },
  }
  const runtime: RuntimeLifecycle = {
    async start() {
      calls.push(`runtime.start(data=${data.status})`)
    },
    async shutdown() {
      calls.push('runtime.shutdown')
    },
  }
  return { calls, data, runtime }
}

test('the database opens before the Host starts; the home is paired after the Host claimed it', async () => {
  const { calls, data, runtime } = fakes()
  await startServices(data, runtime, () => false)
  assert.deepEqual(calls, [
    'data.open',
    'runtime.start(data=ready)',
    'data.verifyHome',
  ])
})

test('a data failure still starts the Host', async () => {
  for (const status of ['locked', 'corrupt', 'from_future', 'unavailable']) {
    const { calls, data, runtime } = fakes(status)
    await startServices(data, runtime, () => false)
    assert.deepEqual(
      calls,
      ['data.open', `runtime.start(data=${status})`, 'data.verifyHome'],
      status,
    )
  }
})

test('a quit during startup stops before the next step', async () => {
  const early = fakes()
  await startServices(early.data, early.runtime, () => true)
  assert.deepEqual(early.calls, ['data.open'])

  const late = fakes()
  let quitting = false
  late.runtime.start = async () => {
    late.calls.push('runtime.start')
    quitting = true
  }
  await startServices(late.data, late.runtime, () => quitting)
  assert.deepEqual(late.calls, ['data.open', 'runtime.start'])
})

test('quit stops the Host before the database checkpoints and closes', async () => {
  const { calls, data, runtime } = fakes()
  await stopServices(runtime, data)
  assert.deepEqual(calls, ['runtime.shutdown', 'data.close'])
})

test('the database still closes when the Host stop fails, and the first failure surfaces', async () => {
  const { calls, data, runtime } = fakes()
  const hostFailure = new Error('host stop failed')
  runtime.shutdown = async () => {
    calls.push('runtime.shutdown')
    throw hostFailure
  }
  data.close = async () => {
    calls.push('data.close')
    throw new Error('close failed')
  }
  await assert.rejects(stopServices(runtime, data), (error) => {
    assert.equal(error, hostFailure)
    return true
  })
  assert.deepEqual(calls, ['runtime.shutdown', 'data.close'])
})
