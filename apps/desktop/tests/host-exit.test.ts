import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  type FakeChild,
  type HarnessOptions,
  RuntimeHarness,
  within,
} from './helpers/runtime-harness.ts'

// PMR-02: a Host whose process exited while a descendant still holds its
// stdio pipes (`exit` without `close`) is gone; readiness must not outlive it.

const TIMEOUT = { timeout: 10_000 }
const BOUNDS = { graceMs: 50, killMs: 100 }

async function withHarness(
  options: HarnessOptions,
  run: (harness: RuntimeHarness) => Promise<void>,
): Promise<void> {
  const harness = await RuntimeHarness.create({
    stopTimeouts: BOUNDS,
    ...options,
  })
  try {
    await run(harness)
  } finally {
    for (const child of harness.children) child.exit(0)
    await harness.dispose()
  }
}

function lockHeld(harness: RuntimeHarness): boolean {
  return existsSync(join(harness.home, 'corn-host.lock'))
}

/** Late pipe close from the exited child: must not notify or schedule again. */
async function closeLate(harness: RuntimeHarness, child: FakeChild) {
  const schedules = harness.schedules.length
  const status = harness.control.view.status
  child.emit('close', child.exitCode, child.signalCode)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(harness.schedules.length, schedules, 'close re-notified')
  assert.equal(harness.control.view.status, status)
}

async function reachClawCheck(
  harness: RuntimeHarness,
  started: Promise<void>,
): Promise<void> {
  const reached = await within(
    Promise.race([
      harness.host.registryArrived().then(() => true),
      started.then(() => false),
    ]),
    'Claw check',
  )
  assert.equal(reached, true, 'formal start must check Claw after auth')
}

for (const stage of ['readiness', 'authentication', 'Claw check'] as const) {
  test(
    `exit without close during ${stage} fails the start at once with one recovery`,
    TIMEOUT,
    async () => {
      await withHarness(
        {
          autoReady: stage !== 'readiness',
          gateExchange: stage === 'authentication',
        },
        async (harness) => {
          harness.host.gateRegistry = stage === 'Claw check'
          const started = harness.control.start()
          const child = await harness.nextChild()
          let signal: AbortSignal | undefined
          if (stage === 'authentication')
            signal = (await harness.nextExchange()).signal
          if (stage === 'Claw check') await reachClawCheck(harness, started)
          child.exitOnly(null, 'SIGKILL')
          if (signal) assert.equal(signal.aborted, true, 'auth not cancelled')
          await within(started, 'start')
          harness.exchanges.at(-1)?.gate.resolve()
          harness.host.openRegistry()
          assert.equal(harness.control.view.status, 'recovering')
          assert.equal(harness.schedules.length, 1)
          assert.equal(harness.control.auth, undefined)
          assert.equal(harness.runtime.host.running, false)
          assert.equal(lockHeld(harness), false)
          await closeLate(harness, child)
        },
      )
    },
  )
}

test(
  'exit without close after ready revokes readiness and auth and schedules one recovery',
  TIMEOUT,
  async () => {
    await withHarness({}, async (harness) => {
      await harness.control.start()
      assert.equal(harness.control.view.status, 'ready')
      const first = harness.children[0]
      assert.ok(first)
      first.exitOnly(null, 'SIGKILL')
      assert.equal(harness.control.view.status, 'recovering')
      assert.equal(harness.control.auth, undefined)
      assert.equal(harness.runtime.host.running, false)
      assert.equal(harness.schedules.length, 1)
      await closeLate(harness, first)
      harness.runRecovery()
      const second = await harness.nextChild()
      assert.notEqual(second, first)
      await within(
        (async () => {
          while (harness.control.view.status !== 'ready')
            await new Promise((resolve) => setImmediate(resolve))
        })(),
        'recovered ready',
      )
      assert.equal(harness.schedules.length, 1)
      first.emit('close', null, 'SIGKILL')
      assert.equal(harness.control.view.status, 'ready')
      assert.equal(harness.schedules.length, 1)
    })
  },
)

test('exit then close after ready notifies once', TIMEOUT, async () => {
  await withHarness({}, async (harness) => {
    await harness.control.start()
    const child = harness.children[0]
    assert.ok(child)
    child.exit(1)
    assert.equal(harness.control.view.status, 'recovering')
    assert.equal(harness.schedules.length, 1)
    child.emit('close', 1, null)
    assert.equal(harness.schedules.length, 1)
  })
})

test(
  'a stop racing a late auth success wins after an exit without close',
  TIMEOUT,
  async () => {
    await withHarness({ gateExchange: true }, async (harness) => {
      const started = harness.control.start()
      const child = await harness.nextChild()
      const exchange = await harness.nextExchange()
      child.exitOnly(null, 'SIGKILL')
      const quit = harness.control.shutdown()
      exchange.gate.resolve()
      await within(quit, 'quit')
      await within(started, 'start')
      assert.equal(harness.control.view.status, 'stopped')
      assert.equal(harness.control.auth, undefined)
      assert.equal(harness.schedules.length, 0)
      assert.equal(lockHeld(harness), false)
      await closeLate(harness, child)
    })
  },
)

test(
  'a stop racing a late Claw check success wins without an exit',
  TIMEOUT,
  async () => {
    await withHarness({}, async (harness) => {
      harness.host.gateRegistry = true
      const started = harness.control.start()
      await harness.nextChild()
      await reachClawCheck(harness, started)
      const stop = harness.runtime.host.stop()
      harness.host.openRegistry()
      await within(stop, 'stop')
      await within(started, 'start')
      assert.notEqual(harness.control.view.status, 'ready')
      assert.equal(harness.control.auth, undefined)
      assert.equal(harness.schedules.length, 0)
    })
  },
)
