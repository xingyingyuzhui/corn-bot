import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  type HarnessOptions,
  RuntimeHarness,
  within,
} from './helpers/runtime-harness.ts'

const TIMEOUT = { timeout: 10_000 }

async function withHarness(
  options: HarnessOptions,
  run: (harness: RuntimeHarness) => Promise<void>,
): Promise<void> {
  const harness = await RuntimeHarness.create(options)
  try {
    await run(harness)
  } finally {
    await harness.dispose()
  }
}

function lockHeld(harness: RuntimeHarness): boolean {
  return existsSync(join(harness.home, 'corn-host.lock'))
}

// R2: configuration errors are controlled App failures, not Main crashes.

for (const [label, options, code] of [
  [
    'mode-600 file without a key',
    { modelEnv: 'CORN_MODEL_PROVIDER=deepseek-official\nCORN_MODEL_ID=x\n' },
    'model_config_invalid',
  ],
  [
    'unknown provider',
    {
      modelEnv:
        'CORN_MODEL_PROVIDER=openai\nCORN_MODEL_ID=x\nCORN_MODEL_API_KEY=fixture\n',
    },
    'model_config_invalid',
  ],
  [
    'mode-644 file',
    {
      modelEnv: 'CORN_MODEL_PROVIDER=deepseek-official\n',
      modelEnvMode: 0o644,
    },
    'model_config_permissions',
  ],
  [
    'unreadable file',
    {
      modelEnv: 'CORN_MODEL_PROVIDER=deepseek-official\n',
      modelEnvMode: 0o200,
    },
    'model_config_unreadable',
  ],
] as const) {
  test(
    `model config: ${label} fails safely with no Host spawn or retry`,
    TIMEOUT,
    async () => {
      await withHarness(options, async (harness) => {
        await harness.control.start()
        assert.equal(harness.control.view.status, 'failed')
        assert.equal(harness.control.view.errorCode, code)
        assert.equal(harness.children.length, 0, 'no Host may be spawned')
        assert.equal(
          harness.schedules.length,
          0,
          'no recovery may be scheduled',
        )
        assert.equal(lockHeld(harness), false)
        assert.doesNotMatch(JSON.stringify(harness.control.view), /fixture/u)
      })
    },
  )
}

test(
  'model config: no file boots keyless; a valid file routes only its own key',
  TIMEOUT,
  async () => {
    await withHarness({}, async (harness) => {
      await harness.control.start()
      assert.equal(harness.control.view.status, 'ready')
      const env = harness.children[0]?.env ?? {}
      assert.equal(env.DEEPSEEK_API_KEY, undefined)
      assert.equal(env.XIAOMI_TOKEN_PLAN_CN_API_KEY, undefined)
    })
    await withHarness(
      {
        modelEnv:
          'CORN_MODEL_PROVIDER=xiaomi-token-plan-cn\nCORN_MODEL_ID=mimo-v2.6-flash\nCORN_MODEL_API_KEY=fixture-not-a-key\n',
      },
      async (harness) => {
        await harness.control.start()
        assert.equal(harness.control.view.status, 'ready')
        const env = harness.children[0]?.env ?? {}
        assert.equal(env.XIAOMI_TOKEN_PLAN_CN_API_KEY, 'fixture-not-a-key')
        assert.equal(env.DEEPSEEK_API_KEY, undefined)
      },
    )
  },
)

// R3: every startup step is bound to its own child's lifetime.

test(
  'exit before readiness fails the start once and schedules one recovery',
  TIMEOUT,
  async () => {
    await withHarness({ autoReady: false }, async (harness) => {
      const started = harness.control.start()
      const child = await harness.nextChild()
      child.exit(1)
      await within(started, 'start')
      assert.equal(harness.control.view.status, 'recovering')
      assert.equal(harness.schedules.length, 1)
      assert.equal(harness.control.auth, undefined)
      assert.equal(lockHeld(harness), false)
    })
  },
)

test(
  'exit while authentication is pending is not masked by a later auth success',
  TIMEOUT,
  async () => {
    await withHarness({ gateExchange: true }, async (harness) => {
      const started = harness.control.start()
      const child = await harness.nextChild()
      const exchange = await harness.nextExchange()
      child.exit(null, 'SIGKILL')
      exchange.gate.resolve()
      await within(started, 'start')
      assert.notEqual(harness.control.view.status, 'ready')
      assert.equal(harness.control.view.status, 'recovering')
      assert.equal(harness.schedules.length, 1)
      assert.equal(
        exchange.signal.aborted,
        true,
        'auth fetch must be cancelled',
      )
      assert.equal(harness.control.auth, undefined)
    })
  },
)

test(
  'exit while the Claw check is pending fails the start once',
  TIMEOUT,
  async () => {
    await withHarness({}, async (harness) => {
      harness.host.gateRegistry = true
      const started = harness.control.start()
      const child = await harness.nextChild()
      const stage = await within(
        Promise.race([
          harness.host.registryArrived().then(() => 'claw-check'),
          started.then(() => 'boot-settled'),
        ]),
        'Claw check',
      )
      assert.equal(
        stage,
        'claw-check',
        'formal start must check Claw after auth',
      )
      child.exit(1)
      harness.host.openRegistry()
      await within(started, 'start')
      assert.equal(harness.control.view.status, 'recovering')
      assert.equal(harness.schedules.length, 1)
      assert.equal(harness.control.auth, undefined)
    })
  },
)

