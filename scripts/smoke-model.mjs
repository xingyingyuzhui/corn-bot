import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { DshHostSupervisor } from '../apps/desktop/src/runtime/dsh-host-supervisor.ts'
import { resolveCornModelConfig } from '../apps/desktop/src/runtime/model-provider.ts'
import { defaultDevelopmentHome } from '../apps/desktop/src/runtime/profile-bootstrap.ts'
import { record } from '../packages/dsh-adapter/src/remote-error.ts'
import { ModelHarness } from './lib/model-session.mjs'

// Fail before boot unless a Corn-only model configuration was supplied locally.
const model = resolveCornModelConfig()
if (!model)
  throw new Error(
    'Configure CORN_MODEL_PROVIDER, CORN_MODEL_ID and CORN_MODEL_API_KEY locally before the real model smoke',
  )

const host = new DshHostSupervisor(
  process.env.CORN_DSH_HOME ?? defaultDevelopmentHome(),
  { model },
)
let harness
let follow
try {
  harness = await new ModelHarness(await host.start(), model).connect()
  await harness.assertModelInCatalog()
  const { sessionId } = await harness.boundSession('model-smoke')
  follow = await harness.follow(sessionId)
  await harness.prompt(
    sessionId,
    'This is a connection test. Reply with the words Corn connection verified. Do not call tools or perform any actions.',
  )
  const end = await follow.waitFor(
    (event) => event.type === 'turn/end',
    'model turn end',
    120_000,
  )
  assert.equal(record(record(end.data).reason).kind, 'completed')
  const messages = follow.state.events.filter(
    (event) => event.type === 'assistant/message',
  )
  for (const message of messages)
    assert.notEqual(record(message.data).interrupted, true)
  const { chunks } = follow.state
  assert.ok(chunks > 0, 'Real assistant stream chunks are required')
  assert.ok(messages.length > 0, 'A committed assistant message is required')
  const { events } = await harness.page(sessionId)
  assert.ok(events.some((event) => event.type === 'assistant/message'))
  assert.ok(
    events.some(
      (event) =>
        event.type === 'turn/end' &&
        record(event.data).turn === record(end.data).turn,
    ),
  )
  await mkdir(new URL('../.artifacts/', import.meta.url), {
    recursive: true,
    mode: 0o700,
  })
  await writeFile(
    new URL('../.artifacts/m0-model-smoke.json', import.meta.url),
    `${JSON.stringify({ recordedAt: new Date().toISOString(), passed: true, route: model.route, model: model.model, chunks, assistantMessages: messages.length, livePageCompletion: true, scope: 'Real Corn-only model call read back from the live Host; disk persistence is covered by smoke:model-lifecycle. No response content or credentials exported.' }, null, 2)}\n`,
    { mode: 0o600 },
  )
  console.log(
    'PASS real model stream, committed assistant message and durable completed turn',
  )
} finally {
  follow?.cancel()
  harness?.close()
  await host.stop()
}
