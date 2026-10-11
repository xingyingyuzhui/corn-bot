import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  CORN_MODEL_ROUTES,
  resolveCornModelConfig,
  routePlan,
} from '../src/runtime/model-provider.ts'
import { writeIsolationPatch } from '../src/runtime/profile-bootstrap.ts'

async function withTemporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'corn-model-test-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('no Corn model configuration boots keyless', async () => {
  await withTemporary(async (directory) => {
    const env = { CORN_MODEL_ENV_FILE: join(directory, 'missing.env') }
    assert.equal(resolveCornModelConfig(env), null)
  })
})

test('private env file supplies the route; process variables win', async () => {
  await withTemporary(async (directory) => {
    const file = join(directory, 'model.env')
    await writeFile(
      file,
      'CORN_MODEL_PROVIDER=xiaomi-token-plan-cn\nCORN_MODEL_ID=mimo-v2.6-pro\nCORN_MODEL_API_KEY=file-key\n',
      { mode: 0o600 },
    )
    assert.deepEqual(resolveCornModelConfig({ CORN_MODEL_ENV_FILE: file }), {
      route: 'xiaomi-token-plan-cn',
      model: 'mimo-v2.6-pro',
      apiKey: 'file-key',
    })
    assert.equal(
      resolveCornModelConfig({
        CORN_MODEL_ENV_FILE: file,
        CORN_MODEL_ID: 'mimo-v2.6-flash',
      })?.model,
      'mimo-v2.6-flash',
    )
  })
})

test("a process route or key never borrows the file's key or model", async () => {
  await withTemporary(async (directory) => {
    const file = join(directory, 'model.env')
    await writeFile(
      file,
      'CORN_MODEL_PROVIDER=xiaomi-token-plan-cn\nCORN_MODEL_ID=mimo-v2.6-pro\nCORN_MODEL_API_KEY=mimo-file-key\n',
      { mode: 0o600 },
    )
    assert.throws(
      () =>
        resolveCornModelConfig({
          CORN_MODEL_ENV_FILE: file,
          CORN_MODEL_PROVIDER: 'deepseek-official',
          CORN_MODEL_ID: 'deepseek-chat',
        }),
      /both required/u,
    )
    assert.throws(
      () =>
        resolveCornModelConfig({
          CORN_MODEL_ENV_FILE: file,
          CORN_MODEL_PROVIDER: 'deepseek-official',
          CORN_MODEL_API_KEY: 'deepseek-process-key',
        }),
      /both required/u,
    )
    assert.throws(
      () =>
        resolveCornModelConfig({
          CORN_MODEL_ENV_FILE: file,
          CORN_MODEL_API_KEY: 'process-key',
        }),
      /must be one of/u,
    )
    assert.deepEqual(
      resolveCornModelConfig({
        CORN_MODEL_ENV_FILE: file,
        CORN_MODEL_PROVIDER: 'deepseek-official',
        CORN_MODEL_ID: 'deepseek-chat',
        CORN_MODEL_API_KEY: 'deepseek-process-key',
      }),
      {
        route: 'deepseek-official',
        model: 'deepseek-chat',
        apiKey: 'deepseek-process-key',
      },
    )
  })
})

test('readable env files, unknown routes and partial configs are refused', async () => {
  await withTemporary(async (directory) => {
    const file = join(directory, 'model.env')
    await writeFile(file, 'CORN_MODEL_PROVIDER=deepseek-official\n')
    await chmod(file, 0o644)
    assert.throws(
      () => resolveCornModelConfig({ CORN_MODEL_ENV_FILE: file }),
      /group or world readable/u,
    )
    const missing = join(directory, 'missing.env')
    assert.throws(
      () =>
        resolveCornModelConfig({
          CORN_MODEL_ENV_FILE: missing,
          CORN_MODEL_PROVIDER: 'openai',
          CORN_MODEL_ID: 'x',
          CORN_MODEL_API_KEY: 'y',
        }),
      /must be one of/u,
    )
    assert.throws(
      () =>
        resolveCornModelConfig({
          CORN_MODEL_ENV_FILE: missing,
          CORN_MODEL_PROVIDER: 'deepseek-official',
        }),
      /both required/u,
    )
  })
})

test('route patches reference credentials without embedding them', async () => {
  await withTemporary(async (directory) => {
    for (const route of CORN_MODEL_ROUTES) {
      const path = await writeIsolationPatch(directory, {
        route,
        model: 'any-model',
        apiKey: 'secret-never-written',
      })
      const text = await readFile(path, 'utf8')
      assert.ok(!text.includes('secret-never-written'))
      const entries = JSON.parse(text) as Array<{ id: string }>
      assert.equal(entries[0]?.id, 'workspace-controller')
      assert.deepEqual(entries.slice(1), routePlan(route).patch)
    }
    const keyless = JSON.parse(
      await readFile(await writeIsolationPatch(directory, null), 'utf8'),
    ) as unknown[]
    assert.equal(keyless.length, 1)
  })
})