test(
  'exit after ready schedules exactly one recovery that re-validates',
  TIMEOUT,
  async () => {
    await withHarness({}, async (harness) => {
      await harness.control.start()
      assert.equal(harness.control.view.status, 'ready')
      const first = harness.children[0]
      assert.ok(first)
      first.emit('error', new Error('fixture child error'))
      first.exit(null, 'SIGKILL')
      assert.equal(harness.control.view.status, 'recovering')
      assert.equal(harness.schedules.length, 1)
      assert.equal(harness.control.auth, undefined)
      const callsBefore = harness.host.registryCalls
      harness.runRecovery()
      await harness.nextChild()
      const second = await harness.nextChild()
      assert.notEqual(second, first)
      await within(
        (async () => {
          while (harness.control.view.status !== 'ready')
            await new Promise((resolve) => setImmediate(resolve))
        })(),
        'recovered ready',
      )
      assert.equal(harness.host.registryCalls, callsBefore + 1)
      assert.equal(harness.schedules.length, 1)
    })
  },
)

test(
  'late callbacks from a replaced child never touch the new generation',
  TIMEOUT,
  async () => {
    await withHarness({}, async (harness) => {
      await harness.control.start()
      const first = harness.children[0]
      assert.ok(first)
      first.exit(null, 'SIGKILL')
      harness.runRecovery()
      await harness.nextChild()
      await harness.nextChild()
      await within(
        (async () => {
          while (harness.control.view.status !== 'ready')
            await new Promise((resolve) => setImmediate(resolve))
        })(),
        'recovered ready',
      )
      const auth = harness.control.auth
      first.stderr.write('stale diagnostic\n')
      first.emit('error', new Error('stale error'))
      first.emit('close', 1, null)
      assert.equal(harness.control.view.status, 'ready')
      assert.equal(harness.control.auth, auth)
      assert.equal(harness.schedules.length, 1)
    })
  },
)

test('each start begins with an empty diagnostic buffer', TIMEOUT, async () => {
  await withHarness({ autoReady: false }, async (harness) => {
    const started = harness.control.start()
    const first = await harness.nextChild()
    first.stderr.write('OLD-GENERATION-DIAGNOSTIC\n')
    await new Promise((resolve) => setImmediate(resolve))
    first.exit(1)
    await within(started, 'start')
    harness.runRecovery()
    const second = await harness.nextChild()
    second.exit(1)
    await within(
      (async () => {
        while (harness.schedules.length < 2)
          await new Promise((resolve) => setImmediate(resolve))
      })(),
      'second failure',
    )
    assert.doesNotMatch(
      harness.control.lastFailure ?? '',
      /OLD-GENERATION-DIAGNOSTIC/u,
    )
  })
})

for (const stage of ['readiness', 'authentication', 'Claw check'] as const) {
  test(
    `quit during ${stage} stops the child without a late ready or retry`,
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
          if (stage === 'Claw check') {
            const reached = await within(
              Promise.race([
                harness.host.registryArrived().then(() => true),
                started.then(() => false),
              ]),
              'Claw check',
            )
            assert.equal(
              reached,
              true,
              'formal start must check Claw after auth',
            )
          }
          const quit = harness.control.shutdown()
          harness.exchanges.at(-1)?.gate.resolve()
          harness.host.openRegistry()
          await within(quit, 'quit')
          await within(started, 'start')
          assert.equal(harness.control.view.status, 'stopped')
          assert.equal(harness.control.auth, undefined)
          assert.equal(harness.schedules.length, 0)
          assert.ok(child.kills.length > 0, 'the owned child must be stopped')
          if (signal) assert.equal(signal.aborted, true)
          assert.equal(lockHeld(harness), false)
        },
      )
    },
  )
}

test(
  'a direct supervisor stop during startup is not treated as a crash',
  TIMEOUT,
  async () => {
    await withHarness({ autoReady: false }, async (harness) => {
      const started = harness.control.start()
      await harness.nextChild()
      await within(harness.runtime.host.stop(), 'stop')
      await within(started, 'start')
      assert.notEqual(harness.control.view.status, 'ready')
      assert.equal(harness.schedules.length, 0)
    })
  },
)

test(
  'simultaneous child error, close and auth timeout notify once',
  TIMEOUT,
  async () => {
    await withHarness({ gateExchange: true }, async (harness) => {
      const started = harness.control.start()
      const child = await harness.nextChild()
      const exchange = await harness.nextExchange()
      child.emit('error', new Error('fixture spawn error'))
      child.exit(1)
      exchange.gate.reject(new DOMException('fixture timeout', 'TimeoutError'))
      await within(started, 'start')
      assert.equal(harness.control.view.status, 'recovering')
      assert.equal(harness.schedules.length, 1)
      assert.equal(lockHeld(harness), false)
    })
  },
)
