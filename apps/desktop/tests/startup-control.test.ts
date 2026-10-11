import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  type HarnessOptions,
  RuntimeHarness,
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
