import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { DshHostSupervisor } from '../apps/desktop/src/runtime/dsh-host-supervisor.ts'
import { resolveCornModelConfig } from '../apps/desktop/src/runtime/model-provider.ts'
import { defaultDevelopmentHome } from '../apps/desktop/src/runtime/profile-bootstrap.ts'
import { ClawRegistryClient } from '../packages/dsh-adapter/src/claw-registry-client.ts'
import { record } from '../packages/dsh-adapter/src/remote-error.ts'
import { SessionClient } from '../packages/dsh-adapter/src/session-client.ts'
import { HostTransport } from '../packages/dsh-adapter/src/transport.ts'

// Fail before boot unless a Corn-only model configuration was supplied locally.
const model = resolveCornModelConfig()
if (!model)
  throw new Error(
    'Configure CORN_MODEL_PROVIDER, CORN_MODEL_ID and CORN_MODEL_API_KEY locally before the real model smoke',
  )

const host = new DshHostSupervisor(
  process.env.CORN_DSH_HOME ?? defaultDevelopmentHome(),
  undefined,
  model,
)
let mux
let cancelFollow
try {
  const transport = new HostTransport(await host.start())
  const sessions = new SessionClient(transport)
  const registry = new ClawRegistryClient(transport)
  const catalog = record(await sessions.modelCatalog())
  assert.ok(Array.isArray(catalog.groups))
  const group = catalog.groups
    .map(record)
    .find((item) => item.id === model.route)
  assert.ok(
    group && Array.isArray(group.models),
    `Corn model route ${model.route} must be available`,
  )
  assert.ok(
    group.models.map(record).some((item) => item.id === model.model),
    'Requested Corn model must be in the live catalog',
  )
  const agent = await registry.create(
    `Corn model smoke ${randomUUID().slice(0, 8)}`,
  )
  await registry.ensurePreset(agent)
  const sessionId = `corn-model-${randomUUID()}`
  await sessions.create({
    sessionId,
    cwd: agent.canonicalRoot,
    agentPreset: agent.dshPreset,
  })
  await registry.bind(agent, sessionId)
  await sessions.selectModel({
    sessionId,
    provider: model.route,
    model: model.model,
  })
  await registry.state(sessionId, 'ready')
  mux = await transport.connect()
  let snapshotResolve
  let snapshotReject
  const snapshotReady = new Promise((resolve, reject) => {
    snapshotResolve = resolve
    snapshotReject = reject
  })
  let terminalResolve
  let terminalReject
  const terminal = new Promise((resolve, reject) => {
    terminalResolve = resolve
    terminalReject = reject
  })
  // Attach handlers immediately, including before admission finishes.
  void snapshotReady.catch(() => {})
  void terminal.catch(() => {})
  let cursor = -1
  let chunks = 0
  let assistantMessages = 0
  let endedTurn
  const deadline = setTimeout(() => {
    snapshotReject(new Error('Model follow timeout'))
    terminalReject(new Error('Model turn timeout'))
  }, 120_000)
  try {
    cancelFollow = mux.open(
      'session/follow',
      {
        request: {
          address: { kind: 'session', sessionId },
          assistantStream: true,
          maxMessages: 100,
        },
      },
      (raw) => {
        const item = record(raw)
        if (item.type === 'snapshot') {
          assert.equal(typeof item.cursor, 'number')
          cursor = item.cursor
          snapshotResolve()
        } else if (item.type === 'assistant-stream') {
          if (record(item.frame).type === 'chunk') chunks++
        } else if (item.type === 'event') {
          const event = record(item.event)
          assert.equal(
            event.seq,
            cursor + 1,
            'Live durable events must be contiguous',
          )
          cursor = event.seq
          if (event.type === 'assistant/message') {
            assert.notEqual(record(event.data).interrupted, true)
            assistantMessages++
          }
          if (event.type === 'turn/end') {
            const data = record(event.data)
            assert.equal(record(data.reason).kind, 'completed')
            endedTurn = data.turn
            terminalResolve()
          }
        }
      },
      (error) => {
        snapshotReject(error)
        terminalReject(error)
      },
    )
    await snapshotReady
    const receipt = record(
      await sessions.prompt({
        sessionId,
        requestId: randomUUID(),
        mode: 'queue',
        content: [
          {
            type: 'text',
            text: 'This is a connection test. Reply with the words Corn connection verified. Do not call tools or perform any actions.',
          },
        ],
        clientTimeZone: 'Asia/Shanghai',
      }),
    )
    assert.equal(receipt.accepted, true)
    await terminal
    assert.ok(chunks > 0, 'Real assistant stream chunks are required')
    assert.ok(
      assistantMessages > 0,
      'A committed assistant message is required',
    )
    const page = record(
      await transport.rpc('session/page', {
        request: {
          address: { kind: 'session', sessionId },
          throughSeq: cursor,
          maxMessages: 100,
        },
      }),
    )
    assert.ok(Array.isArray(page.records))
    const persisted = page.records.map(record).map((item) => record(item.event))
    assert.ok(persisted.some((event) => event.type === 'assistant/message'))
    assert.ok(
      persisted.some(
        (event) =>
          event.type === 'turn/end' && record(event.data).turn === endedTurn,
      ),
    )
    await mkdir(new URL('../.artifacts/', import.meta.url), {
      recursive: true,
      mode: 0o700,
    })
    await writeFile(
      new URL('../.artifacts/m0-model-smoke.json', import.meta.url),
      `${JSON.stringify({ recordedAt: new Date().toISOString(), passed: true, route: model.route, model: model.model, chunks, assistantMessages, persistedCompletion: true, scope: 'Real Corn-only model call; no response content or credentials exported.' }, null, 2)}\n`,
      { mode: 0o600 },
    )
    console.log(
      'PASS real model stream, committed assistant message and durable completed turn',
    )
  } finally {
    clearTimeout(deadline)
  }
} finally {
  cancelFollow?.()
  mux?.close()
  await host.stop()
}
