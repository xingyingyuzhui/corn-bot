import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { createGovernedHost } from '../apps/desktop/src/runtime/claw-runtime-check.ts'
import { resolveCornModelConfig } from '../apps/desktop/src/runtime/model-provider.ts'
import { defaultDevelopmentHome } from '../apps/desktop/src/runtime/profile-bootstrap.ts'
import { record } from '../packages/dsh-adapter/src/remote-error.ts'
import { ModelHarness } from './lib/model-session.mjs'

// Real-Host gate for DSH patch U1 (session-only model selection), headless and
// billable: two real model Turns plus one after a Host restart. Exports ids,
// model names and counts only. `CORN_SESSION_MODEL_ALT` names the second model
// of the same route; otherwise the first other catalog model is used.
const model = resolveCornModelConfig()
if (!model)
  throw new Error(
    'Configure CORN_MODEL_PROVIDER, CORN_MODEL_ID and CORN_MODEL_API_KEY locally before the U1 session-model gate',
  )

const TURN_TIMEOUT = 150_000
const PROMPT =
  'This is a connection test. Reply with one short sentence. Do not call tools.'
const host = createGovernedHost(
  process.env.CORN_DSH_HOME ?? defaultDevelopmentHome(),
  { model },
)
const checks = []
const check = (name, facts = {}) => {
  checks.push({ name, passed: true, ...facts })
  console.log(`PASS ${name}`)
}
const ofType = (events, type) =>
  events
    .filter((event) => event.type === type)
    .map((event) => record(event.data))
const sameSelection = (left, right) =>
  left.provider === right.provider &&
  left.model === right.model &&
  left.reasoningEffort === right.reasoningEffort

async function catalogDefault(harness) {
  return record(record(await harness.sessions.modelCatalog()).default)
}

/** One completed Turn; returns the request header model of that Turn. */
async function turn(harness, sessionId) {
  const follow = await harness.follow(sessionId)
  try {
    await harness.prompt(sessionId, PROMPT)
    const end = await follow.waitFor(
      (event) => event.type === 'turn/end',
      'turn end',
      TURN_TIMEOUT,
    )
    assert.equal(record(record(end.data).reason).kind, 'completed')
    const headers = ofType(follow.state.events, 'request/header')
    assert.ok(headers.length > 0, 'The Turn must record a request header')
    return {
      model: record(record(headers.at(-1).header).config).model,
      notices: follow.state.events.filter(
        (event) =>
          event.type === 'user/message' &&
          record(record(event.data).source).kind === 'model-selection',
      ).length,
    }
  } finally {
    follow.cancel()
  }
}

let harness
try {
  harness = await new ModelHarness(await host.start(), model).connect()
  await harness.assertModelInCatalog()
  const catalog = record(await harness.sessions.modelCatalog())
  const group = catalog.groups.map(record).find((g) => g.id === model.route)
  const alternate =
    process.env.CORN_SESSION_MODEL_ALT ??
    group.models.map(record).find((m) => m.id !== model.model)?.id
  assert.ok(alternate, 'The gate needs a second model in the Corn route')
  const before = await catalogDefault(harness)

  const one = await harness.boundSession('u1-one')
  const two = await harness.boundSession('u1-two')
  const first = await turn(harness, one.sessionId)
  assert.equal(first.model, model.model)
  const selected = await harness.sessions.selectSessionModel({
    sessionId: one.sessionId,
    provider: model.route,
    model: alternate,
  })
  await delay(3_000)
  assert.ok(sameSelection(await catalogDefault(harness), before))
  check('session selection leaves the global default unchanged', {
    selected: selected.model,
  })

  const switched = await turn(harness, one.sessionId)
  assert.equal(switched.model, alternate)
  assert.equal(switched.notices, 1, 'One model switch notice is expected')
  check('request header and switch notice use the session model', switched)

  const other = await turn(harness, two.sessionId)
  assert.equal(other.model, model.model)
  check('another Session keeps its own model', { model: other.model })

  harness.close()
  await host.stop()
  harness = await new ModelHarness(await host.start(), model).connect()
  const { events } = await harness.page(one.sessionId)
  assert.ok(
    ofType(events, 'model/selection').some((row) => row.model === alternate),
  )
  const restored = await turn(harness, one.sessionId)
  assert.equal(restored.model, alternate)
  assert.equal(restored.notices, 0)
  assert.ok(sameSelection(await catalogDefault(harness), before))
  check('session selection survives a Host restart', {
    model: restored.model,
  })

  await mkdir(new URL('../.artifacts/', import.meta.url), {
    recursive: true,
    mode: 0o700,
  })
  await writeFile(
    new URL('../.artifacts/u1-session-model-gate.json', import.meta.url),
    `${JSON.stringify({ recordedAt: new Date().toISOString(), passed: true, route: model.route, defaultModel: model.model, sessionModel: alternate, checks }, null, 2)}\n`,
  )
} finally {
  harness?.close()
  await host.stop()
}
